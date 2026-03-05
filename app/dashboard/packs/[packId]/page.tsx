import Link from "next/link";
import { Role } from "@prisma/client";
import { ExportsAutoRefresh } from "@/components/packs/exports-auto-refresh";
import type { PackContentInput } from "@/server/packs/packSchema";
import { type CanonicalPackContent, validatePackContent } from "@/server/packs/validatePack";
import { can, requireRoleMin } from "@/server/authz";
import { requestPackExportAction } from "@/server/export-actions";
import { type ExportKind } from "@/server/exports/constants";
import { listRecentExportsForPack } from "@/server/exports/exportsRepo";
import { getPack } from "@/server/packs/packsRepo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorAlert, InfoAlert } from "@/components/ui/inline-alert";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

type PackViewerPageProps = {
  params: Promise<{
    packId: string;
  }>;
  searchParams: Promise<{
    export?: string;
  }>;
};

function getPackStatusBadgeVariant(status: string) {
  if (status === "APPROVED") {
    return "default" as const;
  }

  if (status === "REJECTED") {
    return "destructive" as const;
  }

  return "secondary" as const;
}

function getExportStatusBadgeVariant(status: string) {
  if (status === "SUCCEEDED") {
    return "default" as const;
  }

  if (status === "FAILED") {
    return "destructive" as const;
  }

  return "secondary" as const;
}

function getExportMessage(status?: string): {
  tone: "info" | "error";
  text: string;
} | null {
  switch (status) {
    case "requested":
      return {
        tone: "info",
        text: "Export requested. The background job is now running.",
      };
    case "dispatch-failed":
      return {
        tone: "error",
        text: "Failed to dispatch export job. Check the latest FAILED export row.",
      };
    case "pack-not-approved":
      return {
        tone: "error",
        text: "Only APPROVED packs can be exported.",
      };
    case "invalid-kind":
      return {
        tone: "error",
        text: "Invalid export type requested.",
      };
    case "pack-missing":
      return {
        tone: "error",
        text: "Pack not found in the active workspace.",
      };
    default:
      return null;
  }
}

function requestExportLabel(kind: ExportKind) {
  if (kind === "test_cases") {
    return "Request Test Cases CSV";
  }

  if (kind === "scenarios") {
    return "Request Scenarios CSV";
  }

  if (kind === "api_checks") {
    return "Request API Checks CSV";
  }

  if (kind === "sql_checks") {
    return "Request SQL Checks CSV";
  }

  return "Request ETL Checks CSV";
}

// Dynamic to avoid stale export status rendering while async jobs are running.
export const dynamic = "force-dynamic";

export default async function PackViewerPage({
  params,
  searchParams,
}: PackViewerPageProps) {
  const { packId } = await params;
  const resolvedSearchParams = await searchParams;
  const { workspace, membership } = await requireRoleMin(Role.REVIEWER);
  const canEdit = can(membership.role, "pack:edit");
  const canExport = can(membership.role, "export:download");
  const pack = await getPack(workspace.id, packId);

  if (!pack) {
    return (
      <section className="rounded-lg border bg-background p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Pack Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This pack does not exist in your active workspace.
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/requirements">Back to Requirements</Link>
        </Button>
      </section>
    );
  }

  let prettyJson = JSON.stringify(pack.content_json, null, 2);
  let canonicalContent: CanonicalPackContent | null = null;
  let sourceSummary = {
    requirement_snapshot_id: pack.requirement_snapshot_id,
    requirement_snapshot_version: "n/a",
    source_hash: "n/a",
  };

  try {
    const canonical = validatePackContent(pack.content_json as PackContentInput).value;
    canonicalContent = canonical;
    prettyJson = JSON.stringify(canonical, null, 2);
    sourceSummary = {
      requirement_snapshot_id: canonical.source.requirement_snapshot_id,
      requirement_snapshot_version: String(
        canonical.source.requirement_snapshot_version,
      ),
      source_hash: canonical.source.source_hash,
    };
  } catch {
    // Keep raw JSON rendering for observability if data has drifted.
  }

  const exportHistory = await listRecentExportsForPack(workspace.id, pack.id, 10);
  const newestExport = exportHistory[0];
  const shouldAutoRefreshExports =
    newestExport?.status === "QUEUED" || newestExport?.status === "PROCESSING";
  const exportMessage = getExportMessage(resolvedSearchParams.export);
  const requestKinds: ExportKind[] = ["test_cases", "scenarios"];

  if (canonicalContent?.checks.api.length) {
    requestKinds.push("api_checks");
  }

  if (canonicalContent?.checks.sql.length) {
    requestKinds.push("sql_checks");
  }

  if (canonicalContent?.checks.etl.length) {
    requestKinds.push("etl_checks");
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border bg-background p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pack Viewer</h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground sm:text-sm">
              {pack.id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={getPackStatusBadgeVariant(pack.status)}>
              {pack.status}
            </Badge>
            {canEdit ? (
              <Button asChild>
                <Link href={`/dashboard/packs/${pack.id}/review`}>Review / Edit</Link>
              </Button>
            ) : null}
            {can(membership.role, "audit:view") ? (
              <Button asChild variant="outline">
                <Link href={`/dashboard/audit?entityType=Pack&entityId=${pack.id}`}>
                  View Pack Audit
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={`/dashboard/requirements/${pack.requirement_id}`}>
                Back to Requirement
              </Link>
            </Button>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 rounded-md border bg-muted/20 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Generated At</dt>
            <dd className="font-medium">{pack.generated_at.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Schema Version</dt>
            <dd className="font-medium">{pack.schema_version}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Snapshot ID</dt>
            <dd className="font-mono text-xs sm:text-sm">
              {sourceSummary.requirement_snapshot_id}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Snapshot Version</dt>
            <dd className="font-medium">{sourceSummary.requirement_snapshot_version}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Source Hash</dt>
            <dd className="font-mono text-xs sm:text-sm">{sourceSummary.source_hash}</dd>
          </div>
          {pack.status === "APPROVED" ? (
            <>
              <div>
                <dt className="text-muted-foreground">Approved By</dt>
                <dd className="font-mono text-xs sm:text-sm">
                  {pack.approved_by_clerk_user_id ?? "Unknown"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approved At</dt>
                <dd className="font-medium">
                  {pack.approved_at ? pack.approved_at.toLocaleString() : "Unknown"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <p className="text-sm text-muted-foreground">Locked: approved packs are immutable.</p>
              </div>
            </>
          ) : null}
        </dl>
      </div>

      <div className="rounded-lg border bg-background p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">Content JSON</h2>
        <pre className="mt-4 overflow-x-auto rounded-md border bg-muted/10 p-4 text-xs leading-6 sm:text-sm">
          {prettyJson}
        </pre>
      </div>

      {exportMessage && exportMessage.tone === "info" ? (
        <InfoAlert>{exportMessage.text}</InfoAlert>
      ) : null}
      {exportMessage && exportMessage.tone === "error" ? (
        <ErrorAlert>{exportMessage.text}</ErrorAlert>
      ) : null}

      <div className="rounded-lg border bg-background p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">Request Export</h2>
        {pack.status !== "APPROVED" ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Approve pack to enable export.
          </p>
        ) : !canExport ? (
          <p className="mt-2 text-sm text-muted-foreground">
            You do not have permission to export this pack.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {requestKinds.map((kind) => (
              <form action={requestPackExportAction.bind(null, pack.id, kind)} key={kind}>
                <PendingSubmitButton
                  idleLabel={requestExportLabel(kind)}
                  pendingLabel="Requesting..."
                  size="sm"
                  variant="outline"
                />
              </form>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-background p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">Export History</h2>
        <ExportsAutoRefresh enabled={shouldAutoRefreshExports} />
        {exportHistory.length > 0 ? (
          <div className="mt-4 space-y-2">
            {exportHistory.map((item) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                key={item.id}
              >
                <div>
                  <p className="font-medium">{item.kind}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {item.created_at.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    File {item.file_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Completed{" "}
                    {item.completed_at ? item.completed_at.toLocaleString() : "Pending"}
                  </p>
                  {item.status === "FAILED" && item.error ? (
                    <p className="mt-1 max-w-[560px] text-xs text-destructive">
                      {item.error.slice(0, 240)}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getExportStatusBadgeVariant(item.status)}>
                    {item.status}
                  </Badge>
                  {canExport && item.status === "SUCCEEDED" ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={`/api/exports/${item.id}/download`}>Download</a>
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No exports requested yet for this pack.
          </p>
        )}
      </div>
    </section>
  );
}
