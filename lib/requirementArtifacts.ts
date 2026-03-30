import {
  getRequirementArtifactDefaultTitle,
  getRequirementArtifactTypeLabel,
  hashArtifactText,
  normalizeArtifactText,
} from "@/lib/artifacts";
import {
  requirementArtifactPayloadSchema,
  type RequirementArtifactPayload,
  type RequirementArtifactTypeValue,
} from "@/lib/validators/requirementArtifacts";
import { z } from "zod";

export type OpenApiArtifactParseSummary =
  | {
      status: "valid";
      artifact_type: "OPENAPI";
      format: "yaml" | "json";
      openapi_version: string | null;
      operations_count: number;
      operations: Array<{ method: string; path: string }>;
      errors: [];
      parsed_at: string;
    }
  | {
      status: "invalid";
      artifact_type: "OPENAPI";
      format: "yaml" | "json" | "unknown";
      openapi_version: string | null;
      operations_count: 0;
      operations: [];
      errors: string[];
      parsed_at: string;
    };

export type PrismaSchemaArtifactParseSummary =
  | {
      status: "valid";
      artifact_type: "PRISMA_SCHEMA";
      model_count: number;
      models: Array<{
        name: string;
        fields: Array<{ name: string; type: string }>;
      }>;
      errors: [];
      parsed_at: string;
    }
  | {
      status: "invalid";
      artifact_type: "PRISMA_SCHEMA";
      model_count: 0;
      models: [];
      errors: string[];
      parsed_at: string;
    };

export type ArtifactParseSummary =
  | OpenApiArtifactParseSummary
  | PrismaSchemaArtifactParseSummary;

const artifactParseSummarySchema = z.union([
  z.object({
    status: z.literal("valid"),
    artifact_type: z.literal("OPENAPI"),
    format: z.enum(["yaml", "json"]),
    openapi_version: z.string().nullable(),
    operations_count: z.number().int().min(0),
    operations: z.array(
      z.object({
        method: z.string().trim().min(1),
        path: z.string().trim().min(1),
      }),
    ),
    errors: z.array(z.string()).max(0),
    parsed_at: z.string().min(1),
  }),
  z.object({
    status: z.literal("invalid"),
    artifact_type: z.literal("OPENAPI"),
    format: z.enum(["yaml", "json", "unknown"]),
    openapi_version: z.string().nullable(),
    operations_count: z.literal(0),
    operations: z
      .array(
        z.object({
          method: z.string().trim().min(1),
          path: z.string().trim().min(1),
        }),
      )
      .max(0),
    errors: z.array(z.string().trim().min(1)).min(1),
    parsed_at: z.string().min(1),
  }),
  z.object({
    status: z.literal("valid"),
    artifact_type: z.literal("PRISMA_SCHEMA"),
    model_count: z.number().int().min(0),
    models: z.array(
      z.object({
        name: z.string().trim().min(1),
        fields: z.array(
          z.object({
            name: z.string().trim().min(1),
            type: z.string().trim().min(1),
          }),
        ),
      }),
    ),
    errors: z.array(z.string()).max(0),
    parsed_at: z.string().min(1),
  }),
  z.object({
    status: z.literal("invalid"),
    artifact_type: z.literal("PRISMA_SCHEMA"),
    model_count: z.literal(0),
    models: z
      .array(
        z.object({
          name: z.string().trim().min(1),
          fields: z.array(
            z.object({
              name: z.string().trim().min(1),
              type: z.string().trim().min(1),
            }),
          ),
        }),
      )
      .max(0),
    errors: z.array(z.string().trim().min(1)).min(1),
    parsed_at: z.string().min(1),
  }),
]);

export function prepareRequirementArtifactForWrite(
  payload: RequirementArtifactPayload,
) {
  const parsedPayload = requirementArtifactPayloadSchema.parse(payload);
  const contentText = normalizeArtifactText(parsedPayload.content_text);

  return {
    type: parsedPayload.type,
    title:
      parsedPayload.title?.trim() ||
      getRequirementArtifactDefaultTitle(parsedPayload.type),
    content_text: contentText,
    content_hash: hashArtifactText(contentText),
    mime_type: "text/plain",
  } as const;
}

export function readArtifactParseSummary(
  metadataJson: unknown,
): ArtifactParseSummary | null {
  const result = artifactParseSummarySchema.safeParse(metadataJson);

  return result.success ? (result.data as ArtifactParseSummary) : null;
}

export function buildRequirementArtifactAuditMetadata(artifact: {
  id: string;
  requirement_snapshot_id: string;
  type: RequirementArtifactTypeValue;
  content_hash: string;
  title: string;
}) {
  return {
    artifact_id: artifact.id,
    snapshot_id: artifact.requirement_snapshot_id,
    type: artifact.type,
    content_hash: artifact.content_hash,
    title: artifact.title,
  } as const;
}

export type RequirementArtifactPanelInput = {
  id: string;
  type: RequirementArtifactTypeValue;
  title: string;
  content_text: string;
  content_hash: string;
  updated_at_label: string;
  parse_summary: ArtifactParseSummary | null;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function buildRequirementArtifactParseView(
  type: RequirementArtifactTypeValue,
  parseSummary: ArtifactParseSummary | null,
) {
  const summaryLabel = type === "OPENAPI" ? "OpenAPI" : "Prisma schema";

  if (!parseSummary) {
    return {
      parseStatus: "unknown" as const,
      parseStatusLabel: "Unknown",
      parseSummaryText: `${summaryLabel} parse state unavailable`,
      parseErrorPreview: null,
    };
  }

  if (parseSummary.artifact_type === "OPENAPI") {
    if (parseSummary.status === "valid") {
      return {
        parseStatus: "valid" as const,
        parseStatusLabel: "Valid",
        parseSummaryText: `${summaryLabel} valid • ${parseSummary.operations_count} ${pluralize(parseSummary.operations_count, "operation")}`,
        parseErrorPreview: null,
      };
    }

    return {
      parseStatus: "invalid" as const,
      parseStatusLabel: "Invalid",
      parseSummaryText: `${summaryLabel} invalid • Invalid spec`,
      parseErrorPreview: parseSummary.errors[0] ?? null,
    };
  }

  if (parseSummary.status === "valid") {
    return {
      parseStatus: "valid" as const,
      parseStatusLabel: "Valid",
      parseSummaryText: `${summaryLabel} valid • ${parseSummary.model_count} ${pluralize(parseSummary.model_count, "model")}`,
      parseErrorPreview: null,
    };
  }

  return {
    parseStatus: "invalid" as const,
    parseStatusLabel: "Invalid",
    parseSummaryText: `${summaryLabel} invalid • Invalid schema`,
    parseErrorPreview: parseSummary.errors[0] ?? null,
  };
}

export function buildRequirementArtifactsPanelViewModel({
  artifacts,
  canEdit,
}: {
  artifacts: RequirementArtifactPanelInput[];
  canEdit: boolean;
}) {
  const items = artifacts.map((artifact) => ({
    ...artifact,
    typeLabel: getRequirementArtifactTypeLabel(artifact.type),
    hashPrefix: artifact.content_hash.slice(0, 8),
    updatedLabel: artifact.updated_at_label.trim() || "recently",
    ...buildRequirementArtifactParseView(artifact.type, artifact.parse_summary),
    canEdit,
    canDelete: canEdit,
  }));

  return {
    items,
    emptyMessage:
      items.length === 0
        ? "No artifacts saved for the latest snapshot yet."
        : null,
  };
}
