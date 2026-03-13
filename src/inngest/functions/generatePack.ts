import { JobStatus, PackStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/server/audit";
import { getServerEnv } from "@/server/env";
import {
  getLatestValidOpenApiArtifactForSnapshot,
  getOpenApiGroundingSummary,
} from "@/server/openapiGrounding";
import {
  getLatestValidPrismaArtifactForSnapshot,
  getPrismaGroundingSummary,
} from "@/server/prismaGrounding";
import { GENERATE_PACK_JOB_TYPE } from "@/server/packs/constants";
import {
  AiPackGenerationError,
  generateAiPackWithCritic,
} from "@/server/packs/generateAiPack";
import { generatePlaceholderPack } from "@/server/packs/generatePlaceholderPack";
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

function toInputJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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

      const generationResult = await step.run("generate-pack-content", async () => {
        const env = getServerEnv();

        if (env.AI_PROVIDER === "openai") {
          const openApiArtifact = await getLatestValidOpenApiArtifactForSnapshot(
            workspaceId,
            snapshot.id,
          );
          const prismaArtifact = await getLatestValidPrismaArtifactForSnapshot(
            workspaceId,
            snapshot.id,
          );

          return generateAiPackWithCritic({
            requirement,
            snapshot,
            openApiGrounding: openApiArtifact
              ? getOpenApiGroundingSummary(openApiArtifact)
              : null,
            prismaGrounding: prismaArtifact
              ? getPrismaGroundingSummary(prismaArtifact)
              : null,
          });
        }

        return {
          content: generatePlaceholderPack({
            requirement,
            snapshot,
            actorClerkUserId: job.created_by_clerk_user_id,
          }),
          metadata: {
            ai_mode: "placeholder" as const,
          },
        };
      });

      const persisted = await step.run("persist-pack-and-job", async () => {
        const contentJson = toInputJsonValue(generationResult.content);
        const metadataJson = toInputJsonValue(generationResult.metadata);

        return db.$transaction(async (tx) => {
          const createdPack = await tx.pack.create({
            data: {
              workspace_id: workspaceId,
              requirement_id: requirement.id,
              requirement_snapshot_id: snapshot.id,
              status: PackStatus.NEEDS_REVIEW,
              schema_version: generationResult.content.schema_version,
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
              metadata_json: metadataJson,
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

          if (generationResult.metadata.ai_mode === "openai") {
            await logAuditEvent({
              workspaceId,
              actorClerkUserId: job.created_by_clerk_user_id,
              action: "pack.ai_generated",
              entityType: "pack",
              entityId: createdPack.id,
              metadata: {
                provider: generationResult.metadata.ai.provider,
                model: generationResult.metadata.ai.model,
                attempts: generationResult.metadata.ai.attempts,
                verdict: generationResult.metadata.ai.critic.verdict,
                grounding_status:
                  generationResult.metadata.ai.grounding.openapi.status,
                prisma_grounding_status:
                  generationResult.metadata.ai.grounding.prisma.status,
              },
              client: tx,
            });
          }

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
      const metadataJson =
        error instanceof AiPackGenerationError
          ? toInputJsonValue(error.metadata)
          : undefined;

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
              ...(metadataJson ? { metadata_json: metadataJson } : {}),
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
