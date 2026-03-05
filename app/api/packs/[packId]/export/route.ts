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
import type { PackContentInput } from "@/server/packs/packSchema";
import { PackValidationError, validatePackContent } from "@/server/packs/validatePack";

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
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kind = getExportKind(request);
  if (!kind) {
    return NextResponse.json(
      {
        error:
          "Invalid export kind. Use one of: scenarios, test_cases, api_checks, sql_checks, etl_checks.",
      },
      { status: 400 },
    );
  }

  const { packId } = await params;
  const { workspace, membership } = await getActiveWorkspaceContext(userId);

  if (!can(membership.role, "export:download")) {
    return NextResponse.json(
      { error: "Forbidden: you do not have export permission." },
      { status: 403 },
    );
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
      { error: "Pack not found in the active workspace." },
      { status: 404 },
    );
  }

  if (pack.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Only APPROVED packs can be exported." },
      { status: 400 },
    );
  }

  let canonicalPack: ReturnType<typeof validatePackContent>["value"];
  try {
    canonicalPack = validatePackContent(pack.content_json as PackContentInput).value;
  } catch (error) {
    if (error instanceof PackValidationError) {
      return NextResponse.json(
        { error: "Pack content is invalid and cannot be exported." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: toSafeErrorMessage(error) },
      { status: 500 },
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
    },
  });
}
