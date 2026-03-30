import { z } from "zod";
import type { CanonicalPackContent } from "@/server/packs/validatePack";
import {
  GENERATE_PACK_RUNTIME_STAGES,
  getGenerationStagePresentation,
} from "@/server/packs/generationRunContext";
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

const prismaGroundingSchema = z.object({
  status: z.enum(["grounded", "needs_repair", "skipped", "failed"]),
  artifact_id: z.string().nullable(),
  models_available: z.number().int().min(0),
  sql_checks_total: z.number().int().min(0),
  sql_checks_grounded: z.number().int().min(0),
  sql_checks_semantic: z.number().int().min(0),
  mismatches: z.array(
    z.object({
      check_id: z.string().min(1),
      reason: z.string().min(1),
      referenced_models: z.array(z.string()),
      referenced_fields: z.array(z.string()),
    }),
  ),
});

const runtimeStageEvidenceSchema = z.object({
  stage: z.enum(GENERATE_PACK_RUNTIME_STAGES),
  attempt: z.number().int().min(1).optional(),
  entered_at: z.string().datetime(),
  exited_at: z.string().datetime().optional(),
  duration_ms: z.number().int().min(0).optional(),
  status: z.enum(["entered", "succeeded", "failed", "skipped"]),
  provider_call: z.boolean().optional(),
  model: z.string().nullable().optional(),
  timeout_ms: z.number().int().min(1).nullable().optional(),
  requirement_chars: z.number().int().min(0).optional(),
  requirement_lines: z.number().int().min(0).optional(),
  openapi_operations_count: z.number().int().min(0).optional(),
  prisma_models_count: z.number().int().min(0).optional(),
  pack_api_checks_count: z.number().int().min(0).optional(),
  pack_sql_checks_count: z.number().int().min(0).optional(),
  semantic_sql_checks_count: z.number().int().min(0).optional(),
  mismatch_count: z.number().int().min(0).optional(),
  note: z.string().optional(),
});

const runtimeMetadataSchema = z.object({
  version: z.literal(1).optional(),
  current_stage: z.enum(GENERATE_PACK_RUNTIME_STAGES).optional(),
  current_attempt: z.number().int().min(1).optional(),
  stages: z.array(runtimeStageEvidenceSchema).optional(),
  repair_entered: z.boolean().optional(),
  critic_entered: z.boolean().optional(),
  repair_critic_entered: z.boolean().optional(),
  workflow_deadline_at: z.string().datetime().nullable().optional(),
  final_outcome: z
    .enum([
      "succeeded",
      "provider_timeout",
      "workflow_deadline",
      "critic_coverage",
      "openapi_grounding",
      "prisma_grounding",
      "validation",
      "dispatch",
      "unknown",
    ])
    .optional(),
  final_failure_stage: z
    .enum(GENERATE_PACK_RUNTIME_STAGES)
    .nullable()
    .optional(),
  final_failure_message: z.string().nullable().optional(),
  last_provider_stage: z
    .enum(GENERATE_PACK_RUNTIME_STAGES)
    .nullable()
    .optional(),
  status: z.enum(["running", "failed", "succeeded"]),
  stage: z.enum(GENERATE_PACK_RUNTIME_STAGES),
  attempt: z.number().int().min(1),
  started_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deadline_at: z.string().datetime(),
  generation_model: z.string().min(1),
  critic_model: z.string().min(1),
});

const openAiMetadataPayloadSchema = z.object({
  provider: z.literal("openai"),
  model: z.string().min(1),
  critic_model: z.string().min(1).optional(),
  attempts: z.number().int().min(1),
  coverage_plan: z
    .object({
      acceptance_criteria_total: z.number().int().min(0),
      items: z.array(
        z.object({
          id: z.string().min(1),
          text: z.string().min(1),
          expected_layers: z.array(
            z.enum(["UI", "API", "SQL", "AUDIT", "SECURITY", "SESSION", "OTHER"]),
          ),
        }),
      ),
    })
    .optional(),
  coverage_map: z
    .object({
      total: z.number().int().min(0),
      covered: z.number().int().min(0),
      uncovered_ids: z.array(z.string().min(1)),
    })
    .optional(),
  coverage_closure_plan: z
    .object({
      uncovered_ids: z.array(z.string().min(1)),
      obligations: z.array(
        z.object({
          id: z.string().min(1),
          required_action: z.enum([
            "add_ui_case",
            "add_api_case_or_check",
            "add_sql_case_or_check",
            "add_audit_or_logging_check",
            "add_session_case_or_check",
            "strengthen_existing_coverage",
          ]),
          expected_layers: z.array(
            z.enum(["UI", "API", "SQL", "AUDIT", "SECURITY", "SESSION", "OTHER"]),
          ),
        }),
      ),
    })
    .optional(),
  coverage_closure_validation: z
    .object({
      status: z.enum(["closed", "still_incomplete"]),
      still_unclosed: z.array(
        z.object({
          id: z.string().min(1),
          reason: z.string().min(1),
        }),
      ),
    })
    .optional(),
  sanitization: z
    .object({
      initial: z
        .object({
          fixes_applied_count: z.number().int().min(0),
          kinds: z.array(
            z.enum([
              "source_ref_range_swapped",
              "api_method_normalized",
              "trimmed_text",
            ]),
          ),
        })
        .optional(),
      repair: z
        .object({
          fixes_applied_count: z.number().int().min(0),
          kinds: z.array(
            z.enum([
              "source_ref_range_swapped",
              "api_method_normalized",
              "trimmed_text",
            ]),
          ),
        })
        .optional(),
    })
    .optional(),
  compensating_coverage: z
    .object({
      status: z.enum(["sufficient", "insufficient"]),
      issues: z.array(
        z.object({
          id: z.string().min(1),
          reason: z.string().min(1),
        }),
      ),
    })
    .optional(),
  critic: z.object({
    phase: z.enum(["initial", "repair"]).optional(),
    verdict: z.enum(["pass", "needs_work"]),
    coverage: z.object({
      acceptance_criteria_total: z.number().int().min(0),
      acceptance_criteria_covered: z.number().int().min(0),
      uncovered: z.array(
        z.object({
          id: z.string().min(1).optional(),
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
    prisma: prismaGroundingSchema,
  }),
  token_usage: z
    .object({
      input_tokens: z.number().int().min(0),
      output_tokens: z.number().int().min(0),
      total_tokens: z.number().int().min(0),
    })
    .optional(),
});

const openAiGenerationMetadataSchema = z
  .object({
    ai_mode: z.literal("openai"),
    ai: openAiMetadataPayloadSchema.optional(),
    runtime: runtimeMetadataSchema.optional(),
  })
  .refine((value) => Boolean(value.ai || value.runtime), {
    message: "OpenAI generation metadata requires ai or runtime details.",
  });

const placeholderGenerationMetadataSchema = z.object({
  ai_mode: z.literal("placeholder"),
  runtime: runtimeMetadataSchema.optional(),
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

export type GenerationEvidence = {
  metrics: GenerationEvidenceMetric[];
  notes: string[];
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
  metadata?: GeneratePackJobMetadata | null,
): JobFailurePresentation {
  const normalized = error?.toLowerCase() ?? "";
  const runtimeStage =
    metadata?.ai_mode === "openai"
      ? metadata.runtime?.final_failure_stage ?? metadata.runtime?.stage
      : undefined;
  const runtimeStageLabel = runtimeStage
    ? getGenerationStagePresentation(runtimeStage).title.toLowerCase()
    : "generation";
  const runtimeOutcome =
    metadata?.ai_mode === "openai" ? metadata.runtime?.final_outcome : undefined;

  if (runtimeOutcome === "workflow_deadline" || normalized.includes("workflow deadline")) {
    return {
      label: "Workflow deadline exceeded",
      description: `Generation hit the 12-minute workflow deadline during ${runtimeStageLabel}. Retry once; if it repeats, reduce grounding/context size or use a stronger generation model.`,
    };
  }

  if (
    runtimeOutcome === "dispatch" ||
    normalized.includes("econnrefused") ||
    normalized.includes("dispatch")
  ) {
    return {
      label: "Dispatch issue",
      description:
        "The background worker could not be reached. Restart the app and Inngest dev worker, then retry.",
    };
  }

  if (runtimeOutcome === "provider_timeout" || normalized.includes("openai request timed out")) {
    const providerStage =
      metadata?.ai_mode === "openai" && metadata.runtime?.last_provider_stage
        ? getGenerationStagePresentation(metadata.runtime.last_provider_stage).title.toLowerCase()
        : runtimeStageLabel;

    return {
      label: "AI provider timeout",
      description: `The OpenAI request took too long and was aborted during ${providerStage}. Retry once; if it repeats, try again later or reduce grounding/context size.`,
    };
  }

  if (normalized.includes("timed out") || normalized.includes("worker stopped")) {
    return {
      label: "Worker interrupted",
      description:
        "Generation started but the worker did not finish cleanly. Retry once the worker is stable.",
    };
  }

  if (runtimeOutcome === "openapi_grounding" || normalized.includes("grounded openapi artifact")) {
    return {
      label: "Grounding mismatch",
      description:
        "Generated API checks still referenced operations outside the grounded OpenAPI artifact after repair.",
    };
  }

  if (runtimeOutcome === "prisma_grounding" || normalized.includes("grounded prisma schema")) {
    return {
      label: "Grounding mismatch",
      description:
        "Generated SQL checks still referenced Prisma models or fields outside the grounded schema after repair.",
    };
  }

  if (runtimeOutcome === "critic_coverage" || normalized.includes("acceptance criteria")) {
    return {
      label: "Coverage issue",
      description:
        "The repaired pack still missed requirement coverage and was rejected before save.",
    };
  }

  if (runtimeOutcome === "validation" || normalized.includes("validation")) {
    return {
      label: "Validation issue",
      description:
        "The generated content did not satisfy deterministic pack validation.",
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
    const failure = getGeneratePackJobFailurePresentation(
      input.error,
      input.metadata,
    );

    return {
      title: failure.label,
      description: failure.description,
      tone: "destructive",
    };
  }

  if (input.status === "RUNNING") {
    if (input.metadata?.ai_mode === "openai" && input.metadata.runtime) {
      const stagePresentation = getGenerationStagePresentation(
        input.metadata.runtime.stage,
      );

      return {
        title: stagePresentation.title,
        description: stagePresentation.description,
        tone: "secondary",
      };
    }

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
      description:
        "The job has been queued and will start when the worker picks it up.",
      tone: "secondary",
    };
  }

  if (input.status === "SUCCEEDED") {
    if (input.metadata?.ai_mode === "openai" && input.metadata.ai) {
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
): GenerationEvidence | null {
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

  if (!metadata.ai) {
    return null;
  }

  const grounding = metadata.ai.grounding.openapi;
  const prismaGrounding = metadata.ai.grounding.prisma;
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
    {
      label: "SQL Checks",
      value:
        prismaGrounding.status === "skipped"
          ? String(prismaGrounding.sql_checks_total)
          : `${prismaGrounding.sql_checks_grounded}/${prismaGrounding.sql_checks_total}`,
      tone:
        prismaGrounding.status === "grounded" ||
        prismaGrounding.status === "skipped"
          ? "default"
          : "destructive",
    },
  ];

  const notes: string[] = [];

  if (grounding.status === "grounded" && grounding.artifact_id) {
    notes.push(
      `Grounded against OpenAPI artifact ${grounding.artifact_id.slice(0, 8)}.`,
    );
  } else if (grounding.status === "skipped") {
    notes.push("No valid OpenAPI artifact was available for this snapshot.");
  } else if (
    grounding.status === "failed" ||
    grounding.status === "needs_repair"
  ) {
    notes.push("Grounding mismatches remained after validation.");
  }

  if (prismaGrounding.status === "grounded" && prismaGrounding.artifact_id) {
    notes.push(
      `Grounded against Prisma artifact ${prismaGrounding.artifact_id.slice(0, 8)}.`,
    );
  } else if (prismaGrounding.status === "skipped") {
    notes.push("No valid Prisma artifact was available for SQL grounding.");
  } else if (
    prismaGrounding.status === "failed" ||
    prismaGrounding.status === "needs_repair"
  ) {
    notes.push("Concrete SQL checks still needed schema mapping after repair.");
  }

  if (metadata.ai.attempts > 1) {
    notes.push("One repair loop was used before the final result was stored.");
  }

  if (metadata.ai.critic.major_risks[0]) {
    notes.push(
      `Top critic risk: ${truncateLine(metadata.ai.critic.major_risks[0], 120)}`,
    );
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
      input.metadata?.ai_mode === "openai" && input.metadata.ai
        ? input.metadata.ai.critic.major_risks
        : [],
    qualityNotes:
      input.metadata?.ai_mode === "openai" && input.metadata.ai
        ? input.metadata.ai.critic.quality_notes
        : [],
  };
}
