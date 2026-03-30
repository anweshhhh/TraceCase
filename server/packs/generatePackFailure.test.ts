import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeGeneratePackFailureMetadata,
  shouldStopRetryingGeneratePackError,
} from "@/server/packs/generatePackFailure";
import { AiPackGenerationError } from "@/server/packs/generateAiPack";
import type {
  GeneratePackRuntimeMetadata,
  GenerationRuntimeStage,
  GenerationRuntimeStatus,
} from "@/server/packs/generationRunContext";

function createRuntime(input: {
  status: GenerationRuntimeStatus;
  stage: GenerationRuntimeStage;
  attempt: number;
  started_at: string;
  updated_at: string;
  deadline_at: string;
  generation_model: string;
  critic_model: string;
  final_outcome?: GeneratePackRuntimeMetadata["final_outcome"];
  final_failure_stage?: GeneratePackRuntimeMetadata["final_failure_stage"];
  final_failure_message?: string | null;
  last_provider_stage?: GeneratePackRuntimeMetadata["last_provider_stage"];
}): GeneratePackRuntimeMetadata {
  return {
    version: 1,
    started_at: input.started_at,
    updated_at: input.updated_at,
    current_stage: input.stage,
    current_attempt: input.attempt,
    stages: [
      {
        stage: input.stage,
        attempt: input.attempt,
        entered_at: input.started_at,
        status: input.status === "running" ? "entered" : "failed",
      },
    ],
    repair_entered: input.stage.startsWith("repair_"),
    critic_entered:
      input.stage === "initial_critic" || input.stage === "repair_critic",
    repair_critic_entered: input.stage === "repair_critic",
    workflow_deadline_at: input.deadline_at,
    final_outcome: input.final_outcome,
    final_failure_stage: input.final_failure_stage,
    final_failure_message: input.final_failure_message ?? null,
    last_provider_stage: input.last_provider_stage ?? null,
    generation_model: input.generation_model,
    critic_model: input.critic_model,
    status: input.status,
    stage: input.stage,
    attempt: input.attempt,
    deadline_at: input.deadline_at,
  };
}

test("finalizeGeneratePackFailureMetadata prefers the last real runtime stage over fallback load_context metadata", () => {
  const metadata = finalizeGeneratePackFailureMetadata({
    errorMetadata: {
      ai_mode: "openai",
      runtime: createRuntime({
        status: "failed",
        stage: "load_context",
        attempt: 1,
        started_at: "2026-03-15T17:00:00.000Z",
        updated_at: "2026-03-15T17:30:00.000Z",
        deadline_at: "2026-03-15T17:12:00.000Z",
        generation_model: "gpt-5-mini",
        critic_model: "gpt-5-mini",
      }),
    },
    lastRuntime: createRuntime({
      status: "running",
      stage: "repair_critic",
      attempt: 2,
      started_at: "2026-03-15T17:00:00.000Z",
      updated_at: "2026-03-15T17:10:00.000Z",
      deadline_at: "2026-03-15T17:12:00.000Z",
      generation_model: "gpt-5-mini",
      critic_model: "gpt-5-mini",
    }),
    fallbackRuntime: createRuntime({
      status: "failed",
      stage: "load_context",
      attempt: 1,
      started_at: "2026-03-15T17:00:00.000Z",
      updated_at: "2026-03-15T17:30:00.000Z",
      deadline_at: "2026-03-15T17:12:00.000Z",
      generation_model: "gpt-5-mini",
      critic_model: "gpt-5-mini",
    }),
  });

  assert.equal(metadata.runtime?.stage, "repair_critic");
  assert.equal(metadata.runtime?.attempt, 2);
  assert.equal(metadata.runtime?.status, "failed");
});

test("finalizeGeneratePackFailureMetadata preserves richer AI metadata when present", () => {
  const metadata = finalizeGeneratePackFailureMetadata({
    errorMetadata: {
      ai_mode: "openai",
      ai: {
        provider: "openai",
        model: "gpt-5-mini",
        attempts: 2,
        critic_model: "gpt-5-mini",
        critic: {
          verdict: "pass",
          coverage: {
            acceptance_criteria_total: 1,
            acceptance_criteria_covered: 1,
            uncovered: [],
          },
          major_risks: [],
          quality_notes: [],
        },
        grounding: {
          openapi: {
            status: "skipped",
            artifact_id: null,
            operations_available: 0,
            api_checks_total: 0,
            api_checks_grounded: 0,
            mismatches: [],
            validated_operations: [],
          },
          prisma: {
            status: "skipped",
            artifact_id: null,
            models_available: 0,
            sql_checks_total: 0,
            sql_checks_grounded: 0,
            sql_checks_semantic: 0,
            mismatches: [],
            grounded_models: [],
          },
        },
      },
      runtime: createRuntime({
        status: "failed",
        stage: "repair_critic",
        attempt: 2,
        started_at: "2026-03-15T17:00:00.000Z",
        updated_at: "2026-03-15T17:10:00.000Z",
        deadline_at: "2026-03-15T17:12:00.000Z",
        generation_model: "gpt-5-mini",
        critic_model: "gpt-5-mini",
      }),
    },
    fallbackRuntime: createRuntime({
      status: "failed",
      stage: "load_context",
      attempt: 1,
      started_at: "2026-03-15T17:00:00.000Z",
      updated_at: "2026-03-15T17:30:00.000Z",
      deadline_at: "2026-03-15T17:12:00.000Z",
      generation_model: "gpt-5-mini",
      critic_model: "gpt-5-mini",
    }),
  });

  assert.equal(metadata.ai?.attempts, 2);
  assert.equal(metadata.runtime?.stage, "repair_critic");
});

test("finalizeGeneratePackFailureMetadata prefers persisted runtime from the job row when replay reset local state", () => {
  const metadata = finalizeGeneratePackFailureMetadata({
    persistedMetadata: {
      ai_mode: "openai",
      runtime: createRuntime({
        status: "running",
        stage: "initial_critic",
        attempt: 1,
        started_at: "2026-03-15T19:38:55.800Z",
        updated_at: "2026-03-15T19:42:00.000Z",
        deadline_at: "2026-03-15T19:50:55.800Z",
        generation_model: "gpt-5-mini",
        critic_model: "gpt-5-mini",
      }),
    },
    lastRuntime: createRuntime({
      status: "running",
      stage: "load_context",
      attempt: 1,
      started_at: "2026-03-15T19:43:52.350Z",
      updated_at: "2026-03-15T19:43:52.350Z",
      deadline_at: "2026-03-15T19:55:52.350Z",
      generation_model: "gpt-5-mini",
      critic_model: "gpt-5-mini",
    }),
    fallbackRuntime: createRuntime({
      status: "failed",
      stage: "load_context",
      attempt: 1,
      started_at: "2026-03-15T19:43:52.350Z",
      updated_at: "2026-03-15T19:43:52.350Z",
      deadline_at: "2026-03-15T19:55:52.350Z",
      generation_model: "gpt-5-mini",
      critic_model: "gpt-5-mini",
    }),
  });

  assert.equal(metadata.runtime?.stage, "initial_critic");
  assert.equal(metadata.runtime?.attempt, 1);
  assert.equal(metadata.runtime?.started_at, "2026-03-15T19:38:55.800Z");
});

test("shouldStopRetryingGeneratePackError treats deterministic AI generation failures as non-retryable", () => {
  const error = new AiPackGenerationError("AI-generated pack still has uncovered acceptance criteria after one repair attempt.", {
    ai_mode: "openai",
    runtime: createRuntime({
      status: "failed",
      stage: "repair_critic",
      attempt: 2,
      started_at: "2026-03-15T17:00:00.000Z",
      updated_at: "2026-03-15T17:10:00.000Z",
      deadline_at: "2026-03-15T17:12:00.000Z",
      generation_model: "gpt-5-mini",
      critic_model: "gpt-5-mini",
    }),
  });

  assert.equal(shouldStopRetryingGeneratePackError(error), true);
  assert.equal(
    shouldStopRetryingGeneratePackError(
      new Error("OpenAI request timed out while generating the pack. Please retry."),
    ),
    true,
  );
  assert.equal(
    shouldStopRetryingGeneratePackError(new Error("Requirement snapshot not found.")),
    false,
  );
});
