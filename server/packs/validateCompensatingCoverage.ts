import type { AcceptanceCriterion } from "@/server/packs/acceptanceCriteriaPlanner";
import type { CanonicalPackContent } from "@/server/packs/validatePack";

const AC_ID_PATTERN = /\bAC-\d{2}\b/g;
const AUDIT_KEYWORD_PATTERN = /\b(audit|logged?|logging|log entry|event)\b/i;
const SESSION_KEYWORD_PATTERN =
  /\b(session|remember me|timeout|expires?|lastloginat|last login)\b/i;

export type CompensatingCoverageValidation = {
  status: "sufficient" | "insufficient";
  issues: Array<{
    id: string;
    reason: string;
  }>;
};

function extractAcIds(value: string | undefined | null) {
  if (!value) {
    return [];
  }

  return [...new Set(value.match(AC_ID_PATTERN) ?? [])];
}

function tagsContainId(tags: string[], acId: string) {
  return tags.some((tag) => extractAcIds(tag).includes(acId));
}

function textContainsId(value: string | undefined | null, acId: string) {
  return extractAcIds(value).includes(acId);
}

function hasTaggedScenarioOrTestCase(packContent: CanonicalPackContent, acId: string) {
  return (
    packContent.scenarios.some((scenario) => tagsContainId(scenario.tags, acId)) ||
    packContent.test_cases.some((testCase) => tagsContainId(testCase.tags, acId))
  );
}

function hasTaggedScenarioOrTestCaseWithKeywords(
  packContent: CanonicalPackContent,
  acId: string,
  pattern: RegExp,
) {
  return (
    packContent.scenarios.some(
      (scenario) =>
        tagsContainId(scenario.tags, acId) &&
        pattern.test(`${scenario.title} ${scenario.description}`),
    ) ||
    packContent.test_cases.some((testCase) => {
      if (!tagsContainId(testCase.tags, acId)) {
        return false;
      }

      const combined = [
        testCase.title,
        ...testCase.preconditions,
        ...testCase.test_data,
        ...testCase.steps.flatMap((step) => [step.action, step.expected]),
      ].join(" ");

      return pattern.test(combined);
    })
  );
}

function hasApiCheckReference(packContent: CanonicalPackContent, acId: string) {
  return packContent.checks.api.some(
    (check) =>
      textContainsId(check.title, acId) ||
      check.assertions.some((assertion) => textContainsId(assertion, acId)),
  );
}

function getSqlReferenceCounts(packContent: CanonicalPackContent, acId: string) {
  let semanticCount = 0;
  let concreteCount = 0;

  for (const check of packContent.checks.sql) {
    const hasId =
      textContainsId(check.title, acId) ||
      textContainsId(check.query_hint, acId) ||
      check.validations.some((validation) => textContainsId(validation, acId));

    if (!hasId) {
      continue;
    }

    if (!check.query_hint || check.query_hint.startsWith("NEEDS_MAPPING:")) {
      semanticCount += 1;
    } else {
      concreteCount += 1;
    }
  }

  return { semanticCount, concreteCount };
}

export function validateCompensatingCoverage(
  criteria: AcceptanceCriterion[],
  packContent: CanonicalPackContent,
  semanticSqlChecksCount: number,
): CompensatingCoverageValidation {
  if (semanticSqlChecksCount <= 0) {
    return {
      status: "sufficient",
      issues: [],
    };
  }

  const issues = criteria.flatMap((criterion) => {
    const hasScenarioOrTestCase = hasTaggedScenarioOrTestCase(
      packContent,
      criterion.id,
    );
    const hasApiCheck = hasApiCheckReference(packContent, criterion.id);
    const sqlReferences = getSqlReferenceCounts(packContent, criterion.id);

    if (
      criterion.expected_layers.includes("UI") &&
      (hasApiCheck || sqlReferences.semanticCount > 0) &&
      !hasScenarioOrTestCase
    ) {
      return [
        {
          id: criterion.id,
          reason: "UI-tagged AC requires concrete UI scenario or test-case coverage.",
        },
      ];
    }

    if (
      (criterion.expected_layers.includes("API") ||
        criterion.expected_layers.includes("SECURITY")) &&
      (hasScenarioOrTestCase || sqlReferences.semanticCount > 0) &&
      !hasApiCheck
    ) {
      return [
        {
          id: criterion.id,
          reason:
            "API or SECURITY-tagged AC requires concrete API check coverage when SQL fallback is semantic.",
        },
      ];
    }

    if (
      (criterion.expected_layers.includes("SESSION") ||
        criterion.expected_layers.includes("SQL")) &&
      sqlReferences.semanticCount > 0 &&
      sqlReferences.concreteCount === 0 &&
      !hasScenarioOrTestCase &&
      !hasApiCheck
    ) {
      return [
        {
          id: criterion.id,
          reason:
            "SESSION or SQL-tagged AC is only covered by semantic SQL checks and needs compensating concrete coverage.",
        },
      ];
    }

    if (
      criterion.expected_layers.includes("AUDIT") &&
      sqlReferences.semanticCount > 0 &&
      !hasTaggedScenarioOrTestCaseWithKeywords(
        packContent,
        criterion.id,
        AUDIT_KEYWORD_PATTERN,
      ) &&
      !packContent.checks.sql.some((check) => {
        const combined = [check.title, check.query_hint ?? "", ...check.validations].join(
          " ",
        );
        return (
          (textContainsId(check.title, criterion.id) ||
            textContainsId(check.query_hint, criterion.id) ||
            check.validations.some((validation) =>
              textContainsId(validation, criterion.id),
            )) &&
          AUDIT_KEYWORD_PATTERN.test(combined)
        );
      })
    ) {
      return [
        {
          id: criterion.id,
          reason:
            "AUDIT-tagged AC needs explicit audit or logging coverage when SQL checks are semantic.",
        },
      ];
    }

    if (
      criterion.expected_layers.includes("SESSION") &&
      sqlReferences.semanticCount > 0 &&
      !hasTaggedScenarioOrTestCaseWithKeywords(
        packContent,
        criterion.id,
        SESSION_KEYWORD_PATTERN,
      ) &&
      !hasApiCheck
    ) {
      return [
        {
          id: criterion.id,
          reason:
            "SESSION-tagged AC needs session-oriented scenario/test coverage or API coverage when SQL checks are semantic.",
        },
      ];
    }

    return [];
  });

  return {
    status: issues.length > 0 ? "insufficient" : "sufficient",
    issues,
  };
}
