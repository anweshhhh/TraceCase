import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { can, getActiveWorkspaceContext } from "@/server/authz";
import { getExportById } from "@/server/exports/exportsRepo";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ exportId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspace, membership } = await getActiveWorkspaceContext(userId);

  if (!can(membership.role, "export:download")) {
    return NextResponse.json(
      { error: "Forbidden: you do not have export permission." },
      { status: 403 },
    );
  }

  const { exportId } = await params;
  const exportRecord = await getExportById(workspace.id, exportId);

  if (!exportRecord) {
    return NextResponse.json(
      { error: "Export not found in the active workspace." },
      { status: 404 },
    );
  }

  if (exportRecord.status !== "SUCCEEDED") {
    return NextResponse.json(
      { error: "Export is not ready for download yet." },
      { status: 400 },
    );
  }

  if (!exportRecord.content_text) {
    return NextResponse.json(
      { error: "Export payload is empty." },
      { status: 400 },
    );
  }

  return new Response(exportRecord.content_text, {
    status: 200,
    headers: {
      "Content-Type": exportRecord.content_type,
      "Content-Disposition": `attachment; filename="${exportRecord.file_name}"`,
      "Cache-Control": "no-store",
    },
  });
}
