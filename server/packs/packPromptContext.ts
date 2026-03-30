import type { PackCriticReport } from "@/server/packs/critiquePack";
import type { CanonicalPackContent } from "@/server/packs/validatePack";

const VALIDATION_PREVIEW_LIMIT = 2;

function formatValidationPreview(validations?: string[]) {
  const items = validations ?? [];

  if (items.length === 0) {
    return "none";
  }

  const preview = items.slice(0, VALIDATION_PREVIEW_LIMIT).join(" | ");
  const remaining = items.length - VALIDATION_PREVIEW_LIMIT;

  return remaining > 0 ? `${preview} (+${remaining} more)` : preview;
}

function getCheckAssertions(check: {
  assertions?: string[];
  validations?: string[];
}) {
  return check.assertions ?? check.validations ?? [];
}

function formatSourceRefs(sourceRefs: CanonicalPackContent["scenarios"][number]["source_refs"]) {
  return sourceRefs.length > 0
    ? sourceRefs.map((ref) => `${ref.snapshot_id}:${ref.line_start}-${ref.line_end}`).join(", ")
    : "none";
}

function looksLikeCanonicalPack(value: unknown): value is CanonicalPackContent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CanonicalPackContent>;

  return (
    Array.isArray(candidate.scenarios) &&
    Array.isArray(candidate.test_cases) &&
    Array.isArray(candidate.clarifying_questions) &&
    Array.isArray(candidate.assumptions) &&
    typeof candidate.checks === "object" &&
    candidate.checks !== null
  );
}

export function buildPackPromptSummary(pack: CanonicalPackContent) {
  const sections = [
    "Pack overview:",
    `- schema_version: ${pack.schema_version}`,
    `- scenarios: ${pack.scenarios.length}`,
    `- test_cases: ${pack.test_cases.length}`,
    `- api_checks: ${pack.checks.api.length}`,
    `- sql_checks: ${pack.checks.sql.length}`,
    `- etl_checks: ${pack.checks.etl.length}`,
    `- clarifying_questions: ${pack.clarifying_questions.length}`,
    `- assumptions: ${pack.assumptions.length}`,
    "",
    "Scenarios:",
    ...pack.scenarios.map(
      (scenario) =>
        `- ${scenario.id} | ${scenario.title} | refs: ${formatSourceRefs(scenario.source_refs)}`,
    ),
    "",
    "Test cases:",
    ...pack.test_cases.map(
      (testCase) =>
        `- ${testCase.id} | scenario ${testCase.scenario_id} | ${testCase.title} | steps: ${testCase.steps.length} | refs: ${formatSourceRefs(testCase.source_refs)}`,
    ),
    "",
    "API checks:",
    ...pack.checks.api.map(
      (check) =>
        `- ${check.id} | ${check.title} | ${check.method ?? "method?"} ${check.endpoint ?? "endpoint?"} | assertions: ${formatValidationPreview(getCheckAssertions(check))}`,
    ),
    "",
    "SQL checks:",
    ...pack.checks.sql.map(
      (check) =>
        `- ${check.id} | ${check.title} | query_hint: ${check.query_hint?.trim() || "semantic (no query_hint)"} | assertions: ${formatValidationPreview(getCheckAssertions(check))}`,
    ),
    "",
    "ETL checks:",
    ...pack.checks.etl.map(
      (check) =>
        `- ${check.id} | ${check.title} | assertions: ${formatValidationPreview(getCheckAssertions(check))}`,
    ),
  ];

  if (pack.clarifying_questions.length > 0) {
    sections.push(
      "",
      "Clarifying questions:",
      ...pack.clarifying_questions.map(
        (question) =>
          `- ${question.id} | ${question.question} | reason: ${question.reason || "n/a"}`,
      ),
    );
  }

  if (pack.assumptions.length > 0) {
    sections.push(
      "",
      "Assumptions:",
      ...pack.assumptions.map((assumption) => `- ${assumption}`),
    );
  }

  return sections.join("\n");
}

export function buildCriticReportSummary(report: PackCriticReport) {
  const sections = [
    `Verdict: ${report.verdict}`,
    `Coverage: ${report.coverage.acceptance_criteria_covered}/${report.coverage.acceptance_criteria_total}`,
  ];

  if (report.coverage.uncovered.length > 0) {
    sections.push(
      "Uncovered criteria:",
      ...report.coverage.uncovered.map(
        (item) => `- ${item.id} | ${item.criterion} | ${item.why_uncovered}`,
      ),
    );
  }

  if (report.major_risks.length > 0) {
    sections.push("Major risks:", ...report.major_risks.map((risk) => `- ${risk}`));
  }

  if (report.quality_notes.length > 0) {
    sections.push(
      "Quality notes:",
      ...report.quality_notes.map((note) => `- ${note}`),
    );
  }

  return sections.join("\n");
}

export function describeRepairPack(previousPack: unknown) {
  if (looksLikeCanonicalPack(previousPack)) {
    return buildPackPromptSummary(previousPack);
  }

  return JSON.stringify(previousPack);
}
