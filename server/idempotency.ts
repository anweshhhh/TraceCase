import { ExportStatus, JobStatus } from "@prisma/client";

export const GENERATION_JOB_STALE_AFTER_MS = 15 * 60 * 1000;

export const ACTIVE_GENERATION_JOB_STATUSES = [
  JobStatus.QUEUED,
  JobStatus.RUNNING,
] as const;

export const ACTIVE_EXPORT_STATUSES = [
  ExportStatus.QUEUED,
  ExportStatus.PROCESSING,
] as const;

export function isActiveGenerationStatus(status: JobStatus): boolean {
  return ACTIVE_GENERATION_JOB_STATUSES.includes(
    status as (typeof ACTIVE_GENERATION_JOB_STATUSES)[number],
  );
}

export function isActiveExportStatus(status: ExportStatus): boolean {
  return ACTIVE_EXPORT_STATUSES.includes(
    status as (typeof ACTIVE_EXPORT_STATUSES)[number],
  );
}

export function shouldDedupGenerationJob(
  job: { status: JobStatus } | null | undefined,
): boolean {
  return Boolean(job && isActiveGenerationStatus(job.status));
}

export function getGenerationJobActivityTimestamp(job: {
  started_at?: Date | null;
  created_at: Date;
}): Date {
  return job.started_at ?? job.created_at;
}

export function isStaleGenerationJob(
  job:
    | {
        status: JobStatus;
        started_at?: Date | null;
        created_at: Date;
      }
    | null
    | undefined,
  now = new Date(),
  staleAfterMs = GENERATION_JOB_STALE_AFTER_MS,
): boolean {
  if (!job || !isActiveGenerationStatus(job.status)) {
    return false;
  }

  return (
    now.getTime() - getGenerationJobActivityTimestamp(job).getTime() >=
    staleAfterMs
  );
}

export function shouldDedupExportRequest(
  exportRecord: { status: ExportStatus } | null | undefined,
): boolean {
  return Boolean(exportRecord && isActiveExportStatus(exportRecord.status));
}
