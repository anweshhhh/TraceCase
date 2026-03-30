import assert from "node:assert/strict";
import test from "node:test";
import { ExportStatus, JobStatus } from "@prisma/client";
import {
  GENERATION_JOB_STALE_AFTER_MS,
  getGenerationJobActivityTimestamp,
  isActiveExportStatus,
  isActiveGenerationStatus,
  isStaleGenerationJob,
  shouldDedupExportRequest,
  shouldDedupGenerationJob,
} from "@/server/idempotency";

test("generation dedupe logic treats QUEUED/RUNNING as active", () => {
  assert.equal(isActiveGenerationStatus(JobStatus.QUEUED), true);
  assert.equal(isActiveGenerationStatus(JobStatus.RUNNING), true);
  assert.equal(isActiveGenerationStatus(JobStatus.SUCCEEDED), false);
  assert.equal(isActiveGenerationStatus(JobStatus.FAILED), false);
});

test("export dedupe logic treats QUEUED/PROCESSING as active", () => {
  assert.equal(isActiveExportStatus(ExportStatus.QUEUED), true);
  assert.equal(isActiveExportStatus(ExportStatus.PROCESSING), true);
  assert.equal(isActiveExportStatus(ExportStatus.SUCCEEDED), false);
  assert.equal(isActiveExportStatus(ExportStatus.FAILED), false);
});

test("shouldDedupGenerationJob is true only for active jobs", () => {
  assert.equal(shouldDedupGenerationJob(null), false);
  assert.equal(shouldDedupGenerationJob({ status: JobStatus.QUEUED }), true);
  assert.equal(shouldDedupGenerationJob({ status: JobStatus.RUNNING }), true);
  assert.equal(shouldDedupGenerationJob({ status: JobStatus.SUCCEEDED }), false);
});

test("shouldDedupExportRequest is true only for active exports", () => {
  assert.equal(shouldDedupExportRequest(null), false);
  assert.equal(shouldDedupExportRequest({ status: ExportStatus.QUEUED }), true);
  assert.equal(
    shouldDedupExportRequest({ status: ExportStatus.PROCESSING }),
    true,
  );
  assert.equal(
    shouldDedupExportRequest({ status: ExportStatus.SUCCEEDED }),
    false,
  );
});

test("getGenerationJobActivityTimestamp prefers started_at when present", () => {
  const createdAt = new Date("2026-03-11T16:00:00.000Z");
  const startedAt = new Date("2026-03-11T16:05:00.000Z");

  assert.deepEqual(
    getGenerationJobActivityTimestamp({
      created_at: createdAt,
      started_at: startedAt,
    }),
    startedAt,
  );
  assert.deepEqual(
    getGenerationJobActivityTimestamp({
      created_at: createdAt,
      started_at: null,
    }),
    createdAt,
  );
});

test("isStaleGenerationJob returns true only for active jobs older than the timeout", () => {
  const now = new Date("2026-03-11T17:00:00.000Z");

  assert.equal(
    isStaleGenerationJob(
      {
        status: JobStatus.RUNNING,
        created_at: new Date("2026-03-11T16:00:00.000Z"),
        started_at: new Date(
          now.getTime() - GENERATION_JOB_STALE_AFTER_MS - 1000,
        ),
      },
      now,
    ),
    true,
  );

  assert.equal(
    isStaleGenerationJob(
      {
        status: JobStatus.QUEUED,
        created_at: new Date(
          now.getTime() - GENERATION_JOB_STALE_AFTER_MS - 1000,
        ),
        started_at: null,
      },
      now,
    ),
    true,
  );

  assert.equal(
    isStaleGenerationJob(
      {
        status: JobStatus.RUNNING,
        created_at: new Date("2026-03-11T16:50:00.000Z"),
        started_at: new Date("2026-03-11T16:55:30.000Z"),
      },
      now,
    ),
    false,
  );

  assert.equal(
    isStaleGenerationJob(
      {
        status: JobStatus.SUCCEEDED,
        created_at: new Date("2026-03-11T16:00:00.000Z"),
        started_at: new Date("2026-03-11T16:01:00.000Z"),
      },
      now,
    ),
    false,
  );
});
