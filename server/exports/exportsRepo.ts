import "server-only";
import { ExportStatus, JobStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/server/audit";
import {
  EXPORT_PACK_JOB_TYPE,
  type ExportKind,
} from "@/server/exports/constants";
import { ACTIVE_EXPORT_STATUSES } from "@/server/idempotency";
import { buildExportFileName } from "@/server/exports/fileName";

export async function getPackForExport(workspaceId: string, packId: string) {
  return db.pack.findFirst({
    where: {
      id: packId,
      workspace_id: workspaceId,
    },
    select: {
      id: true,
      status: true,
      requirement_id: true,
    },
  });
}

export async function getActiveExportForPackKind(
  workspaceId: string,
  packId: string,
  kind: ExportKind,
) {
  return db.export.findFirst({
    where: {
      workspace_id: workspaceId,
      pack_id: packId,
      kind,
      status: {
        in: [...ACTIVE_EXPORT_STATUSES],
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });
}

export async function createQueuedExportAndJob(params: {
  workspaceId: string;
  packId: string;
  kind: ExportKind;
  actorClerkUserId: string;
}) {
  const { workspaceId, packId, kind, actorClerkUserId } = params;
  const fileName = buildExportFileName(packId, kind);

  return db.$transaction(async (tx) => {
    const createdExport = await tx.export.create({
      data: {
        workspace_id: workspaceId,
        pack_id: packId,
        kind,
        status: ExportStatus.QUEUED,
        file_name: fileName,
        created_by_clerk_user_id: actorClerkUserId,
      },
    });

    const createdJob = await tx.job.create({
      data: {
        workspace_id: workspaceId,
        type: EXPORT_PACK_JOB_TYPE,
        status: JobStatus.QUEUED,
        input_requirement_snapshot_id: null,
        // metadata_json is the flexible, typed-safe link for non-generation jobs.
        metadata_json: {
          export_id: createdExport.id,
          pack_id: packId,
          kind,
        } as Prisma.InputJsonValue,
        created_by_clerk_user_id: actorClerkUserId,
      },
    });

    await logAuditEvent({
      workspaceId,
      actorClerkUserId,
      action: "job.queued",
      entityType: "Job",
      entityId: createdJob.id,
      metadata: {
        job_type: EXPORT_PACK_JOB_TYPE,
        export_id: createdExport.id,
        pack_id: packId,
        kind,
      },
      client: tx,
    });

    await logAuditEvent({
      workspaceId,
      actorClerkUserId,
      action: "pack.export_requested",
      entityType: "Export",
      entityId: createdExport.id,
      metadata: {
        job_id: createdJob.id,
        pack_id: packId,
        kind,
      },
      client: tx,
    });

    return {
      exportRecord: createdExport,
      job: createdJob,
    };
  });
}

export async function markExportDispatchFailed(params: {
  workspaceId: string;
  jobId: string;
  exportId: string;
  actorClerkUserId: string;
  safeError: string;
}) {
  const { workspaceId, jobId, exportId, actorClerkUserId, safeError } = params;

  return db.$transaction(async (tx) => {
    await tx.job.updateMany({
      where: {
        id: jobId,
        workspace_id: workspaceId,
      },
      data: {
        status: JobStatus.FAILED,
        error: safeError,
        finished_at: new Date(),
      },
    });

    await tx.export.updateMany({
      where: {
        id: exportId,
        workspace_id: workspaceId,
      },
      data: {
        status: ExportStatus.FAILED,
        error: safeError,
      },
    });

    await logAuditEvent({
      workspaceId,
      actorClerkUserId,
      action: "job.dispatch_failed",
      entityType: "Job",
      entityId: jobId,
      metadata: {
        job_type: EXPORT_PACK_JOB_TYPE,
        export_id: exportId,
        error: safeError,
      },
      client: tx,
    });

    await logAuditEvent({
      workspaceId,
      actorClerkUserId,
      action: "pack.export_job_failed",
      entityType: "Export",
      entityId: exportId,
      metadata: {
        job_id: jobId,
        error: safeError,
      },
      client: tx,
    });
  });
}

export async function listRecentExportsForPack(
  workspaceId: string,
  packId: string,
  limit = 10,
) {
  return db.export.findMany({
    where: {
      workspace_id: workspaceId,
      pack_id: packId,
    },
    orderBy: {
      created_at: "desc",
    },
    take: limit,
  });
}

export async function getExportById(workspaceId: string, exportId: string) {
  return db.export.findFirst({
    where: {
      id: exportId,
      workspace_id: workspaceId,
    },
  });
}
