import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { ErrorAlert, InfoAlert } from "@/components/ui/inline-alert";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { ExpandablePreview } from "@/components/ui/expandable-preview";
import { JobsAutoRefresh } from "@/components/requirements/jobs-auto-refresh";
import { RequirementArtifactsSection } from "@/components/requirements/requirement-artifacts-section";
import { RequirementForm } from "@/components/requirements/requirement-form";
import { RequirementStatusButton } from "@/components/requirements/requirement-status-button";
import { readArtifactParseSummary } from "@/lib/requirementArtifacts";
import {
  buildGenerationJobSummary,
  buildGenerationEvidence,
  buildArtifactGroundingReadiness,
  getGeneratePackJobFailurePresentation,
  readGeneratePackJobMetadata,
} from "@/lib/packUx";
import { buildLineIndex } from "@/lib/sourceText";
import { TEST_FOCUS_OPTIONS } from "@/lib/validators/requirements";
import { can, requireRoleMin } from "@/server/authz";
import { generateDraftPackAction } from "@/server/pack-actions";
import { listRecentGeneratePackJobsForRequirement } from "@/server/packs/jobs";
import { listRequirementArtifacts } from "@/server/requirementArtifacts";
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
    retry?: string;
    request_id?: string;
  }>;
};

function getGenerationMessage(
  status?: string,
  retryAfterSeconds?: number,
  requestId?: string,
): {
  tone: "info" | "error";
  text: string;
} | null {
  const requestSuffix = requestId ? ` (request_id: ${requestId})` : "";

  switch (status) {
    case "queued":
      return {
        tone: "info",
        text: "Generation started. Draft pack job has been queued.",
      };
    case "deduped":
      return {
        tone: "info",
        text: `A generation job is already in progress for this requirement.${requestSuffix}`,
      };
    case "rate-limited":
      return {
        tone: "error",
        text: `Too many generation requests. Retry in ${
          retryAfterSeconds ?? 1
        }s.${requestSuffix}`,
      };
    case "dispatch-failed":
      return {
        tone: "error",
        text: `Failed to dispatch generation job. Check the latest FAILED job message below.${requestSuffix}`,
      };
    case "snapshot-missing":
      return {
        tone: "error",
        text: `No snapshot found for this requirement. Save source text first.${requestSuffix}`,
      };
    case "requirement-missing":
      return {
        tone: "error",
        text: `Requirement is unavailable in the active workspace.${requestSuffix}`,
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

function getReadinessBadgeVariant(status: string) {
  if (status === "valid") {
    return "default" as const;
  }

  if (status === "invalid") {
    return "destructive" as const;
  }

  return "secondary" as const;
}

function getJobSummaryToneClasses(tone: "default" | "secondary" | "destructive") {
  if (tone === "destructive") {
    return "border-destructive/25 bg-destructive/5";
  }

  if (tone === "default") {
    return "border-primary/20 bg-primary/5";
  }

  return "border-border bg-muted/20";
}

function getEvidenceToneClasses(tone: "default" | "secondary" | "destructive") {
  if (tone === "destructive") {
    return "border-destructive/25 bg-destructive/5";
  }

  if (tone === "default") {
    return "border-primary/20 bg-primary/5";
  }

  return "border-border bg-muted/30";
}

function getOpenApiStickyLabel(status: string | null | undefined) {
  switch (status) {
    case "valid":
      return "API grounding ready";
    case "invalid":
      return "API grounding invalid";
    case "missing":
      return "API grounding missing";
    default:
      return "API grounding unknown";
  }
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
  const latestSnapshot = snapshots[0] ?? null;
  const selectedVersion = Number.parseInt(resolvedSearchParams.snapshot ?? "", 10);
  const selectedSnapshot =
    snapshots.find((snapshot) => snapshot.version === selectedVersion) ??
    snapshots[0] ??
    null;
  const currentSourceLineCount = requirement.source_text.split(/\r\n|\n/).length;
  const lineIndex = selectedSnapshot
    ? buildLineIndex(selectedSnapshot.source_text)
    : [];
  const generationJobs = await listRecentGeneratePackJobsForRequirement(
    workspace.id,
    requirement.id,
    5,
  );
  const latestSnapshotArtifacts = latestSnapshot
    ? await listRequirementArtifacts(workspace.id, latestSnapshot.id)
    : [];
  const artifactReadiness = buildArtifactGroundingReadiness(
    latestSnapshotArtifacts.map((artifact) => ({
      type: artifact.type,
      parse_summary: readArtifactParseSummary(artifact.metadata_json),
    })),
  );
  const retryAfterSeconds = Number.parseInt(resolvedSearchParams.retry ?? "", 10);
  const generationMessage = getGenerationMessage(
    resolvedSearchParams.job,
    Number.isNaN(retryAfterSeconds) ? undefined : retryAfterSeconds,
    resolvedSearchParams.request_id,
  );
  const newestJob = generationJobs[0];
  const shouldAutoRefreshJobs =
    newestJob?.status === "QUEUED" || newestJob?.status === "RUNNING";
  const openApiReadiness =
    artifactReadiness.find((item) => item.type === "OPENAPI") ?? null;
  const prismaReadiness =
    artifactReadiness.find((item) => item.type === "PRISMA_SCHEMA") ?? null;
  const latestJob = generationJobs[0] ?? null;
  const historicalJobs = generationJobs.slice(1);
  const latestJobMetadata = latestJob
    ? readGeneratePackJobMetadata(latestJob.metadata_json)
    : null;
  const latestJobFailure = latestJob
    ? getGeneratePackJobFailurePresentation(latestJob.error)
    : null;
  const latestJobSummary = latestJob
    ? buildGenerationJobSummary({
        status: latestJob.status,
        metadata: latestJobMetadata,
        error: latestJob.error,
      })
    : null;
  const latestJobEvidence = latestJobMetadata
    ? buildGenerationEvidence(latestJobMetadata)
    : null;

  return (
    <section className="space-y-6">
      <div className="space-y-4 rounded-[1.75rem] border bg-background/90 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-3">
            <Button asChild className="h-auto px-0 text-muted-foreground" size="sm" variant="ghost">
              <Link href="/dashboard/requirements">Back to Requirements</Link>
            </Button>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {requirement.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{requirement.module_type}</Badge>
                <Badge
                  variant={requirement.status === "ACTIVE" ? "default" : "secondary"}
                >
                  {requirement.status}
                </Badge>
                {latestSnapshot ? (
                  <Badge variant="secondary">Snapshot v{latestSnapshot.version}</Badge>
                ) : null}
                {shouldAutoRefreshJobs ? (
                  <Badge variant="secondary">Generation in progress</Badge>
                ) : null}
              </div>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              This page is your working view for the requirement, its artifacts,
              and the latest draft-pack run. Generate against the newest snapshot,
              then inspect the latest result without leaving the page.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <div className="rounded-[1.5rem] border bg-background p-6 shadow-sm">
            <div className="mb-4 space-y-1">
              <h2 className="text-xl font-semibold tracking-tight">Requirement</h2>
              <p className="text-sm text-muted-foreground">
                Edit the source, module type, and test focus here. The newest
                saved snapshot is what generation uses.
              </p>
            </div>
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
                    <div className="mt-1">
                      <ExpandablePreview
                        contentClassName="font-sans text-sm"
                        expandLabel="Show full source"
                        collapseLabel="Collapse source"
                        summary={`${currentSourceLineCount} lines | current requirement source`}
                        storageKey={`tracecase.requirement.current-source.${requirement.id}`}
                      >
                        <pre className="whitespace-pre-wrap">{requirement.source_text}</pre>
                      </ExpandablePreview>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <RequirementArtifactsSection requirementId={requirement.id} />

          <div className="rounded-[1.5rem] border bg-background p-6 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tight">Snapshots</h2>
              <p className="text-sm text-muted-foreground">
                Inspect the saved source history and switch between versions when
                you need to compare edits.
              </p>
            </div>
            {snapshots.length > 0 ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
                <div className="space-y-2">
                  {snapshots.map((snapshot) => {
                    const isSelected = selectedSnapshot?.id === snapshot.id;

                    return (
                      <Link
                        className={`block rounded-xl border px-3 py-3 text-sm transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/20"
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
                    <ExpandablePreview
                      collapsedHeightClassName="max-h-[18rem]"
                      contentClassName="overflow-x-auto"
                      expandLabel="Show full snapshot"
                      collapseLabel="Collapse snapshot"
                      summary={`${lineIndex.length} lines | snapshot v${selectedSnapshot.version}`}
                      storageKey={`tracecase.requirement.snapshot.${requirement.id}.${selectedSnapshot.id}`}
                    >
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
                    </ExpandablePreview>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No snapshots available for this requirement yet.
              </p>
            )}
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-[1.5rem] border bg-background p-5 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">Generate draft</h2>
              <p className="text-sm text-muted-foreground">
                Launch generation against the newest saved snapshot and inspect the
                latest run here.
              </p>
            </div>
            <div className="mt-4 space-y-3 rounded-xl border bg-muted/10 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Snapshot</span>
                <span className="font-medium text-foreground">
                  {latestSnapshot ? `v${latestSnapshot.version}` : "Missing"}
                </span>
              </div>
              {openApiReadiness ? (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{openApiReadiness.label}</span>
                  <Badge variant={getReadinessBadgeVariant(openApiReadiness.status)}>
                    {openApiReadiness.status}
                  </Badge>
                </div>
              ) : null}
              {prismaReadiness ? (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{prismaReadiness.label}</span>
                  <Badge variant={getReadinessBadgeVariant(prismaReadiness.status)}>
                    {prismaReadiness.status}
                  </Badge>
                </div>
              ) : null}
            </div>
            {!openApiReadiness || openApiReadiness.status !== "valid" ? (
              <p className="mt-3 text-xs text-muted-foreground">
                OpenAPI grounding will be skipped unless the latest snapshot has a
                valid OpenAPI artifact.
              </p>
            ) : null}
            {prismaReadiness?.status === "valid" ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Prisma grounding is ready for the next run.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {canGeneratePack ? (
                <form action={generateDraftPackAction.bind(null, requirement.id)}>
                  <PendingSubmitButton
                    idleLabel="Generate Draft Pack"
                    pendingLabel="Generating..."
                  />
                </form>
              ) : null}
              {shouldAutoRefreshJobs ? (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <LoaderCircle className="size-4 animate-spin" />
                  Auto-refreshing latest run
                </div>
              ) : null}
            </div>
          </div>

          <div
            className={`rounded-[1.5rem] border p-5 shadow-sm ${
              latestJobSummary
                ? getJobSummaryToneClasses(latestJobSummary.tone)
                : "bg-background"
            }`}
            id="generation-jobs"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">Latest run</h2>
              <p className="text-sm text-muted-foreground">
                The newest draft-pack job, with quick evidence and actions.
              </p>
            </div>

            {latestJob && latestJobSummary && latestJobFailure ? (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={getJobBadgeVariant(latestJob.status)}>
                    {latestJob.status}
                  </Badge>
                  {latestJob.status === "FAILED" ? (
                    <Badge variant="destructive">{latestJobFailure.label}</Badge>
                  ) : null}
                  {latestJobMetadata?.ai_mode === "openai" && latestJobMetadata.ai ? (
                    <Badge variant="outline">{latestJobMetadata.ai.model}</Badge>
                  ) : latestJobMetadata?.ai_mode === "placeholder" ? (
                    <Badge variant="outline">Placeholder mode</Badge>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="text-lg font-semibold tracking-tight">
                    {latestJobSummary.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {latestJobSummary.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {latestJob.created_at.toLocaleString()}
                  </p>
                </div>

                {latestJobEvidence ? (
                  <div className="grid gap-2">
                    {latestJobEvidence.metrics.slice(0, 4).map((item) => (
                      <div
                        className={`rounded-xl border px-3 py-2 ${getEvidenceToneClasses(item.tone)}`}
                        key={item.label}
                      >
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {item.label}
                        </p>
                        <p className="mt-1 text-sm font-semibold tracking-tight">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  {latestJob.output_pack_id ? (
                    <Button asChild size="sm">
                      <Link href={`/dashboard/packs/${latestJob.output_pack_id}`}>
                        Open Pack
                      </Link>
                    </Button>
                  ) : null}
                  {canGeneratePack && latestJob.status === "FAILED" ? (
                    <form action={generateDraftPackAction.bind(null, requirement.id)}>
                      <PendingSubmitButton
                        idleLabel="Retry Generate"
                        pendingLabel="Retrying..."
                        size="sm"
                        variant="outline"
                      />
                    </form>
                  ) : null}
                </div>

                <details className="rounded-xl border bg-background/80 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium text-foreground">
                    Details and evidence
                  </summary>
                  <div className="mt-3 space-y-4">
                    <dl className="grid gap-3 rounded-md border bg-muted/20 p-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Job ID</dt>
                        <dd className="mt-1 flex flex-wrap items-center gap-2 font-mono text-foreground">
                          <span>{latestJob.id}</span>
                          <CopyTextButton
                            label="Copy ID"
                            size="sm"
                            value={latestJob.id}
                            variant="ghost"
                          />
                        </dd>
                      </div>
                      {latestJob.output_pack_id ? (
                        <div>
                          <dt className="text-muted-foreground">Pack ID</dt>
                          <dd className="mt-1 flex flex-wrap items-center gap-2 font-mono text-foreground">
                            <span>{latestJob.output_pack_id}</span>
                            <CopyTextButton
                              label="Copy Pack ID"
                              size="sm"
                              value={latestJob.output_pack_id}
                              variant="ghost"
                            />
                          </dd>
                        </div>
                      ) : null}
                      {latestJobMetadata?.ai_mode === "openai" && latestJobMetadata.ai ? (
                        <>
                          <div>
                            <dt className="text-muted-foreground">Critic verdict</dt>
                            <dd className="font-medium text-foreground">
                              {latestJobMetadata.ai.critic.verdict}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">OpenAPI grounding</dt>
                            <dd className="font-medium text-foreground">
                              {latestJobMetadata.ai.grounding.openapi.status}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">OpenAPI artifact</dt>
                            <dd className="font-mono text-foreground">
                              {latestJobMetadata.ai.grounding.openapi.artifact_id ?? "n/a"}
                            </dd>
                          </div>
                        </>
                      ) : null}
                    </dl>

                    {latestJobEvidence?.notes.length ? (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {latestJobEvidence.notes.map((note) => (
                          <p key={note}>• {note}</p>
                        ))}
                      </div>
                    ) : null}

                    {latestJobMetadata?.ai_mode === "openai" &&
                    latestJobMetadata.ai &&
                    latestJobMetadata.ai.grounding.openapi.mismatches.length > 0 ? (
                      <div className="space-y-2 text-muted-foreground">
                        <p className="font-medium text-foreground">
                          Grounding mismatches
                        </p>
                        <ul className="list-disc space-y-1 pl-5">
                          {latestJobMetadata.ai.grounding.openapi.mismatches.map(
                            (mismatch) => (
                              <li key={`${latestJob.id}-${mismatch.check_id}`}>
                                {mismatch.check_id}: {mismatch.reason}
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    ) : null}

                    {latestJob.status === "FAILED" && latestJob.error ? (
                      <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-xs">
                        <p className="font-medium text-destructive">
                          {latestJobFailure.description}
                        </p>
                        <p className="mt-1 text-destructive/90">
                          {latestJob.error.slice(0, 320)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </details>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                No generation jobs yet. Use Generate Draft Pack to create the first
                run, then watch the latest result update here.
              </p>
            )}

            <JobsAutoRefresh enabled={shouldAutoRefreshJobs} />
          </div>

          {historicalJobs.length > 0 ? (
            <div className="rounded-[1.5rem] border bg-background p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">Recent history</h2>
                <p className="text-xs text-muted-foreground">Most recent first</p>
              </div>
              <div className="mt-4 space-y-2">
                {historicalJobs.map((job) => {
                  const metadata = readGeneratePackJobMetadata(job.metadata_json);
                  const failure = getGeneratePackJobFailurePresentation(job.error);

                  return (
                    <div
                      className="rounded-xl border px-3 py-3"
                      key={job.id}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={getJobBadgeVariant(job.status)}>
                          {job.status}
                        </Badge>
                        {job.status === "FAILED" ? (
                          <Badge variant="destructive">{failure.label}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{job.created_at.toLocaleString()}</span>
                        <span>•</span>
                        <span className="font-mono">{job.id}</span>
                      </div>
                      {job.status === "FAILED" && job.error ? (
                        <p className="mt-2 text-xs text-destructive">
                          {failure.description}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <CopyTextButton
                          label="Copy ID"
                          size="sm"
                          value={job.id}
                          variant="ghost"
                        />
                        {job.output_pack_id ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/dashboard/packs/${job.output_pack_id}`}>
                              Open Pack
                            </Link>
                          </Button>
                        ) : null}
                        {metadata?.ai_mode === "openai" && metadata.ai ? (
                          <Badge variant="outline">
                            {metadata.ai.grounding.openapi.status}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
