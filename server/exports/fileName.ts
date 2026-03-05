import type { ExportKind } from "@/server/exports/constants";

export function buildExportFileName(
  packId: string,
  kind: ExportKind,
  createdAt = new Date(),
): string {
  const iso = createdAt.toISOString().replaceAll(":", "-");
  return `${packId}_${kind}_${iso}.csv`;
}
