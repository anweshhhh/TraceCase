import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { can, getActiveWorkspaceContext } from "@/server/authz";
import { toPublicError } from "@/server/errors";
import { getExportById } from "@/server/exports/exportsRepo";
import { logger } from "@/server/log";
import { RateLimitError, rateLimit } from "@/server/rateLimit";
import { getRequestIdFromHeaders } from "@/server/requestId";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ exportId: string }> },
) {
  const requestId = await getRequestIdFromHeaders();
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized", request_id: requestId },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  const { workspace, membership } = await getActiveWorkspaceContext(userId);

  if (!can(membership.role, "export:download")) {
    return NextResponse.json(
      {
        error: "Forbidden: you do not have export permission.",
        request_id: requestId,
      },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  try {
    await rateLimit({
      key: `rl:download:${workspace.id}:${userId}`,
      limit: 60,
      windowSeconds: 60,
      requestId,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      const publicError = toPublicError(error, requestId);
      logger.warn("rate_limited", {
        request_id: requestId,
        workspace_id: workspace.id,
        actor_clerk_user_id: userId,
        action: "rate_limited",
        metadata: {
          key: `rl:download:${workspace.id}:${userId}`,
          retry_after_seconds: publicError.retry_after_seconds,
        },
      });
      return new Response(
        `${publicError.code}: ${publicError.message} (request_id: ${publicError.request_id})`,
        {
          status: 429,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "x-request-id": requestId,
            "Retry-After": String(publicError.retry_after_seconds ?? 1),
          },
        },
      );
    }

    throw error;
  }

  const { exportId } = await params;
  const exportRecord = await getExportById(workspace.id, exportId);

  if (!exportRecord) {
    return NextResponse.json(
      {
        error: "Export not found in the active workspace.",
        request_id: requestId,
      },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }

  if (exportRecord.status !== "SUCCEEDED") {
    return NextResponse.json(
      { error: "Export is not ready for download yet.", request_id: requestId },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  if (!exportRecord.content_text) {
    return NextResponse.json(
      { error: "Export payload is empty.", request_id: requestId },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  return new Response(exportRecord.content_text, {
    status: 200,
    headers: {
      "Content-Type": exportRecord.content_type,
      "Content-Disposition": `attachment; filename="${exportRecord.file_name}"`,
      "Cache-Control": "no-store",
      "x-request-id": requestId,
    },
  });
}
