import "server-only";
import { db } from "@/lib/db";
import {
  readArtifactParseSummary,
  type PrismaSchemaArtifactParseSummary,
} from "@/lib/requirementArtifacts";

type ValidPrismaParseSummary = Extract<
  PrismaSchemaArtifactParseSummary,
  { status: "valid" }
>;

type PrismaArtifactLookup = {
  id: string;
  metadata_json: unknown;
  updated_at: Date;
  created_at: Date;
};

export type ValidPrismaArtifactForSnapshot = PrismaArtifactLookup & {
  parse_summary: ValidPrismaParseSummary;
};

export type PrismaGroundingSummary = {
  artifact_id: string;
  model_count: number;
  models: Array<{
    name: string;
    fields: Array<{ name: string; type: string }>;
  }>;
};

function sortModels(
  models: Array<{
    name: string;
    fields: Array<{ name: string; type: string }>;
  }>,
) {
  return [...models]
    .map((model) => ({
      name: model.name.trim(),
      fields: [...model.fields]
        .map((field) => ({
          name: field.name.trim(),
          type: field.type.trim(),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getLatestValidPrismaArtifactForSnapshot(
  workspaceId: string,
  snapshotId: string,
): Promise<ValidPrismaArtifactForSnapshot | null> {
  const artifacts = await db.requirementArtifact.findMany({
    where: {
      workspace_id: workspaceId,
      requirement_snapshot_id: snapshotId,
      type: "PRISMA_SCHEMA",
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
      parseSummary?.artifact_type === "PRISMA_SCHEMA" &&
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

export function getPrismaGroundingSummary(
  artifact: ValidPrismaArtifactForSnapshot,
): PrismaGroundingSummary {
  const models = sortModels(artifact.parse_summary.models);

  return {
    artifact_id: artifact.id,
    model_count: models.length,
    models,
  };
}
