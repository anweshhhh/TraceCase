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
  buildCriticReportSummary,
  describeRepairPack,
} from "@/server/packs/packPromptContext";
import {
  buildAcceptanceCriteriaPlan,
  formatAcceptanceCriteriaPlan,
  type AcceptanceCriteriaPlan,
} from "@/server/packs/acceptanceCriteriaPlanner";
import {
  buildAcceptanceCoverageMap,
  formatUncoveredAcceptanceCriteria,
  type AcceptanceCoverageMap,
} from "@/server/packs/coverageMap";
import {
  buildCoverageClosurePlan,
  formatCoverageClosurePlan,
  type CoverageClosurePlan,
} from "@/server/packs/coverageClosurePlan";
import {
  validateCoverageClosure,
  type CoverageClosureValidation,
} from "@/server/packs/validateCoverageClosure";
import {
  sanitizeGeneratedPack,
  type SanitizedPackResult,
} from "@/server/packs/sanitizeGeneratedPack";
import { recoverApiCheckMethodsFromGrounding } from "@/server/packs/recoverApiCheckMethods";
import {
  validateCompensatingCoverage,
  type CompensatingCoverageValidation,
} from "@/server/packs/validateCompensatingCoverage";
import {
  classifyGeneratePackFinalOutcome,
  completeGenerationRuntimeStage,
  countRequirementLines,
  createGenerationRunContext,
  type GenerationRunContext,
  type GenerationRuntimeStage,
  type GeneratePackRuntimeMetadata,
  enterGenerationRuntimeStage,
  finalizeGenerationRuntimeFailure,
  finalizeGenerationRuntimeSuccess,
  PackGenerationWorkflowDeadlineError,
  GENERATE_PACK_CRITIC_STAGE_TIMEOUT_MS,
  GENERATE_PACK_GENERATION_STAGE_TIMEOUT_MS,
} from "@/server/packs/generationRunContext";
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

type OpenAiJobMetadataPayload = {
  provider: "openai";
  model: string;
  critic_model?: string;
  attempts: number;
  sanitization?: {
    initial?: {
      fixes_applied_count: number;
      kinds: SanitizedPackResult["fixes_applied"][number]["kind"][];
    };
    repair?: {
      fixes_applied_count: number;
      kinds: SanitizedPackResult["fixes_applied"][number]["kind"][];
    };
  };
  coverage_plan?: {
    acceptance_criteria_total: number;
    items: AcceptanceCriteriaPlan["criteria"];
  };
  coverage_map?: {
    total: number;
    covered: number;
    uncovered_ids: string[];
  };
  coverage_closure_plan?: {
    uncovered_ids: string[];
    obligations: Array<{
      id: string;
      required_action: CoverageClosurePlan["obligations"][number]["required_action"];
      expected_layers: CoverageClosurePlan["obligations"][number]["expected_layers"];
    }>;
  };
  coverage_closure_validation?: {
    status: CoverageClosureValidation["status"];
    still_unclosed: Array<{
      id: string;
      reason: string;
    }>;
  };
  compensating_coverage?: {
    status: CompensatingCoverageValidation["status"];
    issues: Array<{
      id: string;
      reason: string;
    }>;
  };
  critic: PackCriticReport & {
    phase: "initial" | "repair";
  };
  grounding: {
    openapi: OpenApiGroundingReport;
    prisma: PrismaGroundingReport;
  };
  token_usage?: AiTokenUsage;
};

export type OpenAiJobMetadata = {
  ai_mode: "openai";
  runtime?: GeneratePackRuntimeMetadata;
  ai?: OpenAiJobMetadataPayload;
};

export type AiPackGenerationMetadata = OpenAiJobMetadata & {
  ai: OpenAiJobMetadataPayload;
};

export type GenerateAiPackResult = {
  content: CanonicalPackContent;
  metadata: AiPackGenerationMetadata;
};

type GenerateAiPackOptions = {
  model?: string;
  generationModel?: string;
  criticModel?: string;
  provider?: "openai";
  runner?: StructuredOutputRunner;
  critic?: (input: {
    requirementSourceText: string;
    acceptanceCriteriaPlan: AcceptanceCriteriaPlan;
    coverageMap: AcceptanceCoverageMap;
    packContent: CanonicalPackContent;
    runner: StructuredOutputRunner;
    model?: string;
    timeoutMs?: number;
  }) => Promise<{
    report: PackCriticReport;
    model: string;
    usage?: AiTokenUsage;
  }>;
  prismaFallback?: (input: {
    packContent: CanonicalPackContent;
    report: PrismaGroundingReport;
    grounding: PrismaGroundingSummary | null | undefined;
  }) => {
    packContent: CanonicalPackContent;
    report: PrismaGroundingReport;
  };
  runContext?: GenerationRunContext;
  initialRuntime?: GeneratePackRuntimeMetadata;
  onProgress?: (
    runtime: GeneratePackRuntimeMetadata,
  ) => Promise<void> | void;
};

type RepairContext = {
  previousPack: unknown;
  validationIssues?: string[];
  coverageMap?: AcceptanceCoverageMap;
  coverageClosurePlan?: CoverageClosurePlan;
  compensatingCoverage?: CompensatingCoverageValidation;
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
  "Keep ids unique across each collection. Do not duplicate scenario, test case, or check ids.",
  "When OpenAPI grounding context is provided, concrete API checks must use only the listed HTTP method and path combinations.",
  "Every API check must include both a non-empty HTTP method and a non-empty endpoint. If you cannot express a concrete API check safely, use a test case instead of emitting a partial API check.",
  "If the requirement mentions an endpoint or method that is absent from the grounding context, do not invent an alternative API check.",
  "When Prisma grounding context is provided, concrete SQL checks must use only the listed Prisma model and field names.",
  "If you cannot prove an exact Prisma schema mapping, emit a semantic SQL check with a query_hint that starts with NEEDS_MAPPING: and describes the DB verification intent without inventing model or field names.",
  "When an Acceptance Criteria Coverage Plan is provided, cover every AC id explicitly.",
  "UI-tagged criteria require UI-facing scenarios, test steps, or assertions. Do not satisfy UI criteria with only API or SQL coverage.",
  "API-tagged criteria require concrete API coverage or response assertions. Criteria about documented error responses, status codes, headers, or rate limiting still need explicit negative-path API coverage.",
  "SQL-tagged criteria require persistence or data-state coverage. AUDIT-tagged criteria require audit verification. SESSION-tagged criteria require session lifecycle coverage. SECURITY-tagged criteria require policy-enforcement or negative-path coverage.",
  "Use AC ids in existing fields. Scenario tags and test case tags are the preferred place to reference AC ids. If a check needs an AC reference, include the AC id in the title or assertion text.",
  "Do not invent AC ids and do not omit AC ids for covered behavior.",
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
      const fields = model.fields.map((field) => field.name).join(", ");

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
  generationModel: string;
  criticModel: string;
  attempts: number;
  sanitization?: {
    initial?: {
      fixes_applied_count: number;
      kinds: SanitizedPackResult["fixes_applied"][number]["kind"][];
    };
    repair?: {
      fixes_applied_count: number;
      kinds: SanitizedPackResult["fixes_applied"][number]["kind"][];
    };
  };
  acceptanceCriteriaPlan?: AcceptanceCriteriaPlan;
  coverageMap?: AcceptanceCoverageMap;
  coverageClosurePlan?: CoverageClosurePlan;
  coverageClosureValidation?: CoverageClosureValidation;
  compensatingCoverage?: CompensatingCoverageValidation;
  critic: PackCriticReport;
  criticPhase: "initial" | "repair";
  grounding: OpenApiGroundingReport;
  prisma: PrismaGroundingReport;
  tokenUsage?: AiTokenUsage;
  runtime?: GeneratePackRuntimeMetadata;
}): AiPackGenerationMetadata {
  return {
    ai_mode: "openai",
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ai: {
      provider: input.provider,
      model: input.generationModel,
      ...(input.criticModel !== input.generationModel
        ? { critic_model: input.criticModel }
        : {}),
      attempts: input.attempts,
      ...(input.sanitization ? { sanitization: input.sanitization } : {}),
      ...(input.acceptanceCriteriaPlan
        ? {
            coverage_plan: {
              acceptance_criteria_total: input.acceptanceCriteriaPlan.criteria_total,
              items: input.acceptanceCriteriaPlan.criteria,
            },
          }
        : {}),
      ...(input.coverageMap
        ? {
            coverage_map: {
              total: input.coverageMap.total,
              covered: input.coverageMap.covered,
              uncovered_ids: input.coverageMap.uncovered_ids,
            },
          }
        : {}),
      ...(input.coverageClosurePlan
        ? {
            coverage_closure_plan: {
              uncovered_ids: input.coverageClosurePlan.uncovered_ids,
              obligations: input.coverageClosurePlan.obligations.map(
                ({ id, required_action, expected_layers }) => ({
                  id,
                  required_action,
                  expected_layers,
                }),
              ),
            },
          }
        : {}),
      ...(input.coverageClosureValidation
        ? {
            coverage_closure_validation: {
              status: input.coverageClosureValidation.status,
              still_unclosed: input.coverageClosureValidation.still_unclosed.map(
                ({ id, reason }) => ({
                  id,
                  reason,
                }),
              ),
            },
          }
        : {}),
      ...(input.compensatingCoverage
        ? {
            compensating_coverage: {
              status: input.compensatingCoverage.status,
              issues: input.compensatingCoverage.issues.map(({ id, reason }) => ({
                id,
                reason,
              })),
            },
          }
        : {}),
      critic: {
        phase: input.criticPhase,
        ...input.critic,
      },
      grounding: {
        openapi: input.grounding,
        prisma: input.prisma,
      },
      token_usage: input.tokenUsage,
    },
  };
}

function buildRuntimeOnlyMetadata(
  runtime: GeneratePackRuntimeMetadata,
): OpenAiJobMetadata {
  return {
    ai_mode: "openai",
    runtime,
  };
}

export class AiPackGenerationError extends Error {
  metadata: OpenAiJobMetadata;

  constructor(message: string, metadata: OpenAiJobMetadata) {
    super(message);
    this.name = "AiPackGenerationError";
    this.metadata = metadata;
  }
}

function buildPackRequestInput(
  input: GenerateAiPackInput,
  acceptanceCriteriaPlan: AcceptanceCriteriaPlan,
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

  if (acceptanceCriteriaPlan.criteria_total > 0) {
    sections.push(
      "",
      "Acceptance criteria coverage plan:",
      `- criteria_total: ${acceptanceCriteriaPlan.criteria_total}`,
      "Cover every AC id below. If an AC has multiple expected layers, keep coverage across those layers instead of collapsing it into one check type.",
      formatAcceptanceCriteriaPlan(acceptanceCriteriaPlan.criteria),
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
  sections.push(
    [
      "Keep ids unique while repairing.",
      "Keep every source_ref snapshot_id on the provided requirement_snapshot_id.",
      "Do not add incomplete API checks without both method and endpoint.",
    ].join(" "),
  );

  if (repair.validationIssues && repair.validationIssues.length > 0) {
    sections.push(
      "Fix these validation issues so the output passes deterministic validation:",
      formatIssueList(repair.validationIssues),
      [
        "Do not introduce new duplicate ids while repairing.",
        "Keep every source_ref snapshot_id on the provided requirement_snapshot_id.",
        "Do not add incomplete API checks without both method and endpoint.",
      ].join(" "),
    );
  }

  if (repair.critic) {
    sections.push(
      "Fix these critic findings so the pack fully covers the requirement without generic cases:",
      buildCriticReportSummary(repair.critic),
    );
  }

  if (repair.coverageClosurePlan && repair.coverageClosurePlan.obligations.length > 0) {
    sections.push(
      "Coverage closure obligations for repair:",
      formatCoverageClosurePlan(repair.coverageClosurePlan),
      [
        "Every uncovered AC must be closed by at least one concrete added or updated item.",
        "Every new or updated item used for closure must include the matching AC-xx id.",
        "Respect the required action and expected layers for each AC.",
        "Do not satisfy UI obligations with only API or SQL changes.",
        "Do not satisfy rate-limit or documented-response obligations with vague prose only.",
        "Preserve valid grounded API and Prisma coverage while making the minimum changes needed to close these obligations.",
      ].join(" "),
    );
  } else if (repair.coverageMap && repair.coverageMap.uncovered_ids.length > 0) {
    sections.push(
      "These AC ids are still missing deterministic coverage. Add or retag scenarios, test cases, and checks so each uncovered AC id is explicitly covered:",
      formatUncoveredAcceptanceCriteria(
        acceptanceCriteriaPlan.criteria,
        repair.coverageMap,
      ),
    );
  }

  if (
    repair.compensatingCoverage &&
    repair.compensatingCoverage.status === "insufficient" &&
    repair.compensatingCoverage.issues.length > 0
  ) {
    sections.push(
      "Compensating coverage obligations after semantic SQL fallback:",
      repair.compensatingCoverage.issues
        .map((issue, index) => `${index + 1}. ${issue.id}: ${issue.reason}`)
        .join("\n"),
      [
        "If SQL checks are semantic NEEDS_MAPPING checks for these AC ids, strengthen coverage elsewhere.",
        "Add or update concrete UI, API, session, or audit coverage as required.",
        "Include the matching AC-xx tags on the strengthened coverage.",
        "Do not rely on vague scenario prose alone.",
      ].join(" "),
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
      "Fix these Prisma grounding mismatches. Update SQL checks so concrete checks use only grounded Prisma model and field names. If exact schema mapping is still unclear, convert the SQL check into a semantic form by using a query_hint that starts with NEEDS_MAPPING: and explicitly marks it as needing schema mapping:",
      formatPrismaMismatchList(repair.prisma.mismatches),
    );
  }

  sections.push(
    "Previous pack summary:",
    describeRepairPack(repair.previousPack),
  );

  return sections.join("\n");
}

function getValidationIssues(error: unknown) {
  if (error instanceof PackValidationError) {
    return error.issues;
  }

  return null;
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
  acceptanceCriteriaPlan: AcceptanceCriteriaPlan,
  runner: StructuredOutputRunner,
  repair: RepairContext | undefined,
  model: string | undefined,
  timeoutMs: number,
) {
  const response = await runner<PackContentInput>({
    name: "tracecase_pack_v1",
    description: "TraceCase pack content locked to Pack JSON Schema v1.0.",
    schema: packSchema,
    instructions: generationInstructions,
    input: buildPackRequestInput(input, acceptanceCriteriaPlan, repair),
    model,
    timeoutMs,
  });

  return {
    output: response.output,
    model: response.model,
    usage: response.usage,
  };
}

async function critiquePackWithDefaultRunner(input: {
  requirementSourceText: string;
  acceptanceCriteriaPlan: AcceptanceCriteriaPlan;
  coverageMap: AcceptanceCoverageMap;
  packContent: CanonicalPackContent;
  runner: StructuredOutputRunner;
  model?: string;
  timeoutMs?: number;
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
  const prismaFallback = options.prismaFallback ?? applyPrismaSemanticFallback;
  const provider = options.provider ?? "openai";
  const criticModel = options.criticModel ?? options.model;
  const generationModel = options.generationModel ?? options.model;
  const runContext =
    options.runContext ??
    createGenerationRunContext({
      generationModel: generationModel ?? "configured-default",
      criticModel: criticModel ?? generationModel ?? "configured-default",
    });

  let attempts = 0;
  let totalUsage: AiTokenUsage | undefined;
  let lastRepairContext: RepairContext | undefined;
  let canonicalPack: CanonicalPackContent | null = null;
  let criticReport: PackCriticReport | null = null;
  let criticPhase: "initial" | "repair" | null = null;
  let groundingReport: OpenApiGroundingReport | null = null;
  let prismaGroundingReport: PrismaGroundingReport | null = null;
  let coverageMap: AcceptanceCoverageMap | null = null;
  let coverageClosurePlan: CoverageClosurePlan | null = null;
  let coverageClosureValidation: CoverageClosureValidation | null = null;
  let compensatingCoverage: CompensatingCoverageValidation | null = null;
  let sanitizationSummary:
    | {
        initial?: {
          fixes_applied_count: number;
          kinds: SanitizedPackResult["fixes_applied"][number]["kind"][];
        };
        repair?: {
          fixes_applied_count: number;
          kinds: SanitizedPackResult["fixes_applied"][number]["kind"][];
        };
      }
    | undefined;
  let resolvedGenerationModel = generationModel ?? runContext.generationModel;
  let resolvedCriticModel = criticModel ?? runContext.criticModel;
  let currentStage: GenerationRuntimeStage = "load_context";
  const requirementChars = input.snapshot.source_text.length;
  const requirementLines = countRequirementLines(input.snapshot.source_text);
  const openapiOperationsCount = input.openApiGrounding?.operations_count ?? 0;
  const prismaModelsCount = input.prismaGrounding?.model_count ?? 0;
  const acceptanceCriteriaPlan = buildAcceptanceCriteriaPlan(
    input.snapshot.source_text,
  );
  let runtime =
    options.initialRuntime ??
    runContext.buildRuntime({
      stage: "load_context",
      attempt: 1,
      requirementChars,
      requirementLines,
      openapiOperationsCount,
      prismaModelsCount,
    });

  function getPackCounts(packContent: CanonicalPackContent | null) {
    return packContent
      ? {
          packApiChecksCount: packContent.checks.api.length,
          packSqlChecksCount: packContent.checks.sql.length,
        }
      : {};
  }

  async function pushRuntime(nextRuntime: GeneratePackRuntimeMetadata) {
    runtime = nextRuntime;
    currentStage = nextRuntime.current_stage;
    await options.onProgress?.(runtime);
    return runtime;
  }

  async function enterStage(
    stage: GenerationRuntimeStage,
    attempt: number,
    metrics: {
      providerCall?: boolean;
      model?: string | null;
      timeoutMs?: number | null;
      note?: string;
    } = {},
  ) {
    currentStage = stage;
    return pushRuntime(
      enterGenerationRuntimeStage(runtime, {
        stage,
        attempt: Math.max(attempt, 1),
        providerCall: metrics.providerCall,
        model: metrics.model,
        timeoutMs: metrics.timeoutMs,
        requirementChars,
        requirementLines,
        openapiOperationsCount,
        prismaModelsCount,
        note: metrics.note,
      }),
    );
  }

  async function completeStage(
    status: "succeeded" | "failed" | "skipped",
    metrics: {
      packContent?: CanonicalPackContent | null;
      semanticSqlChecksCount?: number;
      mismatchCount?: number;
      note?: string;
    } = {},
  ) {
    return pushRuntime(
      completeGenerationRuntimeStage(runtime, {
        status,
        ...getPackCounts(metrics.packContent ?? canonicalPack),
        semanticSqlChecksCount: metrics.semanticSqlChecksCount,
        mismatchCount: metrics.mismatchCount,
        note: metrics.note,
      }),
    );
  }

  async function throwKnownFailure(
    message: string,
    stage: GenerationRuntimeStage,
    outcome: ReturnType<typeof classifyGeneratePackFinalOutcome>,
      metrics: {
      packContent?: CanonicalPackContent | null;
      semanticSqlChecksCount?: number;
      mismatchCount?: number;
      note?: string;
    } = {},
  ): Promise<never> {
    currentStage = stage;
    const failedRuntime = finalizeGenerationRuntimeFailure(runtime, {
      finalOutcome: outcome,
      finalFailureMessage: message,
      ...getPackCounts(metrics.packContent ?? canonicalPack),
      semanticSqlChecksCount: metrics.semanticSqlChecksCount,
      mismatchCount: metrics.mismatchCount,
      note: metrics.note,
    });
    await pushRuntime(failedRuntime);

    throw new AiPackGenerationError(
      message,
      criticReport && groundingReport && prismaGroundingReport
        ? buildGenerationMetadata({
            provider,
            generationModel: resolvedGenerationModel,
            criticModel: resolvedCriticModel,
            attempts: Math.max(attempts, 1),
            sanitization: sanitizationSummary,
            acceptanceCriteriaPlan,
            coverageMap:
              canonicalPack && acceptanceCriteriaPlan.criteria_total > 0
                ? buildAcceptanceCoverageMap(
                    acceptanceCriteriaPlan.criteria,
                    canonicalPack,
                  )
                : undefined,
            coverageClosurePlan: coverageClosurePlan ?? undefined,
            coverageClosureValidation: coverageClosureValidation ?? undefined,
            compensatingCoverage: compensatingCoverage ?? undefined,
            critic: criticReport,
            criticPhase:
              criticPhase ?? (stage === "repair_critic" ? "repair" : "initial"),
            grounding: groundingReport,
            prisma: prismaGroundingReport,
            tokenUsage: totalUsage,
            runtime: failedRuntime,
          })
        : buildRuntimeOnlyMetadata(failedRuntime),
    );
  }

  function buildCoverageFailureNote(coverageMap: AcceptanceCoverageMap) {
    return coverageMap.uncovered_ids.length > 0
      ? `Missing ${coverageMap.uncovered_ids.join(", ")}`
      : "Acceptance coverage incomplete.";
  }

  function buildSanitizationSummary(result: SanitizedPackResult) {
    return {
      fixes_applied_count: result.fixes_applied.length,
      kinds: [...new Set(result.fixes_applied.map((fix) => fix.kind))].sort(),
    } as const;
  }

  function buildSanitizationNote(result: SanitizedPackResult) {
    if (result.fixes_applied.length === 0) {
      return undefined;
    }

    const firstFix = result.fixes_applied[0];
    if (!firstFix) {
      return undefined;
    }

    return result.fixes_applied.length === 1
      ? `Applied 1 sanitization fix: ${firstFix.kind} at ${firstFix.path}`
      : `Applied ${result.fixes_applied.length} sanitization fixes. First: ${firstFix.kind} at ${firstFix.path}`;
  }

  function combineNotes(...notes: Array<string | undefined>) {
    return notes.filter(Boolean).join(" | ") || undefined;
  }

  function buildCoverageClosureValidationNote(
    validation: CoverageClosureValidation,
  ) {
    return validation.still_unclosed.length > 0
      ? `Still unclosed ${validation.still_unclosed.map((item) => item.id).join(", ")}`
      : "Coverage closure obligations satisfied.";
  }

  function buildCompensatingCoverageNote(
    validation: CompensatingCoverageValidation,
  ) {
    return validation.issues.length > 0
      ? `Compensating coverage needed for ${validation.issues.map((issue) => issue.id).join(", ")}`
      : undefined;
  }

  function buildCriticCoverageNote(report: PackCriticReport) {
    const uncoveredIds = report.coverage.uncovered.map((item) => item.id);
    return uncoveredIds.length > 0
      ? `Missing ${uncoveredIds.join(", ")}`
      : report.coverage.uncovered[0]?.why_uncovered;
  }

  function buildCoverageCriticReport(
    coverageMap: AcceptanceCoverageMap,
  ): PackCriticReport {
    const criterionById = new Map(
      acceptanceCriteriaPlan.criteria.map((criterion) => [criterion.id, criterion]),
    );

    return {
      verdict: coverageMap.uncovered_ids.length === 0 ? "pass" : "needs_work",
      coverage: {
        acceptance_criteria_total: coverageMap.total,
        acceptance_criteria_covered: coverageMap.covered,
        uncovered: coverageMap.uncovered_ids.map((id) => ({
          id,
          criterion: criterionById.get(id)?.text ?? id,
          why_uncovered:
            "No scenario, test case, or check explicitly references this AC id.",
        })),
      },
      major_risks:
        coverageMap.uncovered_ids.length > 0
          ? [
              `Deterministic AC coverage is missing for ${coverageMap.uncovered_ids.join(", ")}.`,
            ]
          : [],
      quality_notes:
        coverageMap.uncovered_ids.length > 0
          ? ["Repair should add explicit AC ids in tags before final critic review."]
          : ["Deterministic AC coverage map marked all AC ids as referenced."],
    };
  }

  try {
    while (attempts < 2 && !canonicalPack) {
      attempts += 1;

      const generationStage =
        attempts === 1 ? "initial_generation" : "repair_generation";
      const validationStage =
        attempts === 1 ? "initial_validation" : "repair_validation";
      const openApiGroundingStage =
        attempts === 1 ? "openapi_grounding" : "repair_openapi_grounding";
      const prismaGroundingStage =
        attempts === 1 ? "prisma_grounding" : "repair_prisma_grounding";
      const criticStage =
        attempts === 1 ? "initial_critic" : "repair_critic";
      await enterStage(generationStage, attempts, {
        providerCall: true,
        model: generationModel ?? runContext.generationModel,
        timeoutMs: Math.min(
          GENERATE_PACK_GENERATION_STAGE_TIMEOUT_MS,
          Math.max(1, runContext.remainingMs()),
        ),
        note:
          attempts === 1
            ? undefined
            : "Repair prompt includes prior validation, grounding, and critic findings.",
      });
      const generationTimeoutMs = runContext.getTimeoutMs(
        generationStage,
        GENERATE_PACK_GENERATION_STAGE_TIMEOUT_MS,
      );

      const candidate = await requestPackCandidate(
        input,
        acceptanceCriteriaPlan,
        runner,
        lastRepairContext,
        generationModel,
        generationTimeoutMs,
      );

      totalUsage = mergeTokenUsage(totalUsage, candidate.usage);
      resolvedGenerationModel = candidate.model;
      await completeStage("succeeded");

      await enterStage(validationStage, attempts);
      runContext.assertWithinDeadline(validationStage);
      const sanitizedCandidate = sanitizeGeneratedPack(candidate.output);
      const sanitizationNote = buildSanitizationNote(sanitizedCandidate);
      const methodRecoveredCandidate = recoverApiCheckMethodsFromGrounding(
        sanitizedCandidate.pack,
        input.openApiGrounding ?? null,
      );
      const recoveryNote =
        methodRecoveredCandidate.recovered.length === 0
          ? undefined
          : methodRecoveredCandidate.recovered.length === 1
            ? `Recovered API method from grounding at ${methodRecoveredCandidate.recovered[0]?.path}`
            : `Recovered ${methodRecoveredCandidate.recovered.length} API methods from grounding.`;
      const sanitizationPhase = attempts === 1 ? "initial" : "repair";
      sanitizationSummary = {
        ...sanitizationSummary,
        [sanitizationPhase]: buildSanitizationSummary(sanitizedCandidate),
      };

      try {
        canonicalPack = validatePackContent(methodRecoveredCandidate.pack).value;
        coverageMap = buildAcceptanceCoverageMap(
          acceptanceCriteriaPlan.criteria,
          canonicalPack,
        );
        coverageClosureValidation =
          attempts >= 2 && coverageClosurePlan
            ? validateCoverageClosure(coverageClosurePlan, canonicalPack)
            : null;
        await completeStage("succeeded", {
          packContent: canonicalPack,
          mismatchCount:
            coverageClosureValidation?.status === "still_incomplete"
              ? coverageClosureValidation.still_unclosed.length
              : coverageMap.uncovered_ids.length,
          note:
            coverageClosureValidation?.status === "still_incomplete"
              ? combineNotes(
                  sanitizationNote,
                  recoveryNote,
                  buildCoverageClosureValidationNote(coverageClosureValidation),
                )
              : coverageMap.uncovered_ids.length > 0
                ? combineNotes(
                    sanitizationNote,
                    recoveryNote,
                    buildCoverageFailureNote(coverageMap),
                  )
                : combineNotes(sanitizationNote, recoveryNote),
        });
      } catch (error) {
        const validationIssues = getValidationIssues(error);
        await completeStage("failed", {
          mismatchCount: validationIssues?.length,
          note: combineNotes(sanitizationNote, recoveryNote, validationIssues?.[0]),
        });

        if (!validationIssues || attempts >= 2) {
          throw error;
        }

        lastRepairContext = {
          previousPack: methodRecoveredCandidate.pack,
          validationIssues,
        };
        canonicalPack = null;
        continue;
      }

      await enterStage(openApiGroundingStage, attempts, {
        note: input.openApiGrounding
          ? undefined
          : "No valid OpenAPI artifact found for the latest snapshot.",
      });
      runContext.assertWithinDeadline(openApiGroundingStage);

      groundingReport = validateOpenApiGrounding(
        canonicalPack,
        input.openApiGrounding ?? null,
      );
      if (attempts >= 2 && needsGroundingRepair(groundingReport)) {
        groundingReport = markGroundingReportFailed(groundingReport);
      }

      await completeStage(
        groundingReport.status === "skipped"
          ? "skipped"
          : groundingReport.status === "grounded"
            ? "succeeded"
            : "failed",
        {
          packContent: canonicalPack,
          mismatchCount: groundingReport.mismatches.length,
          note:
            groundingReport.status === "skipped"
              ? "OpenAPI grounding skipped for this snapshot."
              : groundingReport.mismatches[0]?.reason,
        },
      );

      if (groundingReport.status === "failed") {
        await throwKnownFailure(
          "AI-generated API checks did not match the grounded OpenAPI artifact after repair.",
          openApiGroundingStage,
          "openapi_grounding",
          {
            packContent: canonicalPack,
            mismatchCount: groundingReport.mismatches.length,
            note: groundingReport.mismatches[0]?.reason,
          },
        );
      }

      await enterStage(prismaGroundingStage, attempts, {
        note: input.prismaGrounding
          ? undefined
          : "No valid Prisma artifact found for the latest snapshot.",
      });
      runContext.assertWithinDeadline(prismaGroundingStage);

      prismaGroundingReport = validatePrismaGrounding(
        canonicalPack,
        input.prismaGrounding ?? null,
      );

      let prismaStageNote: string | undefined;
      if (attempts >= 2 && needsPrismaRepair(prismaGroundingReport)) {
        const downgraded = prismaFallback({
          packContent: canonicalPack,
          report: prismaGroundingReport,
          grounding: input.prismaGrounding,
        });

        canonicalPack = downgraded.packContent;
        prismaGroundingReport = downgraded.report;
        prismaStageNote =
          "Applied deterministic semantic SQL fallback for unsupported concrete schema references.";

        if (needsPrismaRepair(prismaGroundingReport)) {
          prismaGroundingReport = markPrismaGroundingReportFailed(
            prismaGroundingReport,
          );
        }
      }

      compensatingCoverage = validateCompensatingCoverage(
        acceptanceCriteriaPlan.criteria,
        canonicalPack,
        prismaGroundingReport.sql_checks_semantic,
      );

      await completeStage(
        prismaGroundingReport.status === "skipped"
          ? "skipped"
          : prismaGroundingReport.status === "grounded"
            ? "succeeded"
            : "failed",
        {
          packContent: canonicalPack,
          semanticSqlChecksCount: prismaGroundingReport.sql_checks_semantic,
          mismatchCount: prismaGroundingReport.mismatches.length,
          note:
            combineNotes(
              prismaStageNote ??
                (prismaGroundingReport.status === "skipped"
                  ? "Prisma grounding skipped for this snapshot."
                  : prismaGroundingReport.mismatches[0]?.reason),
              buildCompensatingCoverageNote(compensatingCoverage),
            ),
        },
      );

      if (prismaGroundingReport.status === "failed") {
        await throwKnownFailure(
          "AI-generated SQL checks did not match the grounded Prisma schema after repair.",
          prismaGroundingStage,
          "prisma_grounding",
          {
            packContent: canonicalPack,
            semanticSqlChecksCount: prismaGroundingReport.sql_checks_semantic,
            mismatchCount: prismaGroundingReport.mismatches.length,
            note: prismaGroundingReport.mismatches[0]?.reason,
          },
        );
      }

      if (coverageMap && coverageMap.uncovered_ids.length > 0) {
        const coverageNote = buildCoverageFailureNote(coverageMap);

        if (attempts === 1) {
          coverageClosurePlan = buildCoverageClosurePlan(
            acceptanceCriteriaPlan.criteria,
            buildCoverageCriticReport(coverageMap).coverage.uncovered,
          );

          await enterStage(criticStage, attempts, {
            note: `Deterministic AC coverage gate found missing ids before critic: ${coverageMap.uncovered_ids.join(", ")}`,
          });
          await completeStage("skipped", {
            packContent: canonicalPack,
            semanticSqlChecksCount: prismaGroundingReport.sql_checks_semantic,
            mismatchCount: coverageMap.uncovered_ids.length,
            note: coverageNote,
          });

          lastRepairContext = {
            previousPack: canonicalPack,
            coverageMap,
            coverageClosurePlan,
            compensatingCoverage:
              compensatingCoverage.status === "insufficient"
                ? compensatingCoverage
                : undefined,
            grounding: needsGroundingRepair(groundingReport)
              ? groundingReport
              : undefined,
            prisma: needsPrismaRepair(prismaGroundingReport)
              ? prismaGroundingReport
              : undefined,
          };
          canonicalPack = null;
          continue;
        }
      }

      await enterStage(criticStage, attempts, {
        providerCall: true,
        model: criticModel ?? runContext.criticModel,
        timeoutMs: Math.min(
          GENERATE_PACK_CRITIC_STAGE_TIMEOUT_MS,
          Math.max(1, runContext.remainingMs()),
        ),
        note:
          combineNotes(
            coverageClosureValidation?.status === "still_incomplete"
              ? buildCoverageClosureValidationNote(coverageClosureValidation)
              : undefined,
            buildCompensatingCoverageNote(compensatingCoverage),
          ),
      });
      const criticTimeoutMs = runContext.getTimeoutMs(
        criticStage,
        GENERATE_PACK_CRITIC_STAGE_TIMEOUT_MS,
      );

      const criticResult = await critic({
        requirementSourceText: input.snapshot.source_text,
        acceptanceCriteriaPlan,
        coverageMap:
          coverageMap ??
          buildAcceptanceCoverageMap(acceptanceCriteriaPlan.criteria, canonicalPack),
        packContent: canonicalPack,
        runner,
        model: criticModel,
        timeoutMs: criticTimeoutMs,
      });

      totalUsage = mergeTokenUsage(totalUsage, criticResult.usage);
      resolvedCriticModel = criticResult.model;
      criticReport = criticResult.report;
      criticPhase = attempts === 1 ? "initial" : "repair";
      coverageMap =
        coverageMap ??
        buildAcceptanceCoverageMap(acceptanceCriteriaPlan.criteria, canonicalPack);
      await completeStage(
        needsCriticRepair(criticReport) ? "failed" : "succeeded",
        {
          packContent: canonicalPack,
          semanticSqlChecksCount: prismaGroundingReport.sql_checks_semantic,
          mismatchCount: criticReport.coverage.uncovered.length,
          note:
            combineNotes(
              criticReport.coverage.uncovered[0]
                ? buildCriticCoverageNote(criticReport)
                : criticReport.verdict === "pass"
                  ? "Critic passed requirement coverage review."
                  : undefined,
              buildCompensatingCoverageNote(compensatingCoverage),
            ),
        },
      );

      if (
        needsGroundingRepair(groundingReport) ||
        needsPrismaRepair(prismaGroundingReport) ||
        compensatingCoverage.status === "insufficient" ||
        needsCriticRepair(criticReport)
      ) {
        if (attempts >= 2) {
          if (compensatingCoverage.status === "insufficient") {
            await throwKnownFailure(
              "AI-generated pack still has insufficient compensating coverage after semantic SQL fallback.",
              criticStage,
              "critic_coverage",
              {
                packContent: canonicalPack,
                semanticSqlChecksCount: prismaGroundingReport.sql_checks_semantic,
                mismatchCount: compensatingCoverage.issues.length,
                note: combineNotes(
                  buildCompensatingCoverageNote(compensatingCoverage),
                  criticReport.coverage.uncovered.length > 0
                    ? buildCriticCoverageNote(criticReport)
                    : undefined,
                ),
              },
            );
          }

          if (needsCriticRepair(criticReport)) {
            await throwKnownFailure(
              "AI-generated pack still has uncovered acceptance criteria after one repair attempt.",
              criticStage,
              "critic_coverage",
              {
                packContent: canonicalPack,
                semanticSqlChecksCount: prismaGroundingReport.sql_checks_semantic,
                mismatchCount: criticReport.coverage.uncovered.length,
                note:
                  criticReport.coverage.uncovered.length > 0
                    ? buildCriticCoverageNote(criticReport)
                    : coverageClosureValidation?.status === "still_incomplete"
                      ? buildCoverageClosureValidationNote(
                          coverageClosureValidation,
                        )
                      : undefined,
              },
            );
          }

          continue;
        }

        if (needsCriticRepair(criticReport)) {
          coverageClosurePlan = buildCoverageClosurePlan(
            acceptanceCriteriaPlan.criteria,
            criticReport.coverage.uncovered,
          );
        }

        lastRepairContext = {
          previousPack: canonicalPack,
          coverageMap:
            coverageMap && coverageMap.uncovered_ids.length > 0
              ? coverageMap
              : undefined,
          coverageClosurePlan:
            coverageClosurePlan && coverageClosurePlan.uncovered_ids.length > 0
              ? coverageClosurePlan
              : undefined,
          compensatingCoverage:
            compensatingCoverage.status === "insufficient"
              ? compensatingCoverage
              : undefined,
          critic: needsCriticRepair(criticReport) ? criticReport : undefined,
          grounding: needsGroundingRepair(groundingReport)
            ? groundingReport
            : undefined,
          prisma: needsPrismaRepair(prismaGroundingReport)
            ? prismaGroundingReport
            : undefined,
        };
        canonicalPack = null;
      }
    }

    if (!canonicalPack || !criticReport || !groundingReport || !prismaGroundingReport) {
      throw new Error("AI pack generation did not produce a valid pack.");
    }

    const succeededRuntime = finalizeGenerationRuntimeSuccess(runtime, {
      ...getPackCounts(canonicalPack),
      semanticSqlChecksCount: prismaGroundingReport.sql_checks_semantic,
      note:
        attempts > 1
          ? "Generation succeeded after one repair pass."
          : "Generation succeeded on the initial pass.",
    });
    await pushRuntime(succeededRuntime);

    return {
      content: canonicalPack,
      metadata: buildGenerationMetadata({
        provider,
        generationModel: resolvedGenerationModel,
        criticModel: resolvedCriticModel,
        attempts,
        sanitization: sanitizationSummary,
        acceptanceCriteriaPlan,
        coverageMap: coverageMap ?? undefined,
        coverageClosurePlan: coverageClosurePlan ?? undefined,
        coverageClosureValidation: coverageClosureValidation ?? undefined,
        compensatingCoverage: compensatingCoverage ?? undefined,
        critic: criticReport,
        criticPhase: criticPhase ?? "initial",
        grounding: groundingReport,
        prisma: prismaGroundingReport,
        tokenUsage: totalUsage,
        runtime: succeededRuntime,
      }),
    };
  } catch (error) {
    if (error instanceof AiPackGenerationError) {
      throw error;
    }

    const failureStage =
      error instanceof PackGenerationWorkflowDeadlineError
        ? error.stage
        : currentStage;
    const failureMessage =
      error instanceof PackGenerationWorkflowDeadlineError
        ? error.message
        : error instanceof Error
          ? error.message
          : "AI pack generation failed.";
    const finalOutcome = classifyGeneratePackFinalOutcome(error);
    const failedRuntime = finalizeGenerationRuntimeFailure(runtime, {
      finalOutcome,
      finalFailureMessage: failureMessage,
      ...getPackCounts(canonicalPack),
      semanticSqlChecksCount: prismaGroundingReport?.sql_checks_semantic,
      mismatchCount:
        failureStage === "openapi_grounding" ||
        failureStage === "repair_openapi_grounding"
          ? groundingReport?.mismatches.length
          : failureStage === "prisma_grounding" ||
              failureStage === "repair_prisma_grounding"
            ? prismaGroundingReport?.mismatches.length
            : failureStage === "initial_critic" || failureStage === "repair_critic"
              ? criticReport?.coverage.uncovered.length
              : undefined,
      note: failureMessage,
    });
    await pushRuntime(failedRuntime);

    throw new AiPackGenerationError(
      failureMessage,
      criticReport && groundingReport && prismaGroundingReport
        ? buildGenerationMetadata({
            provider,
            generationModel: resolvedGenerationModel,
            criticModel: resolvedCriticModel,
            attempts: Math.max(attempts, 1),
            sanitization: sanitizationSummary,
            acceptanceCriteriaPlan,
            coverageMap: coverageMap ?? undefined,
            coverageClosurePlan: coverageClosurePlan ?? undefined,
            coverageClosureValidation: coverageClosureValidation ?? undefined,
            compensatingCoverage: compensatingCoverage ?? undefined,
            critic: criticReport,
            criticPhase:
              criticPhase ??
              (failureStage === "repair_critic" ? "repair" : "initial"),
            grounding: groundingReport,
            prisma: prismaGroundingReport,
            tokenUsage: totalUsage,
            runtime: failedRuntime,
          })
        : buildRuntimeOnlyMetadata(failedRuntime),
    );
  }
}
