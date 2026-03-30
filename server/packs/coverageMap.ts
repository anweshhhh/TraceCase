import type { AcceptanceCriterion } from "@/server/packs/acceptanceCriteriaPlanner";
import type { CanonicalPackContent } from "@/server/packs/validatePack";

const AC_ID_PATTERN = /\bAC-\d{2}\b/g;

export type AcceptanceCoverageReference = {
  kind: "scenario" | "test_case" | "api_check" | "sql_check";
  id: string;
};

export type AcceptanceCoverageMap = {
  total: number;
  covered: number;
  uncovered_ids: string[];
  coverage_by_id: Array<{
    id: string;
    text: string;
    referenced: boolean;
    references: AcceptanceCoverageReference[];
  }>;
};

function extractAcIdsFromText(value: string | undefined | null) {
  if (!value) {
    return [];
  }

  return [...new Set(value.match(AC_ID_PATTERN) ?? [])].sort();
}

function addCoverageReference(
  referencesById: Map<string, AcceptanceCoverageReference[]>,
  validIds: Set<string>,
  acIds: string[],
  reference: AcceptanceCoverageReference,
) {
  for (const acId of acIds) {
    if (!validIds.has(acId)) {
      continue;
    }

    const existing = referencesById.get(acId) ?? [];
    if (!existing.some((item) => item.kind === reference.kind && item.id === reference.id)) {
      existing.push(reference);
      referencesById.set(acId, existing);
    }
  }
}

export function buildAcceptanceCoverageMap(
  criteria: AcceptanceCriterion[],
  packContent: CanonicalPackContent,
): AcceptanceCoverageMap {
  const validIds = new Set(criteria.map((criterion) => criterion.id));
  const referencesById = new Map<string, AcceptanceCoverageReference[]>();

  for (const scenario of packContent.scenarios) {
    addCoverageReference(
      referencesById,
      validIds,
      scenario.tags.flatMap((tag) => extractAcIdsFromText(tag)),
      {
        kind: "scenario",
        id: scenario.id,
      },
    );
  }

  for (const testCase of packContent.test_cases) {
    addCoverageReference(
      referencesById,
      validIds,
      testCase.tags.flatMap((tag) => extractAcIdsFromText(tag)),
      {
        kind: "test_case",
        id: testCase.id,
      },
    );
  }

  for (const check of packContent.checks.api) {
    const ids = [
      ...extractAcIdsFromText(check.title),
      ...check.assertions.flatMap((assertion) => extractAcIdsFromText(assertion)),
    ];

    addCoverageReference(referencesById, validIds, ids, {
      kind: "api_check",
      id: check.id,
    });
  }

  for (const check of packContent.checks.sql) {
    const ids = [
      ...extractAcIdsFromText(check.title),
      ...extractAcIdsFromText(check.query_hint),
      ...check.validations.flatMap((validation) => extractAcIdsFromText(validation)),
    ];

    addCoverageReference(referencesById, validIds, ids, {
      kind: "sql_check",
      id: check.id,
    });
  }

  const coverageById = criteria.map((criterion) => {
    const references = referencesById.get(criterion.id) ?? [];

    return {
      id: criterion.id,
      text: criterion.text,
      referenced: references.length > 0,
      references,
    };
  });

  const uncoveredIds = coverageById
    .filter((item) => !item.referenced)
    .map((item) => item.id);

  return {
    total: criteria.length,
    covered: coverageById.length - uncoveredIds.length,
    uncovered_ids: uncoveredIds,
    coverage_by_id: coverageById,
  };
}

export function formatUncoveredAcceptanceCriteria(
  criteria: AcceptanceCriterion[],
  coverageMap: AcceptanceCoverageMap,
) {
  const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion]));

  return coverageMap.uncovered_ids
    .map((id) => {
      const criterion = criterionById.get(id);
      return criterion
        ? `${id} [${criterion.expected_layers.join(", ")}] ${criterion.text}`
        : id;
    })
    .join("\n");
}
