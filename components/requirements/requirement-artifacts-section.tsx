import { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { readArtifactParseSummary } from "@/lib/requirementArtifacts";
import { can, requireRoleMin } from "@/server/authz";
import { listRequirementArtifacts } from "@/server/requirementArtifacts";
import { RequirementArtifactsPanel } from "@/components/requirements/requirement-artifacts-panel";

type RequirementArtifactsSectionProps = {
  requirementId: string;
};

export async function RequirementArtifactsSection({
  requirementId,
}: RequirementArtifactsSectionProps) {
  const { workspace, membership } = await requireRoleMin(Role.REVIEWER);
  const latestSnapshot = await db.requirementSnapshot.findFirst({
    where: {
      workspace_id: workspace.id,
      requirement_id: requirementId,
    },
    orderBy: {
      version: "desc",
    },
    select: {
      id: true,
      version: true,
    },
  });

  const artifacts = latestSnapshot
    ? await listRequirementArtifacts(workspace.id, latestSnapshot.id)
    : [];

  return (
    <div className="rounded-lg border bg-background p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Artifacts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste OpenAPI specs or Prisma schemas to ground the latest requirement snapshot.
          </p>
        </div>
        {latestSnapshot ? (
          <Badge variant="outline">Latest Snapshot v{latestSnapshot.version}</Badge>
        ) : null}
      </div>

      <RequirementArtifactsPanel
        artifacts={artifacts.map((artifact) => ({
          id: artifact.id,
          type: artifact.type,
          title: artifact.title,
          content_text: artifact.content_text,
          content_hash: artifact.content_hash,
          updated_at_label: artifact.updated_at.toLocaleString(),
          parse_summary: readArtifactParseSummary(artifact.metadata_json),
        }))}
        canEdit={can(membership.role, "requirement:edit")}
        snapshotId={latestSnapshot?.id ?? null}
        snapshotVersion={latestSnapshot?.version ?? null}
      />
    </div>
  );
}
