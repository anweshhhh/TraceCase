import { ExportStatus, JobStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/server/audit";
import {
  buildApiChecksCsv,
  buildEtlChecksCsv,
  buildScenariosCsv,
  buildSqlChecksCsv,
  buildTestCasesCsv,
} from "@/server/exports/packCsv";
import {
  EXPORT_PACK_JOB_TYPE,
  isExportKind,
  type ExportKind,
} from "@/server/exports/constants";
import type { PackContentInput } from "@/server/packs/packSchema";
import { validatePackContent } from "@/server/packs/validatePack";
import { inngest } from "@/src/inngest/client";
import { EXPORT_PACK_EVENT } from "@/src/inngest/events";

const eventDataSchema = z.object({
  workspaceId: z.string().cuid(),
  jobId: z.string().cuid(),
  exportId: z.string().cuid(),
});

function toSafeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.slice(0, 800);
}

function buildCsvForKind(kind: ExportKind, content: ReturnType<typeof validatePackContent>["value"]) {
  if (kind === "test_cases") {
    return buildTestCasesCsv(content);
  }

  if (kind === "scenarios") {
    return buildScenariosCsv(content);
  }

  if (kind === "api_checks") {
    return buildApiChecksCsv(content);
  }

  if (kind === "sql_checks") {
    return buildSqlChecksCsv(content);
  }

  return buildEtlChecksCsv(content);
}

export const exportPackFunction = inngest.createFunction(
  { id: "export-pack" },
  { event: EXPORT_PACK_EVENT },
  async ({ event, step }) => {
    const { workspaceId, jobId, exportId } = eventDataSchema.parse(event.data);

    const job = await step.run("load-export-job", async () => {
      const found = await db.job.findFirst({
        where: {
          id: jobId,
          workspace_id: workspaceId,
          type: EXPORT_PACK_JOB_TYPE,
        },
      });

      if (!found) {
        throw new Error("Export job not found.");
      }

      return found;
    });

    const exportRecord = await step.run("load-export-row", async () => {
      const found = await db.export.findFirst({
        where: {
          id: exportId,
          workspace_id: workspaceId,
        },
        include: {
          pack: {
            select: {
              id: true,
              status: true,
              content_json: true,
            },
          },
        },
      });

      if (!found) {
        throw new Error("Export record not found.");
      }

      return found;
    });

    await step.run("mark-export-processing", async () => {
      await db.$transaction(async (tx) => {
        const jobResult = await tx.job.updateMany({
          where: {
            id: job.id,
            workspace_id: workspaceId,
          },
          data: {
            status: JobStatus.RUNNING,
            started_at: new Date(),
            error: null,
          },
        });

        if (jobResult.count !== 1) {
          throw new Error("Failed to mark export job as running.");
        }

        const exportResult = await tx.export.updateMany({
          where: {
            id: exportRecord.id,
            workspace_id: workspaceId,
          },
          data: {
            status: ExportStatus.PROCESSING,
            error: null,
          },
        });

        if (exportResult.count !== 1) {
          throw new Error("Failed to mark export as processing.");
        }
      });
    });

    try {
      const exportKind = exportRecord.kind;

      if (!isExportKind(exportKind)) {
        throw new Error("Unsupported export kind.");
      }

      if (exportRecord.pack.status !== "APPROVED") {
        throw new Error("Only APPROVED packs can be exported.");
      }

      const canonicalPack = await step.run("validate-pack-content", async () =>
        validatePackContent(exportRecord.pack.content_json as PackContentInput).value,
      );

      const csv = await step.run("build-csv", async () =>
        buildCsvForKind(exportKind, canonicalPack),
      );

      await step.run("persist-export-success", async () => {
        await db.$transaction(async (tx) => {
          await tx.export.updateMany({
            where: {
              id: exportRecord.id,
              workspace_id: workspaceId,
            },
            data: {
              status: ExportStatus.SUCCEEDED,
              content_text: csv,
              error: null,
              completed_at: new Date(),
            },
          });

          await tx.job.updateMany({
            where: {
              id: job.id,
              workspace_id: workspaceId,
            },
            data: {
              status: JobStatus.SUCCEEDED,
              error: null,
              finished_at: new Date(),
            },
          });

          await logAuditEvent({
            workspaceId,
            actorClerkUserId: job.created_by_clerk_user_id,
            action: "pack.export_job_succeeded",
            entityType: "Export",
            entityId: exportRecord.id,
            metadata: {
              job_id: job.id,
              pack_id: exportRecord.pack_id,
              kind: exportRecord.kind,
            },
            client: tx,
          });

          await logAuditEvent({
            workspaceId,
            actorClerkUserId: job.created_by_clerk_user_id,
            action: "pack.exported",
            entityType: "Pack",
            entityId: exportRecord.pack_id,
            metadata: {
              kind: exportRecord.kind,
              export_id: exportRecord.id,
              mode: "async",
            } as Prisma.InputJsonValue,
            client: tx,
          });
        });
      });

      return { jobId: job.id, exportId: exportRecord.id };
    } catch (error) {
      const safeError = toSafeErrorMessage(error);

      await step.run("persist-export-failure", async () => {
        await db.$transaction(async (tx) => {
          await tx.export.updateMany({
            where: {
              id: exportRecord.id,
              workspace_id: workspaceId,
            },
            data: {
              status: ExportStatus.FAILED,
              error: safeError,
            },
          });

          await tx.job.updateMany({
            where: {
              id: job.id,
              workspace_id: workspaceId,
            },
            data: {
              status: JobStatus.FAILED,
              error: safeError,
              finished_at: new Date(),
            },
          });

          await logAuditEvent({
            workspaceId,
            actorClerkUserId: job.created_by_clerk_user_id,
            action: "pack.export_job_failed",
            entityType: "Export",
            entityId: exportRecord.id,
            metadata: {
              job_id: job.id,
              pack_id: exportRecord.pack_id,
              kind: exportRecord.kind,
              error: safeError,
            },
            client: tx,
          });
        });
      });

      throw error;
    }
  },
);
