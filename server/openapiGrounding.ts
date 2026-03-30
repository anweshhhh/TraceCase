import "server-only";
import { db } from "@/lib/db";
import {
  readArtifactParseSummary,
  type OpenApiArtifactParseSummary,
} from "@/lib/requirementArtifacts";

type ValidOpenApiParseSummary = Extract<
  OpenApiArtifactParseSummary,
  { status: "valid" }
>;

type OpenApiArtifactLookup = {
  id: string;
  metadata_json: unknown;
  updated_at: Date;
  created_at: Date;
};

export type ValidOpenApiArtifactForSnapshot = OpenApiArtifactLookup & {
  parse_summary: ValidOpenApiParseSummary;
};

export type OpenApiGroundingSummary = {
  artifact_id: string;
  operations_count: number;
  operations: Array<{ method: string; path: string }>;
};

function sortOperations(
  operations: Array<{ method: string; path: string }>,
): Array<{ method: string; path: string }> {
  return [...operations].sort((left, right) => {
    if (left.path === right.path) {
      return left.method.localeCompare(right.method);
    }

    return left.path.localeCompare(right.path);
  });
}

export async function getLatestValidOpenApiArtifactForSnapshot(
  workspaceId: string,
  snapshotId: string,
): Promise<ValidOpenApiArtifactForSnapshot | null> {
  const artifacts = await db.requirementArtifact.findMany({
    where: {
      workspace_id: workspaceId,
      requirement_snapshot_id: snapshotId,
      type: "OPENAPI",
    },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }, { id: "desc" }],
    select: {
      id: true,
      metadata_json: true,
      updated_at: true,
      created_at: true,
    },
  });

  for (const artifact of artifacts) {
    const parseSummary = readArtifactParseSummary(artifact.metadata_json);

    if (
      parseSummary?.artifact_type === "OPENAPI" &&
      parseSummary.status === "valid"
    ) {
      return {
        ...artifact,
        parse_summary: parseSummary,
      };
    }
  }

  return null;
}

export function getOpenApiGroundingSummary(
  artifact: ValidOpenApiArtifactForSnapshot,
): OpenApiGroundingSummary {
  const operations = sortOperations(
    artifact.parse_summary.operations.map((operation) => ({
      method: operation.method.trim().toLowerCase(),
      path: operation.path.trim(),
    })),
  );

  return {
    artifact_id: artifact.id,
    operations_count: operations.length,
    operations,
  };
}
