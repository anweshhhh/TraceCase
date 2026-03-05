import Link from "next/link";
import { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorAlert, InfoAlert } from "@/components/ui/inline-alert";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { JobsAutoRefresh } from "@/components/requirements/jobs-auto-refresh";
import { RequirementForm } from "@/components/requirements/requirement-form";
import { RequirementStatusButton } from "@/components/requirements/requirement-status-button";
import { buildLineIndex } from "@/lib/sourceText";
import { TEST_FOCUS_OPTIONS } from "@/lib/validators/requirements";
import { can, requireRoleMin } from "@/server/authz";
import { generateDraftPackAction } from "@/server/pack-actions";
import { listRecentGeneratePackJobsForRequirement } from "@/server/packs/jobs";
import { getRequirement, listRequirementSnapshots } from "@/server/requirements";

// Dynamic to avoid stale status rendering while background jobs are updating.
export const dynamic = "force-dynamic";

type RequirementDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    snapshot?: string;
    job?: string;
  }>;
};

function getGenerationMessage(status?: string): {
  tone: "info" | "error";
  text: string;
} | null {
  switch (status) {
    case "queued":
      return {
        tone: "info",
        text: "Generation started. Draft pack job has been queued.",
      };
    case "dispatch-failed":
      return {
        tone: "error",
        text: "Failed to dispatch generation job. Check the latest FAILED job message below.",
      };
    case "snapshot-missing":
      return {
        tone: "error",
        text: "No snapshot found for this requirement. Save source text first.",
      };
    case "requirement-missing":
      return {
        tone: "error",
        text: "Requirement is unavailable in the active workspace.",
      };
    default:
      return null;
  }
}

function getJobBadgeVariant(status: string) {
  if (status === "SUCCEEDED") {
    return "default" as const;
  }

  if (status === "FAILED") {
    return "destructive" as const;
  }

  return "secondary" as const;
}

export default async function RequirementDetailPage({
  params,
  searchParams,
}: RequirementDetailPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const { workspace, membership } = await requireRoleMin(Role.REVIEWER);
  const canEdit = can(membership.role, "requirement:edit");
  const canGeneratePack = can(membership.role, "pack:edit");
  const requirement = await getRequirement(workspace.id, id);

  if (!requirement) {
    return (
      <section className="rounded-lg border bg-background p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          Requirement Not Found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This requirement does not exist in your active workspace.
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/requirements">Back to Requirements</Link>
        </Button>
      </section>
    );
  }

  const snapshots = await listRequirementSnapshots(workspace.id, requirement.id);
  const selectedVersion = Number.parseInt(resolvedSearchParams.snapshot ?? "", 10);
  const selectedSnapshot =
    snapshots.find((snapshot) => snapshot.version === selectedVersion) ??
    snapshots[0] ??
    null;
  const lineIndex = selectedSnapshot
    ? buildLineIndex(selectedSnapshot.source_text)
    : [];
  const generationJobs = await listRecentGeneratePackJobsForRequirement(
    workspace.id,
    requirement.id,
    5,
  );
  const generationMessage = getGenerationMessage(resolvedSearchParams.job);
  const newestJob = generationJobs[0];
  const shouldAutoRefreshJobs =
    newestJob?.status === "QUEUED" || newestJob?.status === "RUNNING";

  return (
    <section className="space-y-4">
      <div className="rounded-lg border bg-background p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {requirement.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{requirement.module_type}</Badge>
              <Badge variant={requirement.status === "ACTIVE" ? "default" : "secondary"}>
                {requirement.status}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/dashboard/requirements">Back to Requirements</Link>
            </Button>
            {canGeneratePack ? (
              <form action={generateDraftPackAction.bind(null, requirement.id)}>
                <PendingSubmitButton
                  idleLabel="Generate Draft Pack"
                  pendingLabel="Generating..."
                />
              </form>
            ) : null}
            {canEdit ? (
              <RequirementStatusButton
                currentStatus={requirement.status}
                requirementId={requirement.id}
              />
            ) : null}
          </div>
        </div>
      </div>

      {generationMessage && generationMessage.tone === "info" ? (
        <InfoAlert>{generationMessage.text}</InfoAlert>
      ) : null}
      {generationMessage && generationMessage.tone === "error" ? (
        <ErrorAlert>{generationMessage.text}</ErrorAlert>
      ) : null}

      <div className="rounded-lg border bg-background p-6 shadow-sm">
        {canEdit ? (
          <RequirementForm
            initialValues={{
              title: requirement.title,
              module_type: requirement.module_type,
              test_focus: requirement.test_focus.filter(
                (
                  focus,
                ): focus is (typeof TEST_FOCUS_OPTIONS)[number] =>
                  TEST_FOCUS_OPTIONS.includes(
                    focus as (typeof TEST_FOCUS_OPTIONS)[number],
                  ),
              ),
              source_text: requirement.source_text,
            }}
            mode="edit"
            requirementId={requirement.id}
          />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Read-only view. You do not have edit permissions for requirements.
            </p>
            <div className="grid gap-3 rounded-md border bg-muted/20 p-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">Module Type</p>
                <p className="font-medium">{requirement.module_type}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Test Focus</p>
                <p className="font-medium">
                  {requirement.test_focus.length > 0
                    ? requirement.test_focus.join(", ")
                    : "None"}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">Source Text</p>
                <pre className="mt-1 whitespace-pre-wrap rounded-md border bg-background p-3 font-sans text-sm">
                  {requirement.source_text}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-background p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">Snapshots</h2>
        {snapshots.length > 0 ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[300px_1fr]">
            <div className="space-y-2">
              {snapshots.map((snapshot) => {
                const isSelected = selectedSnapshot?.id === snapshot.id;

                return (
                  <Link
                    className={`block rounded-md border px-3 py-2 text-sm ${
                      isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/20"
                    }`}
                    href={`/dashboard/requirements/${requirement.id}?snapshot=${snapshot.version}`}
                    key={snapshot.id}
                  >
                    <p className="font-medium">v{snapshot.version}</p>
                    <p className="text-xs text-muted-foreground">
                      {snapshot.created_at.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      hash {snapshot.source_hash.slice(0, 12)}...
                    </p>
                    <p className="text-xs text-muted-foreground">
                      by {snapshot.created_by_clerk_user_id}
                    </p>
                  </Link>
                );
              })}
            </div>
            {selectedSnapshot ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">v{selectedSnapshot.version}</Badge>
                  <Badge variant="secondary">
                    {selectedSnapshot.source_hash.slice(0, 12)}...
                  </Badge>
                </div>
                <div className="overflow-x-auto rounded-md border bg-muted/10 p-3">
                  <div className="min-w-[520px] space-y-1 font-mono text-sm">
                    {lineIndex.map((line) => (
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
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No snapshots available for this requirement yet.
          </p>
        )}
      </div>

      <div className="rounded-lg border bg-background p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">Generation Jobs</h2>
        <JobsAutoRefresh enabled={shouldAutoRefreshJobs} />
        {generationJobs.length > 0 ? (
          <div className="mt-4 space-y-2">
            {generationJobs.map((job) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                key={job.id}
              >
                <div>
                  <p className="font-medium">{job.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.created_at.toLocaleString()}
                  </p>
                  {job.status === "FAILED" && job.error ? (
                    <p className="mt-1 max-w-[560px] text-xs text-destructive">
                      {job.error.slice(0, 260)}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getJobBadgeVariant(job.status)}>{job.status}</Badge>
                  {job.output_pack_id ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/dashboard/packs/${job.output_pack_id}`}>Open Pack</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No generation jobs yet for this requirement.
          </p>
        )}
      </div>
    </section>
  );
}
