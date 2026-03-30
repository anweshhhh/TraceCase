import { auth } from "@clerk/nextjs/server";
import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  buildApiChecksCsv,
  buildEtlChecksCsv,
  buildScenariosCsv,
  buildSqlChecksCsv,
  buildTestCasesCsv,
} from "@/server/exports/packCsv";
import { EXPORT_KINDS, type ExportKind } from "@/server/exports/constants";
import { logAuditEvent } from "@/server/audit";
import { can, getActiveWorkspaceContext } from "@/server/authz";
import { toPublicError } from "@/server/errors";
import { logger } from "@/server/log";
import type { PackContentInput } from "@/server/packs/packSchema";
import { PackValidationError, validatePackContent } from "@/server/packs/validatePack";
import { RateLimitError, rateLimit } from "@/server/rateLimit";
import { getRequestIdFromHeaders } from "@/server/requestId";

export const runtime = "nodejs";

function getExportKind(request: NextRequest): ExportKind | null {
  const kind = request.nextUrl.searchParams.get("kind");

  if (!kind || !EXPORT_KINDS.includes(kind as ExportKind)) {
    return null;
  }

  return kind as ExportKind;
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 400);
  }

  return "Unknown export error.";
}

function getCsvForKind(kind: ExportKind, packContent: ReturnType<typeof validatePackContent>["value"]) {
  if (kind === "scenarios") {
    return buildScenariosCsv(packContent);
  }

  if (kind === "test_cases") {
    return buildTestCasesCsv(packContent);
  }

  if (kind === "api_checks") {
    return buildApiChecksCsv(packContent);
  }

  if (kind === "sql_checks") {
    return buildSqlChecksCsv(packContent);
  }

  return buildEtlChecksCsv(packContent);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const requestId = await getRequestIdFromHeaders();
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized", request_id: requestId },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  const kind = getExportKind(request);
  if (!kind) {
    return NextResponse.json(
      {
        error:
          "Invalid export kind. Use one of: scenarios, test_cases, api_checks, sql_checks, etl_checks.",
        request_id: requestId,
      },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const { packId } = await params;
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

  const pack = await db.pack.findFirst({
    where: {
      id: packId,
      workspace_id: workspace.id,
    },
    select: {
      id: true,
      workspace_id: true,
      status: true,
      content_json: true,
    },
  });

  if (!pack) {
    return NextResponse.json(
      {
        error: "Pack not found in the active workspace.",
        request_id: requestId,
      },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }

  if (pack.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Only APPROVED packs can be exported.", request_id: requestId },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  let canonicalPack: ReturnType<typeof validatePackContent>["value"];
  try {
    canonicalPack = validatePackContent(pack.content_json as PackContentInput).value;
  } catch (error) {
    if (error instanceof PackValidationError) {
      return NextResponse.json(
        {
          error: "Pack content is invalid and cannot be exported.",
          request_id: requestId,
        },
        { status: 500, headers: { "x-request-id": requestId } },
      );
    }

    return NextResponse.json(
      { error: toSafeErrorMessage(error), request_id: requestId },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }

  const csv = getCsvForKind(kind, canonicalPack);

  await logAuditEvent({
    workspaceId: workspace.id,
    actorClerkUserId: userId,
    action: "pack.exported",
    entityType: "Pack",
    entityId: pack.id,
    metadata: {
      kind,
    } as Prisma.InputJsonValue,
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${pack.id}_${kind}.csv"`,
      "Cache-Control": "no-store",
      "x-request-id": requestId,
    },
  });
}
