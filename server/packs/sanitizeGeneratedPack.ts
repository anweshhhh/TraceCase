import type { PackContentInput } from "@/server/packs/packSchema";

export type SanitizationFix = {
  kind:
    | "source_ref_range_swapped"
    | "source_ref_snapshot_normalized"
    | "api_method_normalized"
    | "duplicate_id_reassigned"
    | "trimmed_text";
  path: string;
  note: string;
};

export type SanitizedPackResult = {
  pack: PackContentInput;
  fixes_applied: SanitizationFix[];
};

function trimIfString(
  fixes: SanitizationFix[],
  value: unknown,
  path: string,
): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed !== value) {
    fixes.push({
      kind: "trimmed_text",
      path,
      note: "Trimmed surrounding whitespace.",
    });
  }

  return trimmed;
}

function normalizeSourceRefs(
  fixes: SanitizationFix[],
  sourceRefs: Array<{
    snapshot_id: string;
    line_start: number;
    line_end: number;
  }>,
  basePath: string,
  expectedSnapshotId: string,
) {
  for (let index = 0; index < sourceRefs.length; index += 1) {
    const sourceRef = sourceRefs[index];
    const normalizedSnapshotId = sourceRef.snapshot_id.trim();

    if (normalizedSnapshotId !== expectedSnapshotId) {
      sourceRef.snapshot_id = expectedSnapshotId;
      fixes.push({
        kind: "source_ref_snapshot_normalized",
        path: `${basePath}[${index}].snapshot_id`,
        note: `Normalized source_ref snapshot_id to ${expectedSnapshotId}.`,
      });
    } else {
      sourceRef.snapshot_id = normalizedSnapshotId;
    }

    if (
      Number.isInteger(sourceRef.line_start) &&
      Number.isInteger(sourceRef.line_end) &&
      sourceRef.line_start > sourceRef.line_end
    ) {
      const originalStart = sourceRef.line_start;
      sourceRef.line_start = sourceRef.line_end;
      sourceRef.line_end = originalStart;
      fixes.push({
        kind: "source_ref_range_swapped",
        path: `${basePath}[${index}]`,
        note: "Swapped reversed line_start/line_end range.",
      });
    }
  }
}

function buildSequentialId(prefix: string, index: number) {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

function normalizeCollectionIds<T extends { id: string }>(
  fixes: SanitizationFix[],
  items: T[],
  options: {
    path: string;
    prefix: string;
    isValid: (id: string) => boolean;
  },
) {
  const used = new Set<string>();
  let nextIndex = 1;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const originalId = item.id;
    const trimmedId = typeof originalId === "string" ? originalId.trim() : "";

    if (options.isValid(trimmedId) && !used.has(trimmedId)) {
      item.id = trimmedId;
      used.add(trimmedId);
      continue;
    }

    let nextId = buildSequentialId(options.prefix, nextIndex);
    while (used.has(nextId)) {
      nextIndex += 1;
      nextId = buildSequentialId(options.prefix, nextIndex);
    }

    item.id = nextId;
    used.add(nextId);
    nextIndex += 1;
    fixes.push({
      kind: "duplicate_id_reassigned",
      path: `${options.path}[${index}].id`,
      note: `Reassigned duplicate or invalid id ${
        trimmedId || "(missing)"
      } to ${nextId}.`,
    });
  }
}

export function sanitizeGeneratedPack(
  input: PackContentInput,
): SanitizedPackResult {
  const pack = structuredClone(input) as PackContentInput & {
    clarifying_questions?: Array<{ question: string; reason?: string | null }>;
    assumptions?: string[];
    scenarios?: Array<{
      title: string;
      description: string;
      tags: string[];
      source_refs: Array<{ snapshot_id: string; line_start: number; line_end: number }>;
    }>;
    test_cases?: Array<{
      title: string;
      preconditions: string[];
      test_data: string[];
      tags: string[];
      steps: Array<{ step_no: number; action: string; expected: string }>;
      source_refs: Array<{ snapshot_id: string; line_start: number; line_end: number }>;
    }>;
    checks?: {
      api?: Array<{
        title: string;
        method?: string | null;
        endpoint?: string | null;
        assertions: string[];
        source_refs: Array<{ snapshot_id: string; line_start: number; line_end: number }>;
      }> | null;
      sql?: Array<{
        title: string;
        query_hint?: string | null;
        validations: string[];
        source_refs: Array<{ snapshot_id: string; line_start: number; line_end: number }>;
      }> | null;
      etl?: Array<{
        title: string;
        validations: string[];
        source_refs: Array<{ snapshot_id: string; line_start: number; line_end: number }>;
      }> | null;
    };
  };
  const fixes: SanitizationFix[] = [];
  const expectedSnapshotId = pack.source.requirement_snapshot_id.trim();

  normalizeCollectionIds(fixes, pack.clarifying_questions, {
    path: "clarifying_questions",
    prefix: "Q",
    isValid: (id) => /^Q-\d{3}$/.test(id),
  });

  if (pack.assumptions) {
    pack.assumptions = pack.assumptions.map((value, index) =>
      trimIfString(fixes, value, `assumptions[${index}]`) as string,
    );
  }

  pack.clarifying_questions?.forEach((question, index) => {
    question.question = trimIfString(
      fixes,
      question.question,
      `clarifying_questions[${index}].question`,
    ) as string;

    if (question.reason === null) {
      delete question.reason;
    } else if (typeof question.reason === "string") {
      question.reason = trimIfString(
        fixes,
        question.reason,
        `clarifying_questions[${index}].reason`,
      ) as string;
    }
  });

  pack.scenarios?.forEach((scenario, index) => {
    scenario.title = trimIfString(
      fixes,
      scenario.title,
      `scenarios[${index}].title`,
    ) as string;
    scenario.description = trimIfString(
      fixes,
      scenario.description,
      `scenarios[${index}].description`,
    ) as string;
    scenario.tags = scenario.tags.map((tag, tagIndex) =>
      trimIfString(fixes, tag, `scenarios[${index}].tags[${tagIndex}]`) as string,
    );
    normalizeSourceRefs(
      fixes,
      scenario.source_refs,
      `scenarios[${index}].source_refs`,
      expectedSnapshotId,
    );
  });

  normalizeCollectionIds(fixes, pack.test_cases, {
    path: "test_cases",
    prefix: "TC",
    isValid: (id) => /^TC-\d{3}$/.test(id),
  });

  pack.test_cases?.forEach((testCase, index) => {
    testCase.title = trimIfString(
      fixes,
      testCase.title,
      `test_cases[${index}].title`,
    ) as string;
    testCase.preconditions = testCase.preconditions.map((item, itemIndex) =>
      trimIfString(
        fixes,
        item,
        `test_cases[${index}].preconditions[${itemIndex}]`,
      ) as string,
    );
    testCase.test_data = testCase.test_data.map((item, itemIndex) =>
      trimIfString(
        fixes,
        item,
        `test_cases[${index}].test_data[${itemIndex}]`,
      ) as string,
    );
    testCase.tags = testCase.tags.map((tag, tagIndex) =>
      trimIfString(fixes, tag, `test_cases[${index}].tags[${tagIndex}]`) as string,
    );
    testCase.steps.forEach((step, stepIndex) => {
      step.action = trimIfString(
        fixes,
        step.action,
        `test_cases[${index}].steps[${stepIndex}].action`,
      ) as string;
      step.expected = trimIfString(
        fixes,
        step.expected,
        `test_cases[${index}].steps[${stepIndex}].expected`,
      ) as string;
    });
    normalizeSourceRefs(
      fixes,
      testCase.source_refs,
      `test_cases[${index}].source_refs`,
      expectedSnapshotId,
    );
  });

  if (pack.checks?.api === null) {
    pack.checks.api = [];
  }
  normalizeCollectionIds(fixes, pack.checks?.api ?? [], {
    path: "checks.api",
    prefix: "CHK-API",
    isValid: (id) => /^CHK-API-\d{3}$/.test(id),
  });
  pack.checks?.api?.forEach((check, index) => {
    check.title = trimIfString(
      fixes,
      check.title,
      `checks.api[${index}].title`,
    ) as string;
    if (check.method === null) {
      delete check.method;
    } else if (typeof check.method === "string") {
      const trimmedMethod = trimIfString(
        fixes,
        check.method,
        `checks.api[${index}].method`,
      ) as string;
      const normalizedMethod = trimmedMethod.toUpperCase();
      if (normalizedMethod !== trimmedMethod) {
        fixes.push({
          kind: "api_method_normalized",
          path: `checks.api[${index}].method`,
          note: "Normalized API method casing.",
        });
      }
      check.method = normalizedMethod || undefined;
    }
    if (check.endpoint === null) {
      delete check.endpoint;
    } else if (typeof check.endpoint === "string") {
      check.endpoint = trimIfString(
        fixes,
        check.endpoint,
        `checks.api[${index}].endpoint`,
      ) as string;
    }
    check.assertions = check.assertions.map((assertion, assertionIndex) =>
      trimIfString(
        fixes,
        assertion,
        `checks.api[${index}].assertions[${assertionIndex}]`,
      ) as string,
    );
    normalizeSourceRefs(
      fixes,
      check.source_refs,
      `checks.api[${index}].source_refs`,
      expectedSnapshotId,
    );
  });

  if (pack.checks?.sql === null) {
    pack.checks.sql = [];
  }
  normalizeCollectionIds(fixes, pack.checks?.sql ?? [], {
    path: "checks.sql",
    prefix: "CHK-SQL",
    isValid: (id) => /^CHK-SQL-\d{3}$/.test(id),
  });
  pack.checks?.sql?.forEach((check, index) => {
    check.title = trimIfString(
      fixes,
      check.title,
      `checks.sql[${index}].title`,
    ) as string;
    if (check.query_hint === null) {
      delete check.query_hint;
    } else if (typeof check.query_hint === "string") {
      check.query_hint = trimIfString(
        fixes,
        check.query_hint,
        `checks.sql[${index}].query_hint`,
      ) as string;
    }
    check.validations = check.validations.map((validation, validationIndex) =>
      trimIfString(
        fixes,
        validation,
        `checks.sql[${index}].validations[${validationIndex}]`,
      ) as string,
    );
    normalizeSourceRefs(
      fixes,
      check.source_refs,
      `checks.sql[${index}].source_refs`,
      expectedSnapshotId,
    );
  });

  if (pack.checks?.etl === null) {
    pack.checks.etl = [];
  }
  normalizeCollectionIds(fixes, pack.checks?.etl ?? [], {
    path: "checks.etl",
    prefix: "CHK-ETL",
    isValid: (id) => /^CHK-ETL-\d{3}$/.test(id),
  });
  pack.checks?.etl?.forEach((check, index) => {
    check.title = trimIfString(
      fixes,
      check.title,
      `checks.etl[${index}].title`,
    ) as string;
    check.validations = check.validations.map((validation, validationIndex) =>
      trimIfString(
        fixes,
        validation,
        `checks.etl[${index}].validations[${validationIndex}]`,
      ) as string,
    );
    normalizeSourceRefs(
      fixes,
      check.source_refs,
      `checks.etl[${index}].source_refs`,
      expectedSnapshotId,
    );
  });

  return {
    pack,
    fixes_applied: fixes,
  };
}
