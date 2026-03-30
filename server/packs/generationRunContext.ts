export const GENERATE_PACK_WORKFLOW_DEADLINE_MS = 12 * 60 * 1000;
export const GENERATE_PACK_GENERATION_STAGE_TIMEOUT_MS = 240 * 1000;
export const GENERATE_PACK_CRITIC_STAGE_TIMEOUT_MS = 90 * 1000;

export const GENERATE_PACK_RUNTIME_STAGES = [
  "load_context",
  "initial_generation",
  "initial_validation",
  "openapi_grounding",
  "prisma_grounding",
  "initial_critic",
  "repair_generation",
  "repair_validation",
  "repair_openapi_grounding",
  "repair_prisma_grounding",
  "repair_critic",
  "finalize",
] as const;

export type GenerationRuntimeStage =
  (typeof GENERATE_PACK_RUNTIME_STAGES)[number];

export type GenerationRuntimeStatus = "running" | "failed" | "succeeded";

export type GeneratePackFinalOutcome =
  | "succeeded"
  | "provider_timeout"
  | "workflow_deadline"
  | "critic_coverage"
  | "openapi_grounding"
  | "prisma_grounding"
  | "validation"
  | "dispatch"
  | "unknown";

export type GeneratePackStageEvidence = {
  stage: GenerationRuntimeStage;
  attempt?: number;
  entered_at: string;
  exited_at?: string;
  duration_ms?: number;
  status: "entered" | "succeeded" | "failed" | "skipped";
  provider_call?: boolean;
  model?: string | null;
  timeout_ms?: number | null;
  requirement_chars?: number;
  requirement_lines?: number;
  openapi_operations_count?: number;
  prisma_models_count?: number;
  pack_api_checks_count?: number;
  pack_sql_checks_count?: number;
  semantic_sql_checks_count?: number;
  mismatch_count?: number;
  note?: string;
};

export type GeneratePackRuntimeMetadata = {
  version: 1;
  started_at: string;
  updated_at: string;
  current_stage: GenerationRuntimeStage;
  current_attempt: number;
  stages: GeneratePackStageEvidence[];
  repair_entered: boolean;
  critic_entered: boolean;
  repair_critic_entered: boolean;
  workflow_deadline_at?: string | null;
  final_outcome?: GeneratePackFinalOutcome;
  final_failure_stage?: GenerationRuntimeStage | null;
  final_failure_message?: string | null;
  last_provider_stage?: GenerationRuntimeStage | null;
  generation_model: string;
  critic_model: string;
  status: GenerationRuntimeStatus;
  stage: GenerationRuntimeStage;
  attempt: number;
  deadline_at: string;
};

type CreateGenerationRunContextInput = {
  startedAt?: Date;
  deadlineMs?: number;
  now?: () => Date;
  generationModel: string;
  criticModel: string;
};

type RuntimeStageMetrics = {
  providerCall?: boolean;
  model?: string | null;
  timeoutMs?: number | null;
  requirementChars?: number;
  requirementLines?: number;
  openapiOperationsCount?: number;
  prismaModelsCount?: number;
  packApiChecksCount?: number;
  packSqlChecksCount?: number;
  semanticSqlChecksCount?: number;
  mismatchCount?: number;
  note?: string;
};

type FinalizeRuntimeInput = RuntimeStageMetrics & {
  finalOutcome: GeneratePackFinalOutcome;
  finalFailureMessage?: string | null;
};

export class PackGenerationWorkflowDeadlineError extends Error {
  readonly stage: GenerationRuntimeStage;
  readonly deadlineAt: string;

  constructor(stage: GenerationRuntimeStage, deadlineAt: Date) {
    super(
      `Pack generation exceeded the 12-minute workflow deadline during ${stage}. Please retry.`,
    );
    this.name = "PackGenerationWorkflowDeadlineError";
    this.stage = stage;
    this.deadlineAt = deadlineAt.toISOString();
  }
}

function mergeStageMetrics(
  stage: GeneratePackStageEvidence,
  metrics: RuntimeStageMetrics,
) {
  return {
    ...stage,
    ...(metrics.providerCall !== undefined
      ? { provider_call: metrics.providerCall }
      : {}),
    ...(metrics.model !== undefined ? { model: metrics.model } : {}),
    ...(metrics.timeoutMs !== undefined ? { timeout_ms: metrics.timeoutMs } : {}),
    ...(metrics.requirementChars !== undefined
      ? { requirement_chars: metrics.requirementChars }
      : {}),
    ...(metrics.requirementLines !== undefined
      ? { requirement_lines: metrics.requirementLines }
      : {}),
    ...(metrics.openapiOperationsCount !== undefined
      ? { openapi_operations_count: metrics.openapiOperationsCount }
      : {}),
    ...(metrics.prismaModelsCount !== undefined
      ? { prisma_models_count: metrics.prismaModelsCount }
      : {}),
    ...(metrics.packApiChecksCount !== undefined
      ? { pack_api_checks_count: metrics.packApiChecksCount }
      : {}),
    ...(metrics.packSqlChecksCount !== undefined
      ? { pack_sql_checks_count: metrics.packSqlChecksCount }
      : {}),
    ...(metrics.semanticSqlChecksCount !== undefined
      ? { semantic_sql_checks_count: metrics.semanticSqlChecksCount }
      : {}),
    ...(metrics.mismatchCount !== undefined
      ? { mismatch_count: metrics.mismatchCount }
      : {}),
    ...(metrics.note !== undefined ? { note: metrics.note } : {}),
  };
}

function isRepairStage(stage: GenerationRuntimeStage) {
  return stage.startsWith("repair_");
}

function isCriticStage(stage: GenerationRuntimeStage) {
  return stage === "initial_critic" || stage === "repair_critic";
}

function applyRuntimeAliases(
  runtime: Omit<
    GeneratePackRuntimeMetadata,
    "status" | "stage" | "attempt" | "deadline_at"
  > & {
    status: GenerationRuntimeStatus;
  },
): GeneratePackRuntimeMetadata {
  return {
    ...runtime,
    status: runtime.status,
    stage: runtime.current_stage,
    attempt: runtime.current_attempt,
    deadline_at: runtime.workflow_deadline_at ?? runtime.started_at,
  };
}

function getStageExitValues(stage: GeneratePackStageEvidence, exitedAt: string) {
  const durationMs = Math.max(
    0,
    new Date(exitedAt).getTime() - new Date(stage.entered_at).getTime(),
  );

  return {
    exited_at: exitedAt,
    duration_ms: durationMs,
  };
}

export function countRequirementLines(value: string) {
  if (!value) {
    return 0;
  }

  return value.split(/\r\n|\n/).length;
}

export function classifyGeneratePackFinalOutcome(
  error: unknown,
): GeneratePackFinalOutcome {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes("openai request timed out")) {
    return "provider_timeout";
  }

  if (message.includes("workflow deadline")) {
    return "workflow_deadline";
  }

  if (message.includes("acceptance criteria")) {
    return "critic_coverage";
  }

  if (message.includes("grounded openapi artifact")) {
    return "openapi_grounding";
  }

  if (message.includes("grounded prisma schema")) {
    return "prisma_grounding";
  }

  if (message.includes("validation")) {
    return "validation";
  }

  if (message.includes("dispatch") || message.includes("econnrefused")) {
    return "dispatch";
  }

  return "unknown";
}

export function createInitialGenerationRuntimeMetadata(input: {
  startedAt: Date;
  deadlineAt: Date;
  generationModel: string;
  criticModel: string;
  stage?: GenerationRuntimeStage;
  attempt?: number;
  status?: GenerationRuntimeStatus;
  requirementChars?: number;
  requirementLines?: number;
  openapiOperationsCount?: number;
  prismaModelsCount?: number;
  note?: string;
}) {
  const stage = input.stage ?? "load_context";
  const attempt = Math.max(input.attempt ?? 1, 1);
  const startedAt = input.startedAt.toISOString();
  const initialStage: GeneratePackStageEvidence = mergeStageMetrics(
    {
      stage,
      attempt,
      entered_at: startedAt,
      status: input.status === "running" ? "entered" : "succeeded",
    },
    {
      requirementChars: input.requirementChars,
      requirementLines: input.requirementLines,
      openapiOperationsCount: input.openapiOperationsCount,
      prismaModelsCount: input.prismaModelsCount,
      note: input.note,
    },
  );

  const runtime = applyRuntimeAliases({
    version: 1,
    started_at: startedAt,
    updated_at: startedAt,
    current_stage: stage,
    current_attempt: attempt,
    stages: [initialStage],
    repair_entered: isRepairStage(stage),
    critic_entered: isCriticStage(stage),
    repair_critic_entered: stage === "repair_critic",
    workflow_deadline_at: input.deadlineAt.toISOString(),
    final_outcome: input.status === "succeeded" ? "succeeded" : undefined,
    final_failure_stage: input.status === "failed" ? stage : null,
    final_failure_message: null,
    last_provider_stage: null,
    generation_model: input.generationModel,
    critic_model: input.criticModel,
    status: input.status ?? "running",
  });

  return runtime;
}

export function enterGenerationRuntimeStage(
  runtime: GeneratePackRuntimeMetadata,
  input: {
    stage: GenerationRuntimeStage;
    attempt: number;
  } & RuntimeStageMetrics,
) {
  const updatedAt = new Date().toISOString();
  const nextStage = mergeStageMetrics(
    {
      stage: input.stage,
      attempt: Math.max(input.attempt, 1),
      entered_at: updatedAt,
      status: "entered",
    },
    input,
  );

  return applyRuntimeAliases({
    ...runtime,
    updated_at: updatedAt,
    current_stage: input.stage,
    current_attempt: Math.max(input.attempt, 1),
    repair_entered: runtime.repair_entered || isRepairStage(input.stage),
    critic_entered: runtime.critic_entered || isCriticStage(input.stage),
    repair_critic_entered:
      runtime.repair_critic_entered || input.stage === "repair_critic",
    last_provider_stage: input.providerCall ? input.stage : runtime.last_provider_stage,
    stages: [...runtime.stages, nextStage],
    status: "running",
  });
}

export function completeGenerationRuntimeStage(
  runtime: GeneratePackRuntimeMetadata,
  input: {
    status: "succeeded" | "failed" | "skipped";
  } & RuntimeStageMetrics,
) {
  const updatedAt = new Date().toISOString();
  const stages = [...runtime.stages];
  const lastStage = stages.at(-1);

  if (!lastStage) {
    return runtime;
  }

  stages[stages.length - 1] = mergeStageMetrics(
    {
      ...lastStage,
      ...getStageExitValues(lastStage, updatedAt),
      status: input.status,
    },
    input,
  );

  return applyRuntimeAliases({
    ...runtime,
    updated_at: updatedAt,
    stages,
    status: "running",
  });
}

export function finalizeGenerationRuntimeFailure(
  runtime: GeneratePackRuntimeMetadata,
  input: FinalizeRuntimeInput,
) {
  const updatedAt = new Date().toISOString();
  const stages = [...runtime.stages];
  const lastStage = stages.at(-1);

  if (lastStage && !lastStage.exited_at) {
    stages[stages.length - 1] = mergeStageMetrics(
      {
        ...lastStage,
        ...getStageExitValues(lastStage, updatedAt),
        status: "failed",
      },
      input,
    );
  }

  return applyRuntimeAliases({
    ...runtime,
    updated_at: updatedAt,
    stages,
    final_outcome: input.finalOutcome,
    final_failure_stage: runtime.current_stage,
    final_failure_message: input.finalFailureMessage ?? null,
    status: "failed",
  });
}

export function finalizeGenerationRuntimeSuccess(
  runtime: GeneratePackRuntimeMetadata,
  input: RuntimeStageMetrics = {},
) {
  const updatedAt = new Date().toISOString();
  const stages = [...runtime.stages];
  const lastStage = stages.at(-1);

  if (lastStage && !lastStage.exited_at) {
    stages[stages.length - 1] = mergeStageMetrics(
      {
        ...lastStage,
        ...getStageExitValues(lastStage, updatedAt),
        status: "succeeded",
      },
      input,
    );
  }

  return applyRuntimeAliases({
    ...runtime,
    updated_at: updatedAt,
    stages,
    final_outcome: "succeeded",
    final_failure_stage: null,
    final_failure_message: null,
    status: "succeeded",
  });
}

export function getGenerationStagePresentation(stage: GenerationRuntimeStage) {
  switch (stage) {
    case "load_context":
      return {
        title: "Preparing generation inputs",
        description:
          "Loading the latest snapshot, artifacts, and grounding context before generation begins.",
      };
    case "initial_generation":
      return {
        title: "Generating draft pack",
        description:
          "Building the first grounded draft pack from the requirement and artifacts.",
      };
    case "initial_validation":
      return {
        title: "Validating generated pack",
        description:
          "Checking the generated pack against deterministic schema and pack rules.",
      };
    case "openapi_grounding":
      return {
        title: "Checking OpenAPI grounding",
        description:
          "Verifying API checks against the latest grounded OpenAPI artifact.",
      };
    case "prisma_grounding":
      return {
        title: "Checking Prisma grounding",
        description:
          "Verifying SQL checks against the latest grounded Prisma artifact.",
      };
    case "initial_critic":
      return {
        title: "Checking requirement coverage",
        description:
          "Running the critic to verify coverage quality and non-generic behavior.",
      };
    case "repair_generation":
      return {
        title: "Repairing generated pack",
        description:
          "Applying critic and grounding feedback to generate one repaired draft.",
      };
    case "repair_validation":
      return {
        title: "Validating repaired pack",
        description:
          "Re-checking the repaired draft against deterministic pack validation.",
      };
    case "repair_openapi_grounding":
      return {
        title: "Re-checking OpenAPI grounding",
        description:
          "Verifying repaired API checks against grounded OpenAPI operations again.",
      };
    case "repair_prisma_grounding":
      return {
        title: "Re-checking Prisma grounding",
        description:
          "Verifying repaired SQL checks against grounded Prisma models and fields again.",
      };
    case "repair_critic":
      return {
        title: "Re-checking requirement coverage",
        description:
          "Running the critic on the repaired draft before save.",
      };
    case "finalize":
      return {
        title: "Saving generated pack",
        description:
          "Persisting the validated pack and finalizing the job metadata.",
      };
  }
}

export function createGenerationRunContext(
  input: CreateGenerationRunContextInput,
) {
  const now = input.now ?? (() => new Date());
  const startedAt = input.startedAt ?? now();
  const deadlineMs = input.deadlineMs ?? GENERATE_PACK_WORKFLOW_DEADLINE_MS;
  const deadlineAt = new Date(startedAt.getTime() + deadlineMs);

  function remainingMs() {
    return deadlineAt.getTime() - now().getTime();
  }

  function assertWithinDeadline(stage: GenerationRuntimeStage) {
    if (remainingMs() <= 0) {
      throw new PackGenerationWorkflowDeadlineError(stage, deadlineAt);
    }
  }

  function getTimeoutMs(
    stage: GenerationRuntimeStage,
    stageBudgetMs: number,
  ) {
    assertWithinDeadline(stage);
    return Math.min(stageBudgetMs, Math.max(1, remainingMs()));
  }

  function buildRuntime(inputValue: {
    stage: GenerationRuntimeStage;
    attempt: number;
    status?: GenerationRuntimeStatus;
    requirementChars?: number;
    requirementLines?: number;
    openapiOperationsCount?: number;
    prismaModelsCount?: number;
    note?: string;
  }): GeneratePackRuntimeMetadata {
    return createInitialGenerationRuntimeMetadata({
      startedAt,
      deadlineAt,
      generationModel: input.generationModel,
      criticModel: input.criticModel,
      stage: inputValue.stage,
      attempt: inputValue.attempt,
      status: inputValue.status,
      requirementChars: inputValue.requirementChars,
      requirementLines: inputValue.requirementLines,
      openapiOperationsCount: inputValue.openapiOperationsCount,
      prismaModelsCount: inputValue.prismaModelsCount,
      note: inputValue.note,
    });
  }

  return {
    startedAt,
    deadlineAt,
    generationModel: input.generationModel,
    criticModel: input.criticModel,
    remainingMs,
    assertWithinDeadline,
    getTimeoutMs,
    buildRuntime,
  };
}

export type GenerationRunContext = ReturnType<typeof createGenerationRunContext>;
