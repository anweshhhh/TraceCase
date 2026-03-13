import type { Requirement, RequirementSnapshot } from "@prisma/client";
import type { OpenApiGroundingSummary } from "@/server/openapiGrounding";
import type { PrismaGroundingSummary } from "@/server/prismaGrounding";
import type { PackContentInput } from "@/server/packs/packSchema";
import packSchemaJson from "@/server/packs/schema/pack.schema.json";
import {
  PackValidationError,
  validatePackContent,
  type CanonicalPackContent,
} from "@/server/packs/validatePack";
import {
  validateOpenApiGrounding,
  type OpenApiGroundingReport,
} from "@/server/packs/validateOpenApiGrounding";
import {
  downgradeSqlChecksToSemantic,
  validatePrismaGrounding,
  type PrismaGroundingReport,
} from "@/server/packs/validatePrismaGrounding";
import {
  type AiTokenUsage,
  type StructuredOutputRunner,
} from "@/server/ai/openaiClient";
import type { PackCriticReport } from "@/server/packs/critiquePack";

type AiRequirement = Pick<
  Requirement,
  "id" | "title" | "module_type" | "test_focus"
>;

type AiSnapshot = Pick<
  RequirementSnapshot,
  "id" | "version" | "source_hash" | "source_text"
>;

export type GenerateAiPackInput = {
  requirement: AiRequirement;
  snapshot: AiSnapshot;
  openApiGrounding?: OpenApiGroundingSummary | null;
  prismaGrounding?: PrismaGroundingSummary | null;
};

export type AiPackGenerationMetadata = {
  ai_mode: "openai";
  ai: {
    provider: "openai";
    model: string;
    attempts: number;
    critic: PackCriticReport;
    grounding: {
      openapi: OpenApiGroundingReport;
      prisma: PrismaGroundingReport;
    };
    token_usage?: AiTokenUsage;
  };
};

export type GenerateAiPackResult = {
  content: CanonicalPackContent;
  metadata: AiPackGenerationMetadata;
};

type GenerateAiPackOptions = {
  model?: string;
  provider?: "openai";
  runner?: StructuredOutputRunner;
  critic?: (input: {
    requirementSourceText: string;
    packContent: CanonicalPackContent;
    runner: StructuredOutputRunner;
    model?: string;
  }) => Promise<{
    report: PackCriticReport;
    model: string;
    usage?: AiTokenUsage;
  }>;
};

type RepairContext = {
  previousPack: unknown;
  validationIssues?: string[];
  critic?: PackCriticReport;
  grounding?: OpenApiGroundingReport;
  prisma?: PrismaGroundingReport;
};

const packSchema = packSchemaJson as { [key: string]: unknown };

const generationInstructions = [
  "You are TraceCase's QA pack generator.",
  "Generate a requirement-specific QA pack that strictly matches Pack JSON Schema v1.0.",
  "The pack must be grounded in the supplied requirement snapshot and must not contain generic placeholder cases.",
  "Each scenario, test case, and check should focus on concrete business rules, failure modes, state transitions, concurrency/idempotency behavior, validation behavior, side effects, or regression-sensitive behaviors that are supported by the source text.",
  "If the requirement is ambiguous, add a clarifying question instead of inventing product behavior.",
  "Use the provided snapshot id in every source reference and cite relevant line ranges from the numbered requirement text.",
  "Use sequential ids like Q-001, SCN-001, TC-001, CHK-API-001.",
  "Use sequential test step numbers starting at 1 for every test case.",
  "When OpenAPI grounding context is provided, concrete API checks must use only the listed HTTP method and path combinations.",
  "If the requirement mentions an endpoint or method that is absent from the grounding context, do not invent an alternative API check.",
  "When Prisma grounding context is provided, concrete SQL checks must use only the listed Prisma model and field names.",
  "If you cannot prove an exact Prisma schema mapping, emit a semantic SQL check by omitting query_hint and describing the DB verification intent as needing schema mapping before a concrete assertion.",
  "Return only the structured JSON object.",
].join(" ");

function buildLineMappedSource(sourceText: string) {
  return sourceText
    .split(/\r\n|\n/)
    .map((line, index) => `${index + 1} | ${line}`)
    .join("\n");
}

function formatList(items: string[]) {
  return items.length > 0 ? items.join(", ") : "UI, API, REGRESSION";
}

function formatIssueList(issues: string[]) {
  return issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n");
}

function formatOpenApiOperations(
  operations: Array<{ method: string; path: string }>,
) {
  return operations
    .map(
      (operation, index) =>
        `${index + 1}. ${operation.method.toUpperCase()} ${operation.path}`,
    )
    .join("\n");
}

function formatPrismaModels(
  models: Array<{
    name: string;
    fields: Array<{ name: string; type: string }>;
  }>,
) {
  return models
    .map((model, index) => {
      const fields = model.fields
        .map((field) => `${field.name}:${field.type}`)
        .join(", ");

      return `${index + 1}. ${model.name} -> ${fields}`;
    })
    .join("\n");
}

function formatGroundingMismatchList(
  mismatches: OpenApiGroundingReport["mismatches"],
) {
  return mismatches
    .map((mismatch, index) => {
      const operation =
        mismatch.method && mismatch.endpoint
          ? `${mismatch.method.toUpperCase()} ${mismatch.endpoint}`
          : "missing method or endpoint";

      return `${index + 1}. ${mismatch.check_id}: ${operation} - ${mismatch.reason}`;
    })
    .join("\n");
}

function formatPrismaMismatchList(
  mismatches: PrismaGroundingReport["mismatches"],
) {
  return mismatches
    .map(
      (mismatch, index) =>
        `${index + 1}. ${mismatch.check_id}: ${mismatch.reason} | models: ${
          mismatch.referenced_models.join(", ") || "none"
        } | fields: ${mismatch.referenced_fields.join(", ") || "none"}`,
    )
    .join("\n");
}

function mergeTokenUsage(
  current: AiTokenUsage | undefined,
  next: AiTokenUsage | undefined,
) {
  if (!next) {
    return current;
  }

  return {
    input_tokens: (current?.input_tokens ?? 0) + next.input_tokens,
    output_tokens: (current?.output_tokens ?? 0) + next.output_tokens,
    total_tokens: (current?.total_tokens ?? 0) + next.total_tokens,
  };
}

function needsCriticRepair(report: PackCriticReport) {
  return (
    report.verdict === "needs_work" ||
    report.coverage.acceptance_criteria_total === 0 ||
    report.coverage.acceptance_criteria_covered <
      report.coverage.acceptance_criteria_total ||
    report.coverage.uncovered.length > 0
  );
}

function needsGroundingRepair(report: OpenApiGroundingReport) {
  return report.status === "needs_repair";
}

function needsPrismaRepair(report: PrismaGroundingReport) {
  return report.status === "needs_repair";
}

function markGroundingReportFailed(
  report: OpenApiGroundingReport,
): OpenApiGroundingReport {
  return report.status === "needs_repair"
    ? {
        ...report,
        status: "failed",
      }
    : report;
}

function markPrismaGroundingReportFailed(
  report: PrismaGroundingReport,
): PrismaGroundingReport {
  return report.status === "needs_repair"
    ? {
        ...report,
        status: "failed",
      }
    : report;
}

function buildGenerationMetadata(input: {
  provider: "openai";
  model: string;
  attempts: number;
  critic: PackCriticReport;
  grounding: OpenApiGroundingReport;
  prisma: PrismaGroundingReport;
  tokenUsage?: AiTokenUsage;
}): AiPackGenerationMetadata {
  return {
    ai_mode: "openai",
    ai: {
      provider: input.provider,
      model: input.model,
      attempts: input.attempts,
      critic: input.critic,
      grounding: {
        openapi: input.grounding,
        prisma: input.prisma,
      },
      token_usage: input.tokenUsage,
    },
  };
}

export class AiPackGenerationError extends Error {
  metadata: AiPackGenerationMetadata;

  constructor(message: string, metadata: AiPackGenerationMetadata) {
    super(message);
    this.name = "AiPackGenerationError";
    this.metadata = metadata;
  }
}

function buildPackRequestInput(
  input: GenerateAiPackInput,
  repair?: RepairContext,
) {
  const { requirement, snapshot } = input;
  const sections = [
    "Requirement metadata:",
    `- requirement_id: ${requirement.id}`,
    `- title: ${requirement.title}`,
    `- module_type: ${requirement.module_type}`,
    `- test_focus: ${formatList(requirement.test_focus)}`,
    `- requirement_snapshot_id: ${snapshot.id}`,
    `- requirement_snapshot_version: ${snapshot.version}`,
    `- source_hash: ${snapshot.source_hash}`,
  ];

  if (input.openApiGrounding) {
    sections.push(
      "",
      "OpenAPI grounding context:",
      `- artifact_id: ${input.openApiGrounding.artifact_id}`,
      `- operations_count: ${input.openApiGrounding.operations_count}`,
      "Allowed API operations:",
      formatOpenApiOperations(input.openApiGrounding.operations),
    );
  }

  if (input.prismaGrounding) {
    sections.push(
      "",
      "Prisma grounding context:",
      `- artifact_id: ${input.prismaGrounding.artifact_id}`,
      `- model_count: ${input.prismaGrounding.model_count}`,
      "Grounded Prisma models and fields:",
      formatPrismaModels(input.prismaGrounding.models),
    );
  }

  sections.push(
    "",
    "Numbered requirement source:",
    buildLineMappedSource(snapshot.source_text),
  );

  if (!repair) {
    return sections.join("\n");
  }

  sections.push("", "Repair guidance:");

  if (repair.validationIssues && repair.validationIssues.length > 0) {
    sections.push(
      "Fix these validation issues so the output passes deterministic validation:",
      formatIssueList(repair.validationIssues),
    );
  }

  if (repair.critic) {
    sections.push(
      "Fix these critic findings so the pack fully covers the requirement without generic cases:",
      JSON.stringify(repair.critic, null, 2),
    );
  }

  if (repair.grounding && repair.grounding.mismatches.length > 0) {
    sections.push(
      "Fix these OpenAPI grounding mismatches. Update API checks so each one uses only a grounded method/path pair. Keep non-API sections unchanged unless another issue requires edits:",
      formatGroundingMismatchList(repair.grounding.mismatches),
    );
  }

  if (repair.prisma && repair.prisma.mismatches.length > 0) {
    sections.push(
      "Fix these Prisma grounding mismatches. Update SQL checks so concrete checks use only grounded Prisma model and field names. If exact schema mapping is still unclear, convert the SQL check into a semantic form by removing query_hint and explicitly marking it as needing schema mapping:",
      formatPrismaMismatchList(repair.prisma.mismatches),
    );
  }

  sections.push(
    "Previous pack JSON:",
    JSON.stringify(repair.previousPack, null, 2),
  );

  return sections.join("\n");
}

function getValidationIssues(error: unknown) {
  if (error instanceof PackValidationError) {
    return error.issues;
  }

  return null;
}

function sanitizeGeneratedPack(candidate: PackContentInput): PackContentInput {
  const next = structuredClone(candidate) as PackContentInput & {
    clarifying_questions?: Array<{ reason?: string | null }>;
    checks?: {
      api?: Array<{ method?: string | null; endpoint?: string | null }> | null;
      sql?: Array<{ query_hint?: string | null }> | null;
      etl?: unknown[] | null;
    };
  };

  next.clarifying_questions?.forEach((question) => {
    if (question.reason === null) {
      delete question.reason;
    }
  });

  if (next.checks?.api === null) {
    next.checks.api = [];
  } else {
    next.checks?.api?.forEach((check) => {
      if (check.method === null) {
        delete check.method;
      }

      if (check.endpoint === null) {
        delete check.endpoint;
      }
    });
  }

  if (next.checks?.sql === null) {
    next.checks.sql = [];
  } else {
    next.checks?.sql?.forEach((check) => {
      if (check.query_hint === null) {
        delete check.query_hint;
      }
    });
  }

  if (next.checks?.etl === null) {
    next.checks.etl = [];
  }

  return next;
}

function applyPrismaSemanticFallback(input: {
  packContent: CanonicalPackContent;
  report: PrismaGroundingReport;
  grounding: PrismaGroundingSummary | null | undefined;
}) {
  if (!needsPrismaRepair(input.report)) {
    return {
      packContent: input.packContent,
      report: input.report,
    };
  }

  const downgradedPack = validatePackContent(
    downgradeSqlChecksToSemantic(input.packContent, input.report),
  ).value;

  return {
    packContent: downgradedPack,
    report: validatePrismaGrounding(downgradedPack, input.grounding ?? null),
  };
}

async function requestPackCandidate(
  input: GenerateAiPackInput,
  runner: StructuredOutputRunner,
  repair: RepairContext | undefined,
  model: string | undefined,
) {
  const response = await runner<PackContentInput>({
    name: "tracecase_pack_v1",
    description: "TraceCase pack content locked to Pack JSON Schema v1.0.",
    schema: packSchema,
    instructions: generationInstructions,
    input: buildPackRequestInput(input, repair),
    model,
  });

  return {
    output: sanitizeGeneratedPack(response.output),
    model: response.model,
    usage: response.usage,
  };
}

async function critiquePackWithDefaultRunner(input: {
  requirementSourceText: string;
  packContent: CanonicalPackContent;
  runner: StructuredOutputRunner;
  model?: string;
}) {
  const { critiquePack } = await import("@/server/packs/critiquePack");

  return critiquePack(input);
}

export async function generateAiPack(
  input: GenerateAiPackInput,
  options: GenerateAiPackOptions = {},
) {
  return (await generateAiPackWithCritic(input, options)).content;
}

export async function generateAiPackWithCritic(
  input: GenerateAiPackInput,
  options: GenerateAiPackOptions = {},
): Promise<GenerateAiPackResult> {
  const runner =
    options.runner ??
    (await import("@/server/ai/openaiClient")).createStructuredOutput;
  const critic = options.critic ?? critiquePackWithDefaultRunner;
  const provider = options.provider ?? "openai";

  let attempts = 0;
  let totalUsage: AiTokenUsage | undefined;
  let lastRepairContext: RepairContext | undefined;
  let canonicalPack: CanonicalPackContent | null = null;
  let resolvedModel = options.model ?? "unknown";

  while (attempts < 2 && !canonicalPack) {
    attempts += 1;

    const candidate = await requestPackCandidate(
      input,
      runner,
      lastRepairContext,
      options.model,
    );

    totalUsage = mergeTokenUsage(totalUsage, candidate.usage);
    resolvedModel = candidate.model;

    try {
      canonicalPack = validatePackContent(candidate.output).value;
    } catch (error) {
      const validationIssues = getValidationIssues(error);

      if (!validationIssues || attempts >= 2) {
        throw error;
      }

      lastRepairContext = {
        previousPack: candidate.output,
        validationIssues,
      };
    }
  }

  if (!canonicalPack) {
    throw new Error("AI pack generation did not produce a valid pack.");
  }

  let groundingReport = validateOpenApiGrounding(
    canonicalPack,
    input.openApiGrounding ?? null,
  );
  let prismaGroundingReport = validatePrismaGrounding(
    canonicalPack,
    input.prismaGrounding ?? null,
  );
  let criticResult = await critic({
    requirementSourceText: input.snapshot.source_text,
    packContent: canonicalPack,
    runner,
    model: options.model,
  });

  totalUsage = mergeTokenUsage(totalUsage, criticResult.usage);
  resolvedModel = criticResult.model;

  if (
    needsGroundingRepair(groundingReport) ||
    needsPrismaRepair(prismaGroundingReport) ||
    needsCriticRepair(criticResult.report)
  ) {
    if (attempts >= 2) {
      if (needsGroundingRepair(groundingReport)) {
        throw new AiPackGenerationError(
          "AI-generated API checks did not match the grounded OpenAPI artifact after repair.",
          buildGenerationMetadata({
            provider,
            model: resolvedModel,
            attempts,
            critic: criticResult.report,
            grounding: markGroundingReportFailed(groundingReport),
            prisma: prismaGroundingReport,
            tokenUsage: totalUsage,
          }),
        );
      }

      if (needsPrismaRepair(prismaGroundingReport)) {
        const downgraded = applyPrismaSemanticFallback({
          packContent: canonicalPack,
          report: prismaGroundingReport,
          grounding: input.prismaGrounding,
        });

        canonicalPack = downgraded.packContent;
        prismaGroundingReport = downgraded.report;

        if (needsPrismaRepair(prismaGroundingReport)) {
          throw new AiPackGenerationError(
            "AI-generated SQL checks could not be safely grounded to the Prisma schema after repair.",
            buildGenerationMetadata({
              provider,
              model: resolvedModel,
              attempts,
              critic: criticResult.report,
              grounding: groundingReport,
              prisma: markPrismaGroundingReportFailed(prismaGroundingReport),
              tokenUsage: totalUsage,
            }),
          );
        }
      }

      if (needsCriticRepair(criticResult.report)) {
        throw new Error(
          "AI-generated pack still has uncovered acceptance criteria after the repair cap was reached.",
        );
      }
    }

    attempts += 1;

    const repairedCandidate = await requestPackCandidate(
      input,
      runner,
      {
        previousPack: canonicalPack,
        critic: needsCriticRepair(criticResult.report)
          ? criticResult.report
          : undefined,
        grounding: needsGroundingRepair(groundingReport)
          ? groundingReport
          : undefined,
        prisma: needsPrismaRepair(prismaGroundingReport)
          ? prismaGroundingReport
          : undefined,
      },
      options.model,
    );

    totalUsage = mergeTokenUsage(totalUsage, repairedCandidate.usage);
    resolvedModel = repairedCandidate.model;
    canonicalPack = validatePackContent(repairedCandidate.output).value;

    groundingReport = validateOpenApiGrounding(
      canonicalPack,
      input.openApiGrounding ?? null,
    );
    prismaGroundingReport = validatePrismaGrounding(
      canonicalPack,
      input.prismaGrounding ?? null,
    );

    if (needsGroundingRepair(groundingReport)) {
      throw new AiPackGenerationError(
        "AI-generated API checks did not match the grounded OpenAPI artifact after repair.",
        buildGenerationMetadata({
          provider,
          model: resolvedModel,
          attempts,
          critic: criticResult.report,
          grounding: markGroundingReportFailed(groundingReport),
          prisma: prismaGroundingReport,
          tokenUsage: totalUsage,
        }),
      );
    }

    if (needsPrismaRepair(prismaGroundingReport)) {
      const downgraded = applyPrismaSemanticFallback({
        packContent: canonicalPack,
        report: prismaGroundingReport,
        grounding: input.prismaGrounding,
      });

      canonicalPack = downgraded.packContent;
      prismaGroundingReport = downgraded.report;

      if (needsPrismaRepair(prismaGroundingReport)) {
        throw new AiPackGenerationError(
          "AI-generated SQL checks could not be safely grounded to the Prisma schema after repair.",
          buildGenerationMetadata({
            provider,
            model: resolvedModel,
            attempts,
            critic: criticResult.report,
            grounding: groundingReport,
            prisma: markPrismaGroundingReportFailed(prismaGroundingReport),
            tokenUsage: totalUsage,
          }),
        );
      }
    }

    criticResult = await critic({
      requirementSourceText: input.snapshot.source_text,
      packContent: canonicalPack,
      runner,
      model: options.model,
    });

    totalUsage = mergeTokenUsage(totalUsage, criticResult.usage);
    resolvedModel = criticResult.model;

    if (needsCriticRepair(criticResult.report)) {
      throw new Error(
        "AI-generated pack still has uncovered acceptance criteria after one repair attempt.",
      );
    }
  }

  return {
    content: canonicalPack,
    metadata: buildGenerationMetadata({
      provider,
      model: resolvedModel,
      attempts,
      critic: criticResult.report,
      grounding: groundingReport,
      prisma: prismaGroundingReport,
      tokenUsage: totalUsage,
    }),
  };
}
