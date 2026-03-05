import type { CanonicalPackContent } from "@/server/packs/validatePack";

const LIST_DELIMITER = " | ";

type CsvCell = string | number | null | undefined;

function escapeCsvCell(value: CsvCell): string {
  const normalized = value == null ? "" : String(value);

  if (
    normalized.includes(",") ||
    normalized.includes('"') ||
    normalized.includes("\n") ||
    normalized.includes("\r")
  ) {
    return `"${normalized.replaceAll('"', '""')}"`;
  }

  return normalized;
}

function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) =>
    row.map((cell) => escapeCsvCell(cell)).join(","),
  );

  return `${lines.join("\n")}\n`;
}

function joinList(values: string[]): string {
  return values.join(LIST_DELIMITER);
}

function formatSourceRefs(
  refs: CanonicalPackContent["scenarios"][number]["source_refs"],
): string {
  return refs
    .map((ref) => `${ref.snapshot_id}:${ref.line_start}-${ref.line_end}`)
    .join(LIST_DELIMITER);
}

function formatSteps(
  steps: CanonicalPackContent["test_cases"][number]["steps"],
): string {
  return steps
    .map((step) => `${step.step_no}. ${step.action} => ${step.expected}`)
    .join(LIST_DELIMITER);
}

export function buildScenariosCsv(packContent: CanonicalPackContent): string {
  const headers = [
    "scenario_id",
    "title",
    "description",
    "priority",
    "tags",
    "test_focus",
    "source_refs",
  ];
  const rows = packContent.scenarios.map((scenario) => [
    scenario.id,
    scenario.title,
    scenario.description,
    scenario.priority,
    joinList(scenario.tags),
    joinList(scenario.test_focus),
    formatSourceRefs(scenario.source_refs),
  ]);

  return toCsv(headers, rows);
}

export function buildTestCasesCsv(packContent: CanonicalPackContent): string {
  const headers = [
    "case_id",
    "scenario_id",
    "title",
    "layer",
    "priority",
    "type",
    "preconditions",
    "test_data",
    "steps",
    "tags",
    "source_refs",
  ];
  const rows = packContent.test_cases.map((testCase) => [
    testCase.id,
    testCase.scenario_id,
    testCase.title,
    testCase.layer,
    testCase.priority,
    testCase.type,
    joinList(testCase.preconditions),
    joinList(testCase.test_data),
    formatSteps(testCase.steps),
    joinList(testCase.tags),
    formatSourceRefs(testCase.source_refs),
  ]);

  return toCsv(headers, rows);
}

export function buildApiChecksCsv(packContent: CanonicalPackContent): string {
  const headers = [
    "check_id",
    "title",
    "method",
    "endpoint",
    "assertions",
    "source_refs",
  ];
  const rows = packContent.checks.api.map((check) => [
    check.id,
    check.title,
    check.method ?? "",
    check.endpoint ?? "",
    joinList(check.assertions),
    formatSourceRefs(check.source_refs),
  ]);

  return toCsv(headers, rows);
}

export function buildSqlChecksCsv(packContent: CanonicalPackContent): string {
  const headers = [
    "check_id",
    "title",
    "query_hint",
    "validations",
    "source_refs",
  ];
  const rows = packContent.checks.sql.map((check) => [
    check.id,
    check.title,
    check.query_hint ?? "",
    joinList(check.validations),
    formatSourceRefs(check.source_refs),
  ]);

  return toCsv(headers, rows);
}

export function buildEtlChecksCsv(packContent: CanonicalPackContent): string {
  const headers = ["check_id", "title", "validations", "source_refs"];
  const rows = packContent.checks.etl.map((check) => [
    check.id,
    check.title,
    joinList(check.validations),
    formatSourceRefs(check.source_refs),
  ]);

  return toCsv(headers, rows);
}
