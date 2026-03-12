import { z } from "zod";
import type { CanonicalPackContent } from "@/server/packs/validatePack";
import type { ArtifactParseSummary } from "@/lib/requirementArtifacts";
import type { RequirementArtifactTypeValue } from "@/lib/validators/requirementArtifacts";

const openApiGroundingSchema = z.object({
  status: z.enum(["grounded", "needs_repair", "skipped", "failed"]),
  artifact_id: z.string().nullable(),
  operations_available: z.number().int().min(0),
  api_checks_total: z.number().int().min(0),
  api_checks_grounded: z.number().int().min(0),
  mismatches: z.array(
    z.object({
      check_id: z.string().min(1),
      method: z.string().nullable(),
      endpoint: z.string().nullable(),
      reason: z.string().min(1),
    }),
  ),
});

const openAiGenerationMetadataSchema = z.object({
  ai_mode: z.literal("openai"),
  ai: z.object({
    provider: z.literal("openai"),
    model: z.string().min(1),
    attempts: z.number().int().min(1),
    critic: z.object({
      verdict: z.enum(["pass", "needs_work"]),
      coverage: z.object({
        acceptance_criteria_total: z.number().int().min(0),
        acceptance_criteria_covered: z.number().int().min(0),
        uncovered: z.array(
          z.object({
            criterion: z.string().min(1),
            why_uncovered: z.string().min(1),
          }),
        ),
      }),
      major_risks: z.array(z.string()),
      quality_notes: z.array(z.string()),
    }),
    grounding: z.object({
      openapi: openApiGroundingSchema,
    }),
    token_usage: z
      .object({
        input_tokens: z.number().int().min(0),
        output_tokens: z.number().int().min(0),
        total_tokens: z.number().int().min(0),
      })
      .optional(),
  }),
});

const placeholderGenerationMetadataSchema = z.object({
  ai_mode: z.literal("placeholder"),
});

const generatePackJobMetadataSchema = z.union([
  openAiGenerationMetadataSchema,
  placeholderGenerationMetadataSchema,
]);

export type GeneratePackJobMetadata = z.infer<
  typeof generatePackJobMetadataSchema
>;

export type JobFailurePresentation = {
  label: string;
  description: string;
};

export type ArtifactReadinessItem = {
  type: RequirementArtifactTypeValue;
  status: "valid" | "invalid" | "missing" | "unknown";
  label: string;
  note: string;
};

function truncateLine(value: string, maxLength = 140) {
  const firstLine = value.split(/\r\n|\n/, 1)[0] ?? value;
  return firstLine.length > maxLength
    ? `${firstLine.slice(0, maxLength - 1)}…`
    : firstLine;
}

export function readGeneratePackJobMetadata(
  metadataJson: unknown,
): GeneratePackJobMetadata | null {
  const result = generatePackJobMetadataSchema.safeParse(metadataJson);

  return result.success ? result.data : null;
}

export function getGeneratePackJobFailurePresentation(
  error: string | null | undefined,
): JobFailurePresentation {
  const normalized = error?.toLowerCase() ?? "";

  if (normalized.includes("econnrefused") || normalized.includes("dispatch")) {
    return {
      label: "Dispatch issue",
      description: "The background worker could not be reached. Restart the app and Inngest dev worker, then retry.",
    };
  }

  if (normalized.includes("timed out") || normalized.includes("worker stopped")) {
    return {
      label: "Worker interrupted",
      description: "Generation started but the worker did not finish cleanly. Retry once the worker is stable.",
    };
  }

  if (normalized.includes("grounded openapi artifact")) {
    return {
      label: "Grounding mismatch",
      description: "Generated API checks still referenced operations outside the grounded OpenAPI artifact after repair.",
    };
  }

  if (normalized.includes("acceptance criteria")) {
    return {
      label: "Coverage issue",
      description: "The repaired pack still missed requirement coverage and was rejected before save.",
    };
  }

  if (normalized.includes("validation")) {
    return {
      label: "Validation issue",
      description: "The generated content did not satisfy deterministic pack validation.",
    };
  }

  return {
    label: "Generation error",
    description: truncateLine(error ?? "Unknown generation error."),
  };
}

export function buildArtifactGroundingReadiness(
  artifacts: Array<{
    type: RequirementArtifactTypeValue;
    parse_summary: ArtifactParseSummary | null;
  }>,
): ArtifactReadinessItem[] {
  const types: RequirementArtifactTypeValue[] = ["OPENAPI", "PRISMA_SCHEMA"];

  return types.map((type) => {
    const latest = artifacts.find((artifact) => artifact.type === type) ?? null;
    const label = type === "OPENAPI" ? "OpenAPI" : "Prisma";

    if (!latest) {
      return {
        type,
        status: "missing" as const,
        label,
        note:
          type === "OPENAPI"
            ? "No artifact on the latest snapshot. API grounding will be skipped."
            : "No artifact on the latest snapshot.",
      };
    }

    const parseSummary = latest.parse_summary;

    if (!parseSummary) {
      return {
        type,
        status: "unknown" as const,
        label,
        note: "Parse state is unavailable. Re-save the artifact to refresh its summary.",
      };
    }

    if (parseSummary.status === "valid") {
      return {
        type,
        status: "valid" as const,
        label,
        note:
          parseSummary.artifact_type === "OPENAPI"
            ? `${parseSummary.operations_count} grounded operations available.`
            : `${parseSummary.model_count} models available for upcoming SQL grounding.`,
      };
    }

    return {
      type,
      status: "invalid" as const,
      label,
      note:
        parseSummary.errors[0] ??
        (type === "OPENAPI" ? "Invalid spec." : "Invalid schema."),
    };
  });
}

export function buildPackOverview(content: CanonicalPackContent) {
  return [
    {
      label: "Scenarios",
      value: content.scenarios.length,
    },
    {
      label: "Test Cases",
      value: content.test_cases.length,
    },
    {
      label: "API Checks",
      value: content.checks.api.length,
    },
    {
      label: "SQL Checks",
      value: content.checks.sql.length,
    },
    {
      label: "ETL Checks",
      value: content.checks.etl.length,
    },
    {
      label: "Questions",
      value: content.clarifying_questions.length,
    },
  ] as const;
}

export function buildPackReviewHighlights(input: {
  content: CanonicalPackContent;
  metadata: GeneratePackJobMetadata | null;
}) {
  return {
    clarifyingQuestions: input.content.clarifying_questions.map((question) => ({
      id: question.id,
      question: question.question,
      reason: question.reason ?? null,
    })),
    assumptions: input.content.assumptions,
    majorRisks:
      input.metadata?.ai_mode === "openai"
        ? input.metadata.ai.critic.major_risks
        : [],
    qualityNotes:
      input.metadata?.ai_mode === "openai"
        ? input.metadata.ai.critic.quality_notes
        : [],
  };
}
