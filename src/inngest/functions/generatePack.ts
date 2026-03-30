import { NonRetriableError } from "inngest";
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
  type OpenAiJobMetadata,
} from "@/server/packs/generateAiPack";
import {
  completeGenerationRuntimeStage,
  countRequirementLines,
  createGenerationRunContext,
  enterGenerationRuntimeStage,
  finalizeGenerationRuntimeSuccess,
  type GenerationRuntimeStage,
  type GeneratePackRuntimeMetadata,
} from "@/server/packs/generationRunContext";
import {
  finalizeGeneratePackFailureMetadata,
  shouldStopRetryingGeneratePackError,
} from "@/server/packs/generatePackFailure";
import {
  restoreGeneratePackStepError,
  serializeGeneratePackStepError,
} from "@/server/packs/generatePackStepError";
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

function toOpenAiJobMetadata(
  value: Prisma.JsonValue | null,
): OpenAiJobMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value.ai_mode === "openai" ? (value as OpenAiJobMetadata) : null;
}

export const generatePackFunction = inngest.createFunction(
  { id: "generate-pack", retries: 0 },
  { event: GENERATE_PACK_EVENT },
  async ({ event, step }) => {
    const { workspaceId, jobId } = eventDataSchema.parse(event.data);
    const env = getServerEnv();
    const isOpenAiMode = env.AI_PROVIDER === "openai";
    const generationModel =
      env.OPENAI_GENERATION_MODEL ?? env.OPENAI_MODEL;
    const criticModel = env.OPENAI_MODEL;
    const startedAt = new Date();
    const runContext = isOpenAiMode
      ? createGenerationRunContext({
          startedAt,
          generationModel,
          criticModel,
        })
      : null;
    let lastRuntimeStage: GenerationRuntimeStage = "load_context";
    let lastRuntimeAttempt = 1;
    let lastRuntimeMetadata: GeneratePackRuntimeMetadata | null = runContext
      ? runContext.buildRuntime({
          stage: "load_context",
          attempt: 1,
        })
      : null;

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
      const metadataJson = lastRuntimeMetadata
        ? toInputJsonValue({
            ai_mode: "openai",
            runtime: lastRuntimeMetadata,
          })
        : undefined;

      const updateResult = await db.job.updateMany({
        where: {
          id: job.id,
          workspace_id: workspaceId,
        },
        data: {
          status: JobStatus.RUNNING,
          started_at: startedAt,
          error: null,
          ...(metadataJson ? { metadata_json: metadataJson } : {}),
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

      const groundingContext = await step.run("load-grounding-context", async () => {
        const openApiArtifact = await getLatestValidOpenApiArtifactForSnapshot(
          workspaceId,
          snapshot.id,
        );
        const prismaArtifact = await getLatestValidPrismaArtifactForSnapshot(
          workspaceId,
          snapshot.id,
        );

        return {
          openApiGrounding: openApiArtifact
            ? getOpenApiGroundingSummary(openApiArtifact)
            : null,
          prismaGrounding: prismaArtifact
            ? getPrismaGroundingSummary(prismaArtifact)
            : null,
        };
      });

      await step.run("record-load-context", async () => {
        if (!lastRuntimeMetadata) {
          return;
        }

        lastRuntimeMetadata = completeGenerationRuntimeStage(lastRuntimeMetadata, {
          status: "succeeded",
          requirementChars: snapshot.source_text.length,
          requirementLines: countRequirementLines(snapshot.source_text),
          openapiOperationsCount:
            groundingContext.openApiGrounding?.operations_count ?? 0,
          prismaModelsCount:
            groundingContext.prismaGrounding?.model_count ?? 0,
          note: "Loaded requirement snapshot and latest valid grounding artifacts.",
        });
        lastRuntimeStage = lastRuntimeMetadata.stage;
        lastRuntimeAttempt = lastRuntimeMetadata.attempt;

        await db.job.updateMany({
          where: {
            id: job.id,
            workspace_id: workspaceId,
          },
          data: {
            metadata_json: toInputJsonValue({
              ai_mode: "openai",
              runtime: lastRuntimeMetadata,
            }),
          },
        });
      });

      const generationStepResult = await step.run(
        "generate-pack-content",
        async () => {
          if (env.AI_PROVIDER === "openai") {
            try {
              const result = await generateAiPackWithCritic(
                {
                  requirement,
                  snapshot,
                  openApiGrounding: groundingContext.openApiGrounding,
                  prismaGrounding: groundingContext.prismaGrounding,
                },
                {
                  generationModel,
                  criticModel,
                  runContext: runContext ?? undefined,
                  initialRuntime: lastRuntimeMetadata ?? undefined,
                  onProgress: async (runtime) => {
                    lastRuntimeStage = runtime.stage;
                    lastRuntimeAttempt = runtime.attempt;
                    lastRuntimeMetadata = runtime;

                    await db.job.updateMany({
                      where: {
                        id: job.id,
                        workspace_id: workspaceId,
                      },
                      data: {
                        metadata_json: toInputJsonValue({
                          ai_mode: "openai",
                          runtime,
                        }),
                      },
                    });
                  },
                },
              );

              return {
                ok: true as const,
                result,
              };
            } catch (error) {
              const serializedError = serializeGeneratePackStepError(error);
              if (serializedError) {
                return {
                  ok: false as const,
                  error: serializedError,
                };
              }

              throw error;
            }
          }

          return {
            ok: true as const,
            result: {
              content: generatePlaceholderPack({
                requirement,
                snapshot,
                actorClerkUserId: job.created_by_clerk_user_id,
              }),
              metadata: {
                ai_mode: "placeholder" as const,
              },
            },
          };
        },
      );

      const generationResult = generationStepResult.ok
        ? generationStepResult.result
        : (() => {
            throw restoreGeneratePackStepError(generationStepResult.error);
          })();

      const persisted = await step.run("persist-pack-and-job", async () => {
        if (runContext && generationResult.metadata.ai_mode === "openai") {
          lastRuntimeMetadata = enterGenerationRuntimeStage(
            lastRuntimeMetadata ?? runContext.buildRuntime({
              stage: "load_context",
              attempt: 1,
            }),
            {
              stage: "finalize",
              attempt: generationResult.metadata.ai.attempts,
              requirementChars: snapshot.source_text.length,
              requirementLines: countRequirementLines(snapshot.source_text),
              openapiOperationsCount:
                generationResult.metadata.ai.grounding.openapi.operations_available,
              prismaModelsCount:
                generationResult.metadata.ai.grounding.prisma.models_available,
              packApiChecksCount: generationResult.content.checks.api.length,
              packSqlChecksCount: generationResult.content.checks.sql.length,
              semanticSqlChecksCount:
                generationResult.metadata.ai.grounding.prisma.sql_checks_semantic,
              note: "Persisting generated pack and final job metadata.",
            },
          );
          lastRuntimeStage = lastRuntimeMetadata.stage;
          lastRuntimeAttempt = lastRuntimeMetadata.attempt;

          await db.job.updateMany({
            where: {
              id: job.id,
              workspace_id: workspaceId,
            },
            data: {
              metadata_json: toInputJsonValue({
                ai_mode: "openai",
                runtime: lastRuntimeMetadata,
              }),
            },
          });
        }

        const contentJson = toInputJsonValue(generationResult.content);
        const finalizedSuccessRuntime =
          runContext &&
          generationResult.metadata.ai_mode === "openai" &&
          lastRuntimeMetadata
            ? finalizeGenerationRuntimeSuccess(lastRuntimeMetadata, {
                packApiChecksCount: generationResult.content.checks.api.length,
                packSqlChecksCount: generationResult.content.checks.sql.length,
                semanticSqlChecksCount:
                  generationResult.metadata.ai.grounding.prisma.sql_checks_semantic,
                note: "Pack persisted and job finalized successfully.",
              })
            : null;

        if (finalizedSuccessRuntime) {
          lastRuntimeMetadata = finalizedSuccessRuntime;
          lastRuntimeStage = finalizedSuccessRuntime.stage;
          lastRuntimeAttempt = finalizedSuccessRuntime.attempt;
        }

        const finalMetadata =
          generationResult.metadata.ai_mode === "openai" && finalizedSuccessRuntime
            ? {
                ...generationResult.metadata,
                runtime: finalizedSuccessRuntime,
              }
            : generationResult.metadata;
        const metadataJson = toInputJsonValue(finalMetadata);

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
      const persistedJobMetadata = runContext
        ? await db.job.findFirst({
            where: {
              id: job.id,
              workspace_id: workspaceId,
            },
            select: {
              metadata_json: true,
            },
          })
        : null;
      const fallbackRuntime = runContext
        ? runContext.buildRuntime({
            status: "failed",
            stage: lastRuntimeStage,
            attempt: lastRuntimeAttempt,
          })
        : null;
      const finalizedMetadata =
        runContext && fallbackRuntime
          ? finalizeGeneratePackFailureMetadata({
              persistedMetadata: toOpenAiJobMetadata(
                persistedJobMetadata?.metadata_json ?? null,
              ),
              errorMetadata:
                error instanceof AiPackGenerationError &&
                error.metadata.ai_mode === "openai"
                  ? error.metadata
                  : null,
              lastRuntime: lastRuntimeMetadata,
              fallbackRuntime,
            })
          : error instanceof AiPackGenerationError
            ? error.metadata
            : undefined;
      const metadataJson = finalizedMetadata
        ? toInputJsonValue(finalizedMetadata)
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

      if (shouldStopRetryingGeneratePackError(error)) {
        throw new NonRetriableError(safeError);
      }

      throw error;
    }
  },
);
