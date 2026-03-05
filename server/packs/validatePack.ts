import { ZodError } from "zod";
import {
  packContentSchema,
  type PackContent,
  type PackContentInput,
  type PackSourceRef,
} from "@/server/packs/packSchema";

type CanonicalChecks = {
  api: NonNullable<PackContent["checks"]["api"]>;
  sql: NonNullable<PackContent["checks"]["sql"]>;
  etl: NonNullable<PackContent["checks"]["etl"]>;
};

export type CanonicalPackContent = Omit<PackContent, "checks"> & {
  checks: CanonicalChecks;
};

export class PackValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(`${message}\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "PackValidationError";
    this.issues = issues;
  }
}

function canonicalizePackContent(input: PackContent): CanonicalPackContent {
  return {
    ...input,
    assumptions: input.assumptions.map((item) => item.trim()),
    clarifying_questions: input.clarifying_questions.map((question) => ({
      ...question,
      question: question.question.trim(),
      reason: question.reason?.trim() || undefined,
    })),
    scenarios: input.scenarios.map((scenario) => ({
      ...scenario,
      title: scenario.title.trim(),
      description: scenario.description.trim(),
      tags: scenario.tags.map((tag) => tag.trim()),
      source_refs: scenario.source_refs.map((sourceRef) => ({
        ...sourceRef,
        snapshot_id: sourceRef.snapshot_id.trim(),
      })),
    })),
    test_cases: input.test_cases.map((testCase) => ({
      ...testCase,
      title: testCase.title.trim(),
      preconditions: testCase.preconditions.map((item) => item.trim()),
      test_data: testCase.test_data.map((item) => item.trim()),
      steps: testCase.steps.map((step) => ({
        ...step,
        action: step.action.trim(),
        expected: step.expected.trim(),
      })),
      tags: testCase.tags.map((tag) => tag.trim()),
      source_refs: testCase.source_refs.map((sourceRef) => ({
        ...sourceRef,
        snapshot_id: sourceRef.snapshot_id.trim(),
      })),
    })),
    checks: {
      api: (input.checks.api ?? []).map((check) => ({
        ...check,
        title: check.title.trim(),
        method: check.method?.trim() || undefined,
        endpoint: check.endpoint?.trim() || undefined,
        assertions: check.assertions.map((item) => item.trim()),
        source_refs: check.source_refs.map((sourceRef) => ({
          ...sourceRef,
          snapshot_id: sourceRef.snapshot_id.trim(),
        })),
      })),
      sql: (input.checks.sql ?? []).map((check) => ({
        ...check,
        title: check.title.trim(),
        query_hint: check.query_hint?.trim() || undefined,
        validations: check.validations.map((item) => item.trim()),
        source_refs: check.source_refs.map((sourceRef) => ({
          ...sourceRef,
          snapshot_id: sourceRef.snapshot_id.trim(),
        })),
      })),
      etl: (input.checks.etl ?? []).map((check) => ({
        ...check,
        title: check.title.trim(),
        validations: check.validations.map((item) => item.trim()),
        source_refs: check.source_refs.map((sourceRef) => ({
          ...sourceRef,
          snapshot_id: sourceRef.snapshot_id.trim(),
        })),
      })),
    },
  };
}

function collectDuplicateIssues(
  label: string,
  ids: string[],
  issues: string[],
) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }

  if (duplicates.size > 0) {
    issues.push(`${label} contains duplicate ids: ${[...duplicates].join(", ")}`);
  }
}

function validateSourceRefs(
  refs: PackSourceRef[],
  expectedSnapshotId: string,
  path: string,
  issues: string[],
) {
  refs.forEach((ref, index) => {
    const currentPath = `${path}.source_refs[${index}]`;

    if (ref.line_start < 1 || ref.line_end < 1) {
      issues.push(`${currentPath} line_start/line_end must be >= 1`);
    }

    if (ref.line_start > ref.line_end) {
      issues.push(`${currentPath} has line_start > line_end`);
    }

    if (ref.snapshot_id !== expectedSnapshotId) {
      issues.push(
        `${currentPath} snapshot_id must equal source.requirement_snapshot_id`,
      );
    }
  });
}

function runDeterministicChecks(pack: CanonicalPackContent): string[] {
  const issues: string[] = [];

  collectDuplicateIssues(
    "clarifying_questions",
    pack.clarifying_questions.map((q) => q.id),
    issues,
  );
  collectDuplicateIssues(
    "scenarios",
    pack.scenarios.map((scenario) => scenario.id),
    issues,
  );
  collectDuplicateIssues(
    "test_cases",
    pack.test_cases.map((testCase) => testCase.id),
    issues,
  );
  collectDuplicateIssues(
    "checks.api",
    pack.checks.api.map((check) => check.id),
    issues,
  );
  collectDuplicateIssues(
    "checks.sql",
    pack.checks.sql.map((check) => check.id),
    issues,
  );
  collectDuplicateIssues(
    "checks.etl",
    pack.checks.etl.map((check) => check.id),
    issues,
  );

  const scenarioIds = new Set(pack.scenarios.map((scenario) => scenario.id));

  pack.test_cases.forEach((testCase) => {
    if (!scenarioIds.has(testCase.scenario_id)) {
      issues.push(
        `test_cases ${testCase.id} references missing scenario_id ${testCase.scenario_id}`,
      );
    }

    testCase.steps.forEach((step, index) => {
      const expected = index + 1;
      if (step.step_no !== expected) {
        issues.push(
          `test_cases ${testCase.id} has non-sequential step_no at index ${index}: expected ${expected}, got ${step.step_no}`,
        );
      }
    });
  });

  const expectedSnapshotId = pack.source.requirement_snapshot_id;

  pack.scenarios.forEach((scenario, index) => {
    validateSourceRefs(
      scenario.source_refs,
      expectedSnapshotId,
      `scenarios[${index}]`,
      issues,
    );
  });

  pack.test_cases.forEach((testCase, index) => {
    validateSourceRefs(
      testCase.source_refs,
      expectedSnapshotId,
      `test_cases[${index}]`,
      issues,
    );
  });

  pack.checks.api.forEach((check, index) => {
    validateSourceRefs(
      check.source_refs,
      expectedSnapshotId,
      `checks.api[${index}]`,
      issues,
    );
  });

  pack.checks.sql.forEach((check, index) => {
    validateSourceRefs(
      check.source_refs,
      expectedSnapshotId,
      `checks.sql[${index}]`,
      issues,
    );
  });

  pack.checks.etl.forEach((check, index) => {
    validateSourceRefs(
      check.source_refs,
      expectedSnapshotId,
      `checks.etl[${index}]`,
      issues,
    );
  });

  return issues;
}

export function validatePackContent(input: PackContentInput): {
  ok: true;
  value: CanonicalPackContent;
} {
  let parsed: PackContent;

  try {
    parsed = packContentSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      throw new PackValidationError("Pack schema validation failed", issues);
    }
    throw error;
  }

  const canonical = canonicalizePackContent(parsed);
  const deterministicIssues = runDeterministicChecks(canonical);

  if (deterministicIssues.length > 0) {
    throw new PackValidationError(
      "Pack deterministic validation failed",
      deterministicIssues,
    );
  }

  return {
    ok: true,
    value: canonical,
  };
}
