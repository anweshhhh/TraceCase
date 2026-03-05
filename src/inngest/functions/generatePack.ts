import { JobStatus, PackStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/server/audit";
import { GENERATE_PACK_JOB_TYPE } from "@/server/packs/constants";
import { generatePlaceholderPack } from "@/server/packs/generatePlaceholderPack";
import { validatePackContent } from "@/server/packs/validatePack";
import { inngest } from "@/src/inngest/client";
import { GENERATE_PACK_EVENT } from "@/src/inngest/events";

const eventDataSchema = z.object({
  workspaceId: z.string().cuid(),
  jobId: z.string().cuid(),
});

function toSafeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.slice(0, 500);
}

export const generatePackFunction = inngest.createFunction(
  { id: "generate-pack" },
  { event: GENERATE_PACK_EVENT },
  async ({ event, step }) => {
    const { workspaceId, jobId } = eventDataSchema.parse(event.data);

    const job = await step.run("load-job", async () => {
      const found = await db.job.findFirst({
        where: {
          id: jobId,
          workspace_id: workspaceId,
          type: GENERATE_PACK_JOB_TYPE,
        },
      });

      if (!found) {
        throw new Error("Generation job not found.");
      }

      return found;
    });

    await step.run("mark-job-running", async () => {
      const updateResult = await db.job.updateMany({
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

      if (updateResult.count !== 1) {
        throw new Error("Failed to mark generation job as running.");
      }
    });

    try {
      const snapshot = await step.run("load-snapshot", async () => {
        if (!job.input_requirement_snapshot_id) {
          throw new Error("Generation job is missing requirement snapshot input.");
        }

        const found = await db.requirementSnapshot.findFirst({
          where: {
            id: job.input_requirement_snapshot_id,
            workspace_id: workspaceId,
          },
        });

        if (!found) {
          throw new Error("Requirement snapshot not found.");
        }

        return found;
      });

      const requirement = await step.run("load-requirement", async () => {
        const found = await db.requirement.findFirst({
          where: {
            id: snapshot.requirement_id,
            workspace_id: workspaceId,
          },
        });

        if (!found) {
          throw new Error("Requirement not found for snapshot.");
        }

        return found;
      });

      const canonicalContent = await step.run("generate-and-validate", async () => {
        const draft = generatePlaceholderPack({
          requirement,
          snapshot,
          actorClerkUserId: job.created_by_clerk_user_id,
        });

        return validatePackContent(draft).value;
      });

      const persisted = await step.run("persist-pack-and-job", async () => {
        const contentJson = JSON.parse(
          JSON.stringify(canonicalContent),
        ) as Prisma.InputJsonValue;

        return db.$transaction(async (tx) => {
          const createdPack = await tx.pack.create({
            data: {
              workspace_id: workspaceId,
              requirement_id: requirement.id,
              requirement_snapshot_id: snapshot.id,
              status: PackStatus.NEEDS_REVIEW,
              schema_version: canonicalContent.schema_version,
              content_json: contentJson,
              created_by_clerk_user_id: job.created_by_clerk_user_id,
            },
          });

          await tx.job.updateMany({
            where: {
              id: job.id,
              workspace_id: workspaceId,
            },
            data: {
              status: JobStatus.SUCCEEDED,
              output_pack_id: createdPack.id,
              error: null,
              finished_at: new Date(),
            },
          });

          await logAuditEvent({
            workspaceId,
            actorClerkUserId: job.created_by_clerk_user_id,
            action: "pack.generated",
            entityType: "pack",
            entityId: createdPack.id,
            metadata: {
              requirement_id: requirement.id,
              snapshot_id: snapshot.id,
              pack_id: createdPack.id,
            },
            client: tx,
          });

          await logAuditEvent({
            workspaceId,
            actorClerkUserId: job.created_by_clerk_user_id,
            action: "job.succeeded",
            entityType: "job",
            entityId: job.id,
            metadata: {
              job_type: GENERATE_PACK_JOB_TYPE,
              output_pack_id: createdPack.id,
            },
            client: tx,
          });

          return {
            jobId: job.id,
            packId: createdPack.id,
          };
        });
      });

      return persisted;
    } catch (error) {
      const safeError = toSafeErrorMessage(error);

      await step.run("mark-job-failed", async () => {
        await db.$transaction(async (tx) => {
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
            action: "job.failed",
            entityType: "job",
            entityId: job.id,
            metadata: {
              job_type: GENERATE_PACK_JOB_TYPE,
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
