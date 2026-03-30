"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, getActiveWorkspaceContext, getAuthContext } from "@/server/authz";
import { getServerEnv } from "@/server/env";
import { toPublicError } from "@/server/errors";
import {
  createQueuedExportAndJob,
  getActiveExportForPackKind,
  getPackForExport,
  markExportDispatchFailed,
} from "@/server/exports/exportsRepo";
import { isExportKind } from "@/server/exports/constants";
import { shouldDedupExportRequest } from "@/server/idempotency";
import { logger } from "@/server/log";
import { captureException, captureMessage } from "@/server/monitor";
import { RateLimitError, rateLimit } from "@/server/rateLimit";
import { getRequestIdFromHeaders } from "@/server/requestId";
import { inngest } from "@/src/inngest/client";
import { EXPORT_PACK_EVENT } from "@/src/inngest/events";

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 800);
  }

  return "Unknown error".slice(0, 800);
}

function packRoute(
  packId: string,
  status: string,
  requestId?: string,
  extraParams?: Record<string, string>,
) {
  const params = new URLSearchParams({ export: status });
  if (requestId) {
    params.set("request_id", requestId);
  }
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value);
    }
  }

  return `/dashboard/packs/${packId}?${params.toString()}`;
}

function assertInngestDispatchConfigured() {
  getServerEnv();
}

export async function requestPackExportAction(packId: string, rawKind: string) {
  const requestId = await getRequestIdFromHeaders();
  const { clerkUserId } = await getAuthContext();
  const { workspace, membership } = await getActiveWorkspaceContext(clerkUserId);

  if (!can(membership.role, "export:download")) {
    redirect("/forbidden");
  }

  if (!isExportKind(rawKind)) {
    redirect(packRoute(packId, "invalid-kind", requestId));
  }

  const pack = await getPackForExport(workspace.id, packId);

  if (!pack) {
    redirect(packRoute(packId, "pack-missing", requestId));
  }

  if (pack.status !== "APPROVED") {
    redirect(packRoute(packId, "pack-not-approved", requestId));
  }

  const activeExport = await getActiveExportForPackKind(
    workspace.id,
    pack.id,
    rawKind,
  );

  if (activeExport && shouldDedupExportRequest(activeExport)) {
    logger.info("export.deduped", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "Export",
      entity_id: activeExport.id,
      action: "export.deduped",
      metadata: {
        pack_id: pack.id,
        kind: rawKind,
      },
    });
    redirect(
      packRoute(pack.id, "deduped", requestId, {
        exportId: activeExport.id,
      }),
    );
  }

  try {
    await rateLimit({
      key: `rl:export_request:${workspace.id}:${clerkUserId}:${pack.id}:${rawKind}`,
      limit: 10,
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
          key: `rl:export_request:${workspace.id}:${clerkUserId}:${pack.id}:${rawKind}`,
          retry_after_seconds: publicError.retry_after_seconds,
        },
      });
      await captureMessage("export request rate limited", {
        request_id: requestId,
        workspace_id: workspace.id,
        actor_clerk_user_id: clerkUserId,
        action: "rate_limited",
      });
      redirect(
        packRoute(pack.id, "rate-limited", requestId, {
          retry: String(publicError.retry_after_seconds ?? 1),
        }),
      );
    }

    throw error;
  }

  const { exportRecord, job } = await createQueuedExportAndJob({
    workspaceId: workspace.id,
    packId: pack.id,
    kind: rawKind,
    actorClerkUserId: clerkUserId,
  });

  try {
    assertInngestDispatchConfigured();

    await inngest.send({
      name: EXPORT_PACK_EVENT,
      data: {
        workspaceId: workspace.id,
        jobId: job.id,
        exportId: exportRecord.id,
      },
    });
  } catch (error) {
    await markExportDispatchFailed({
      workspaceId: workspace.id,
      jobId: job.id,
      exportId: exportRecord.id,
      actorClerkUserId: clerkUserId,
      safeError: toSafeErrorMessage(error),
    });

    logger.error("job.dispatch_failed", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "Job",
      entity_id: job.id,
      action: "job.dispatch_failed",
      metadata: {
        export_id: exportRecord.id,
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

    revalidatePath(`/dashboard/packs/${pack.id}`);
    redirect(packRoute(pack.id, "dispatch-failed", requestId));
  }

  revalidatePath(`/dashboard/packs/${pack.id}`);
  redirect(packRoute(pack.id, "requested", requestId));
}
