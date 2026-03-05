"use server";

import { JobStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { can, getActiveWorkspaceContext, getAuthContext } from "@/server/authz";
import { logAuditEvent } from "@/server/audit";
import { GENERATE_PACK_JOB_TYPE } from "@/server/packs/constants";
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

function detailRoute(requirementId: string, status: string) {
  return `/dashboard/requirements/${requirementId}?job=${status}`;
}

function assertInngestDispatchConfigured() {
  const isDev = process.env.INNGEST_DEV === "1";
  const hasEventKey = Boolean(process.env.INNGEST_EVENT_KEY);

  if (!isDev && !hasEventKey) {
    throw new Error(
      "Inngest dispatch is not configured. Set INNGEST_DEV=1 for local dev or provide INNGEST_EVENT_KEY.",
    );
  }
}

export async function generateDraftPackAction(requirementId: string) {
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
    redirect(detailRoute(requirementId, "requirement-missing"));
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
    redirect(detailRoute(requirementId, "snapshot-missing"));
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

    redirect(detailRoute(requirementId, "dispatch-failed"));
  }

  revalidatePath(`/dashboard/requirements/${requirementId}`);
  redirect(detailRoute(requirementId, "queued"));
}
