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

export type GenerationJobSummary = {
  title: string;
  description: string;
  tone: "default" | "secondary" | "destructive";
};

export type GenerationEvidenceMetric = {
  label: string;
  value: string;
  tone: "default" | "secondary" | "destructive";
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

export function buildGenerationJobSummary(input: {
  status: string;
  metadata: GeneratePackJobMetadata | null;
  error?: string | null;
}): GenerationJobSummary {
  if (input.status === "FAILED") {
    const failure = getGeneratePackJobFailurePresentation(input.error);

    return {
      title: failure.label,
      description: failure.description,
      tone: "destructive",
    };
  }

  if (input.status === "RUNNING") {
    return {
      title: "Generation in progress",
      description:
        "OpenAI generation can take a few minutes, especially when repair or grounding is active. Keep this page open; status refreshes automatically.",
      tone: "secondary",
    };
  }

  if (input.status === "QUEUED") {
    return {
      title: "Waiting for worker",
      description: "The job has been queued and will start when the worker picks it up.",
      tone: "secondary",
    };
  }

  if (input.status === "SUCCEEDED") {
    if (input.metadata?.ai_mode === "openai") {
      const grounding = input.metadata.ai.grounding.openapi;
      const attemptSuffix = input.metadata.ai.attempts === 1 ? "" : "s";
      const groundingSummary =
        grounding.status === "skipped"
          ? "OpenAPI grounding skipped."
          : `Grounded API checks ${grounding.api_checks_grounded}/${grounding.api_checks_total}.`;

      return {
        title: "Draft ready",
        description: `${input.metadata.ai.model} completed in ${input.metadata.ai.attempts} attempt${attemptSuffix}. Critic ${input.metadata.ai.critic.verdict}; ${groundingSummary}`,
        tone: "default",
      };
    }

    if (input.metadata?.ai_mode === "placeholder") {
      return {
        title: "Draft ready",
        description: "Placeholder generation completed successfully.",
        tone: "default",
      };
    }

    return {
      title: "Draft ready",
      description: "Generation completed successfully.",
      tone: "default",
    };
  }

  return {
    title: "Generation updated",
    description: "Latest job state is available below.",
    tone: "secondary",
  };
}

export function buildGenerationEvidence(
  metadata: GeneratePackJobMetadata | null,
): {
  metrics: GenerationEvidenceMetric[];
  notes: string[];
} | null {
  if (!metadata) {
    return null;
  }

  if (metadata.ai_mode === "placeholder") {
    return {
      metrics: [
        {
          label: "Mode",
          value: "Placeholder",
          tone: "secondary",
        },
      ],
      notes: ["Placeholder mode does not include critic or grounding proof."],
    };
  }

  const grounding = metadata.ai.grounding.openapi;
  const coverage = metadata.ai.critic.coverage;
  const isCoverageComplete =
    coverage.acceptance_criteria_total === coverage.acceptance_criteria_covered;
  const metrics: GenerationEvidenceMetric[] = [
    {
      label: "Coverage",
      value: `${coverage.acceptance_criteria_covered}/${coverage.acceptance_criteria_total}`,
      tone: isCoverageComplete ? "default" : "destructive",
    },
    {
      label: "Attempts",
      value: String(metadata.ai.attempts),
      tone: metadata.ai.attempts > 1 ? "secondary" : "default",
    },
    {
      label: "Grounding",
      value: grounding.status,
      tone:
        grounding.status === "grounded"
          ? "default"
          : grounding.status === "skipped"
            ? "secondary"
            : "destructive",
    },
    {
      label: "API Checks",
      value:
        grounding.status === "skipped"
          ? String(grounding.api_checks_total)
          : `${grounding.api_checks_grounded}/${grounding.api_checks_total}`,
      tone:
        grounding.status === "grounded" || grounding.status === "skipped"
          ? "default"
          : "destructive",
    },
    {
      label: "Operations",
      value: String(grounding.operations_available),
      tone: "secondary",
    },
  ];

  const notes: string[] = [];

  if (grounding.status === "grounded" && grounding.artifact_id) {
    notes.push(
      `Grounded against OpenAPI artifact ${grounding.artifact_id.slice(0, 8)}.`,
    );
  } else if (grounding.status === "skipped") {
    notes.push("No valid OpenAPI artifact was available for this snapshot.");
  } else if (grounding.status === "failed" || grounding.status === "needs_repair") {
    notes.push("Grounding mismatches remained after validation.");
  }

  if (metadata.ai.attempts > 1) {
    notes.push("One repair loop was used before the final result was stored.");
  }

  if (metadata.ai.critic.major_risks[0]) {
    notes.push(`Top critic risk: ${truncateLine(metadata.ai.critic.major_risks[0], 120)}`);
  }

  return {
    metrics,
    notes,
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
