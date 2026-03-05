import Link from "next/link";
import { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorAlert, InfoAlert, SuccessAlert } from "@/components/ui/inline-alert";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { PackJsonReviewEditor } from "@/components/packs/pack-json-review-editor";
import { buildLineIndex } from "@/lib/sourceText";
import { can, requireRoleMin } from "@/server/authz";
import { approvePackAction, rejectPackAction } from "@/server/pack-review-actions";
import { getPack } from "@/server/packs/packsRepo";

// Dynamic to avoid stale review status/action state after transitions.
export const dynamic = "force-dynamic";

type PackReviewPageProps = {
  params: Promise<{
    packId: string;
  }>;
  searchParams: Promise<{
    saved?: string;
    approved?: string;
    rejected?: string;
    action_error?: string;
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

export default async function PackReviewPage({
  params,
  searchParams,
}: PackReviewPageProps) {
  const { packId } = await params;
  const resolvedSearchParams = await searchParams;
  const { workspace, membership } = await requireRoleMin(Role.REVIEWER);
  const canEdit = can(membership.role, "pack:edit");
  const canApprove = can(membership.role, "pack:approve");
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

  const sourceLines = buildLineIndex(pack.requirement_snapshot.source_text);
  const initialJson = JSON.stringify(pack.content_json, null, 2);
  const isApproved = pack.status === "APPROVED";
  const canSavePack = canEdit && !isApproved;
  const canValidatePack = canEdit;
  const actionError = resolvedSearchParams.action_error?.slice(0, 140);

  return (
    <section className="space-y-4">
      <div className="rounded-lg border bg-background p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pack Review</h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground sm:text-sm">
              {pack.id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={getPackStatusBadgeVariant(pack.status)}>
              {pack.status}
            </Badge>
            {canApprove && !isApproved ? (
              <>
                <form action={approvePackAction.bind(null, pack.id)}>
                  <PendingSubmitButton
                    idleLabel="Approve"
                    pendingLabel="Approving..."
                    size="sm"
                  />
                </form>
                <form action={rejectPackAction.bind(null, pack.id)}>
                  <input name="reason" type="hidden" value="" />
                  <PendingSubmitButton
                    idleLabel="Reject"
                    pendingLabel="Rejecting..."
                    size="sm"
                    variant="destructive"
                  />
                </form>
              </>
            ) : null}
            <Button asChild variant="outline">
              <Link href={`/dashboard/packs/${pack.id}`}>Back to Pack</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/dashboard/requirements/${pack.requirement_id}`}>
                Back to Requirement
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {resolvedSearchParams.saved === "1" ? (
        <SuccessAlert>Pack changes saved successfully.</SuccessAlert>
      ) : null}
      {resolvedSearchParams.approved === "1" ? (
        <SuccessAlert>
          Pack approved successfully. Approved packs are now locked.
        </SuccessAlert>
      ) : null}
      {resolvedSearchParams.rejected === "1" ? (
        <InfoAlert>Pack rejected. You can continue editing and save updates.</InfoAlert>
      ) : null}
      {actionError ? (
        <ErrorAlert>{actionError}</ErrorAlert>
      ) : null}
      {isApproved ? (
        <InfoAlert>
          Approved (locked): JSON editing is disabled for this pack.
        </InfoAlert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-background p-6 shadow-sm">
          <h2 className="text-xl font-semibold tracking-tight">
            Requirement Snapshot
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline">v{pack.requirement_snapshot.version}</Badge>
            <Badge variant="secondary">
              {pack.requirement_snapshot.source_hash.slice(0, 12)}...
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Snapshot ID: {pack.requirement_snapshot.id}
          </p>
          <div className="mt-4 overflow-x-auto rounded-md border bg-muted/10 p-3">
            <div className="min-w-[520px] space-y-1 font-mono text-sm">
              {sourceLines.map((line) => (
                <div className="grid grid-cols-[48px_1fr] gap-3" key={line.lineNo}>
                  <span className="select-none text-right text-xs text-muted-foreground">
                    {line.lineNo}
                  </span>
                  <span className="whitespace-pre-wrap break-words">
                    {line.content || " "}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-background p-6 shadow-sm">
          <h2 className="text-xl font-semibold tracking-tight">
            Pack JSON Review / Edit
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Validate and save deterministic, schema-valid pack JSON.
          </p>
          <div className="mt-4">
            <PackJsonReviewEditor
              canSave={canSavePack}
              canValidate={canValidatePack}
              initialJson={initialJson}
              packId={pack.id}
              readOnlyMessage={
                isApproved
                  ? "Approved packs are locked and cannot be edited."
                  : "Read-only view. You do not have permission to edit packs."
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
