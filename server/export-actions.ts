"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, getActiveWorkspaceContext, getAuthContext } from "@/server/authz";
import {
  createQueuedExportAndJob,
  getPackForExport,
  markExportDispatchFailed,
} from "@/server/exports/exportsRepo";
import { isExportKind } from "@/server/exports/constants";
import { inngest } from "@/src/inngest/client";
import { EXPORT_PACK_EVENT } from "@/src/inngest/events";

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 800);
  }

  return "Unknown error".slice(0, 800);
}

function packRoute(packId: string, status: string) {
  return `/dashboard/packs/${packId}?export=${status}`;
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

export async function requestPackExportAction(packId: string, rawKind: string) {
  const { clerkUserId } = await getAuthContext();
  const { workspace, membership } = await getActiveWorkspaceContext(clerkUserId);

  if (!can(membership.role, "export:download")) {
    redirect("/forbidden");
  }

  if (!isExportKind(rawKind)) {
    redirect(packRoute(packId, "invalid-kind"));
  }

  const pack = await getPackForExport(workspace.id, packId);

  if (!pack) {
    redirect(packRoute(packId, "pack-missing"));
  }

  if (pack.status !== "APPROVED") {
    redirect(packRoute(packId, "pack-not-approved"));
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

    revalidatePath(`/dashboard/packs/${pack.id}`);
    redirect(packRoute(pack.id, "dispatch-failed"));
  }

  revalidatePath(`/dashboard/packs/${pack.id}`);
  redirect(packRoute(pack.id, "requested"));
}
