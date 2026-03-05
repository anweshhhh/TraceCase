export const EXPORT_PACK_JOB_TYPE = "export_pack" as const;
export const EXPORT_PACK_EVENT = "pack/export.requested" as const;

export const EXPORT_KINDS = [
  "test_cases",
  "scenarios",
  "api_checks",
  "sql_checks",
  "etl_checks",
] as const;

export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(value: string): value is ExportKind {
  return EXPORT_KINDS.includes(value as ExportKind);
}
