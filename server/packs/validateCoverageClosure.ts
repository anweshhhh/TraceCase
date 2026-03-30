import type { CoverageClosurePlan } from "@/server/packs/coverageClosurePlan";
import type { CanonicalPackContent } from "@/server/packs/validatePack";

const AC_ID_PATTERN = /\bAC-\d{2}\b/g;
const AUDIT_KEYWORD_PATTERN = /\b(audit|logged?|logging|log entry|event)\b/i;
const SESSION_KEYWORD_PATTERN =
  /\b(session|remember me|timeout|expires?|lastloginat|last login)\b/i;

export type CoverageClosureValidation = {
  status: "closed" | "still_incomplete";
  still_unclosed: Array<{
    id: string;
    criterion: string;
    reason: string;
  }>;
};

function extractAcIds(value: string | undefined | null) {
  if (!value) {
    return [];
  }

  return [...new Set(value.match(AC_ID_PATTERN) ?? [])];
}

function textContainsId(value: string | undefined | null, acId: string) {
  return extractAcIds(value).includes(acId);
}

function tagsContainId(tags: string[], acId: string) {
  return tags.some((tag) => extractAcIds(tag).includes(acId));
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

function hasSqlCheckReference(
  packContent: CanonicalPackContent,
  acId: string,
  pattern?: RegExp,
) {
  return packContent.checks.sql.some((check) => {
    const combined = [check.title, check.query_hint ?? "", ...check.validations].join(" ");
    const hasId =
      textContainsId(check.title, acId) ||
      textContainsId(check.query_hint, acId) ||
      check.validations.some((validation) => textContainsId(validation, acId));

    if (!hasId) {
      return false;
    }

    return pattern ? pattern.test(combined) : true;
  });
}

function hasAnyReference(packContent: CanonicalPackContent, acId: string) {
  return (
    hasTaggedScenarioOrTestCase(packContent, acId) ||
    hasApiCheckReference(packContent, acId) ||
    hasSqlCheckReference(packContent, acId)
  );
}

export function validateCoverageClosure(
  plan: CoverageClosurePlan,
  packContent: CanonicalPackContent,
): CoverageClosureValidation {
  const stillUnclosed = plan.obligations.flatMap((obligation) => {
    let closed = false;
    let reason = "No layer-appropriate coverage was added for this AC.";

    switch (obligation.required_action) {
      case "add_ui_case":
        closed = hasTaggedScenarioOrTestCase(packContent, obligation.id);
        reason = "Missing UI-tagged scenario or test case coverage for this AC.";
        break;
      case "add_api_case_or_check":
        closed = hasApiCheckReference(packContent, obligation.id);
        reason = "Missing API check coverage for this AC.";
        break;
      case "add_sql_case_or_check":
        closed = hasSqlCheckReference(packContent, obligation.id);
        reason = "Missing SQL check coverage for this AC.";
        break;
      case "add_audit_or_logging_check":
        closed =
          hasSqlCheckReference(packContent, obligation.id, AUDIT_KEYWORD_PATTERN) ||
          hasTaggedScenarioOrTestCaseWithKeywords(
            packContent,
            obligation.id,
            AUDIT_KEYWORD_PATTERN,
          );
        reason = "Missing audit or logging coverage for this AC.";
        break;
      case "add_session_case_or_check":
        closed =
          hasSqlCheckReference(packContent, obligation.id) ||
          hasTaggedScenarioOrTestCaseWithKeywords(
            packContent,
            obligation.id,
            SESSION_KEYWORD_PATTERN,
          );
        reason = "Missing session-oriented coverage for this AC.";
        break;
      case "strengthen_existing_coverage":
        closed = hasAnyReference(packContent, obligation.id);
        reason = "Missing explicit AC reference after repair.";
        break;
    }

    return closed
      ? []
      : [
          {
            id: obligation.id,
            criterion: obligation.criterion,
            reason,
          },
        ];
  });

  return {
    status: stillUnclosed.length > 0 ? "still_incomplete" : "closed",
    still_unclosed: stillUnclosed,
  };
}
