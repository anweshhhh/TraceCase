"use server";

import { JobStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { can, getActiveWorkspaceContext, getAuthContext } from "@/server/authz";
import { logAuditEvent } from "@/server/audit";
import { getServerEnv } from "@/server/env";
import { toPublicError } from "@/server/errors";
import {
  ACTIVE_GENERATION_JOB_STATUSES,
  isStaleGenerationJob,
  shouldDedupGenerationJob,
} from "@/server/idempotency";
import { logger } from "@/server/log";
import { captureException, captureMessage } from "@/server/monitor";
import { GENERATE_PACK_JOB_TYPE } from "@/server/packs/constants";
import { RateLimitError, rateLimit } from "@/server/rateLimit";
import { getRequestIdFromHeaders } from "@/server/requestId";
import { inngest } from "@/src/inngest/client";
import { GENERATE_PACK_EVENT } from "@/src/inngest/events";

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const cause =
      typeof error.cause === "string"
        ? error.cause
        : error.cause instanceof Error
          ? error.cause.message
          : null;
    const message = [error.message, cause].filter(Boolean).join(" | ");

    return message.slice(0, 800);
  }

  return "Unknown error".slice(0, 800);
}

function detailRoute(
  requirementId: string,
  status: string,
  requestId?: string,
  extraParams?: Record<string, string>,
) {
  const params = new URLSearchParams({ job: status });
  if (requestId) {
    params.set("request_id", requestId);
  }
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value);
    }
  }

  return `/dashboard/requirements/${requirementId}?${params.toString()}`;
}

function assertInngestDispatchConfigured() {
  getServerEnv();
}

export async function generateDraftPackAction(requirementId: string) {
  const requestId = await getRequestIdFromHeaders();
  const { clerkUserId } = await getAuthContext();
  const { workspace, membership } = await getActiveWorkspaceContext(clerkUserId);

  if (!can(membership.role, "pack:edit")) {
    redirect("/forbidden");
  }

  const requirement = await db.requirement.findFirst({
    where: {
      id: requirementId,
      workspace_id: workspace.id,
    },
    select: {
      id: true,
    },
  });

  if (!requirement) {
    redirect(detailRoute(requirementId, "requirement-missing", requestId));
  }

  const latestSnapshot = await db.requirementSnapshot.findFirst({
    where: {
      workspace_id: workspace.id,
      requirement_id: requirementId,
    },
    orderBy: {
      version: "desc",
    },
    select: {
      id: true,
    },
  });

  if (!latestSnapshot) {
    redirect(detailRoute(requirementId, "snapshot-missing", requestId));
  }

  const snapshotIds = await db.requirementSnapshot.findMany({
    where: {
      workspace_id: workspace.id,
      requirement_id: requirementId,
    },
    select: {
      id: true,
    },
  });

  const staleJobs =
    snapshotIds.length > 0
      ? (
          await db.job.findMany({
            where: {
              workspace_id: workspace.id,
              type: GENERATE_PACK_JOB_TYPE,
              status: { in: [...ACTIVE_GENERATION_JOB_STATUSES] },
              input_requirement_snapshot_id: {
                in: snapshotIds.map((item) => item.id),
              },
            },
            select: {
              id: true,
              status: true,
              created_at: true,
              started_at: true,
              created_by_clerk_user_id: true,
            },
          })
        ).filter((job) => isStaleGenerationJob(job))
      : [];

  if (staleJobs.length > 0) {
    await db.$transaction(async (tx) => {
      for (const staleJob of staleJobs) {
        await tx.job.updateMany({
          where: {
            id: staleJob.id,
            workspace_id: workspace.id,
            status: staleJob.status,
          },
          data: {
            status: JobStatus.FAILED,
            error:
              "Generation job timed out or the worker stopped before completion. Please retry.",
            finished_at: new Date(),
          },
        });

        await logAuditEvent({
          workspaceId: workspace.id,
          actorClerkUserId: staleJob.created_by_clerk_user_id,
          action: "job.timed_out",
          entityType: "job",
          entityId: staleJob.id,
          metadata: {
            job_type: GENERATE_PACK_JOB_TYPE,
            error:
              "Generation job timed out or the worker stopped before completion. Please retry.",
          },
          client: tx,
        });
      }
    });
  }

  const activeJob =
    snapshotIds.length > 0
      ? await db.job.findFirst({
          where: {
            workspace_id: workspace.id,
            type: GENERATE_PACK_JOB_TYPE,
            status: { in: [...ACTIVE_GENERATION_JOB_STATUSES] },
            input_requirement_snapshot_id: {
              in: snapshotIds.map((item) => item.id),
            },
          },
          orderBy: {
            created_at: "desc",
          },
          select: {
            id: true,
            status: true,
          },
        })
      : null;

  if (activeJob && shouldDedupGenerationJob(activeJob)) {
    logger.info("job.deduped", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "Job",
      entity_id: activeJob.id,
      action: "job.deduped",
      metadata: {
        requirement_id: requirementId,
        status: activeJob.status,
      },
    });

    await logAuditEvent({
      workspaceId: workspace.id,
      actorClerkUserId: clerkUserId,
      action: "job.deduped",
      entityType: "Job",
      entityId: activeJob.id,
      metadata: {
        request_id: requestId,
        requirement_id: requirementId,
        status: activeJob.status,
      },
    });

    redirect(detailRoute(requirementId, "deduped", requestId));
  }

  try {
    await rateLimit({
      key: `rl:pack_generate:${workspace.id}:${clerkUserId}:${requirementId}`,
      limit: 3,
      windowSeconds: 60,
      requestId,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      const publicError = toPublicError(error, requestId);
      logger.warn("rate_limited", {
        request_id: requestId,
        workspace_id: workspace.id,
        actor_clerk_user_id: clerkUserId,
        action: "rate_limited",
        metadata: {
          key: `rl:pack_generate:${workspace.id}:${clerkUserId}:${requirementId}`,
          limit: 3,
          window_seconds: 60,
          retry_after_seconds: publicError.retry_after_seconds,
        },
      });
      await captureMessage("pack_generate rate limited", {
        request_id: requestId,
        workspace_id: workspace.id,
        actor_clerk_user_id: clerkUserId,
        action: "rate_limited",
      });
      await logAuditEvent({
        workspaceId: workspace.id,
        actorClerkUserId: clerkUserId,
        action: "rate_limited",
        entityType: "Requirement",
        entityId: requirementId,
        metadata: {
          request_id: requestId,
          key: `rl:pack_generate:${workspace.id}:${clerkUserId}:${requirementId}`,
          limit: 3,
          window_seconds: 60,
          retry_after_seconds: publicError.retry_after_seconds,
        },
      });

      redirect(
        detailRoute(requirementId, "rate-limited", requestId, {
          retry: String(publicError.retry_after_seconds ?? 1),
        }),
      );
    }

    throw error;
  }

  const job = await db.$transaction(async (tx) => {
    const createdJob = await tx.job.create({
      data: {
        workspace_id: workspace.id,
        type: GENERATE_PACK_JOB_TYPE,
        status: JobStatus.QUEUED,
        input_requirement_snapshot_id: latestSnapshot.id,
        created_by_clerk_user_id: clerkUserId,
      },
    });

    logger.info("job.queued", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "Job",
      entity_id: createdJob.id,
      action: "job.queued",
      metadata: {
        job_type: GENERATE_PACK_JOB_TYPE,
        requirement_id: requirementId,
        snapshot_id: latestSnapshot.id,
      },
    });

    await logAuditEvent({
      workspaceId: workspace.id,
      actorClerkUserId: clerkUserId,
      action: "job.queued",
      entityType: "job",
      entityId: createdJob.id,
      metadata: {
        job_type: GENERATE_PACK_JOB_TYPE,
        requirement_id: requirementId,
        snapshot_id: latestSnapshot.id,
      },
      client: tx,
    });

    return createdJob;
  });

  try {
    assertInngestDispatchConfigured();

    await inngest.send({
      name: GENERATE_PACK_EVENT,
      data: {
        workspaceId: workspace.id,
        jobId: job.id,
      },
    });
  } catch (error) {
    const safeError = toSafeErrorMessage(error);

    await db.$transaction(async (tx) => {
      await tx.job.updateMany({
        where: {
          id: job.id,
          workspace_id: workspace.id,
        },
        data: {
          status: JobStatus.FAILED,
          error: safeError,
          finished_at: new Date(),
        },
      });

      await logAuditEvent({
        workspaceId: workspace.id,
        actorClerkUserId: clerkUserId,
        action: "job.dispatch_failed",
        entityType: "job",
        entityId: job.id,
        metadata: {
          job_type: GENERATE_PACK_JOB_TYPE,
          job_id: job.id,
          error: safeError,
        },
        client: tx,
      });
    });

    logger.error("job.dispatch_failed", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "Job",
      entity_id: job.id,
      action: "job.dispatch_failed",
      metadata: {
        error: safeError,
      },
    });
    await captureException(error, {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "Job",
      entity_id: job.id,
      action: "job.dispatch_failed",
    });

    redirect(detailRoute(requirementId, "dispatch-failed", requestId));
  }

  revalidatePath(`/dashboard/requirements/${requirementId}`);
  redirect(detailRoute(requirementId, "queued", requestId));
}
