import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveGeneratePackSuccessRuntime,
} from "@/server/packs/generatePackSuccess";
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
  stages?: GeneratePackRuntimeMetadata["stages"];
}): GeneratePackRuntimeMetadata {
  return {
    version: 1,
    started_at: input.started_at,
    updated_at: input.updated_at,
    current_stage: input.stage,
    current_attempt: input.attempt,
    stages:
      input.stages ??
      [
        {
          stage: input.stage,
          attempt: input.attempt,
          entered_at: input.started_at,
          exited_at: input.updated_at,
          duration_ms: 1,
          status: input.status === "running" ? "entered" : "succeeded",
        },
      ],
    repair_entered: input.stage.startsWith("repair_"),
    critic_entered:
      input.stage === "initial_critic" || input.stage === "repair_critic",
    repair_critic_entered: input.stage === "repair_critic",
    workflow_deadline_at: input.deadline_at,
    final_outcome: input.status === "succeeded" ? "succeeded" : undefined,
    final_failure_stage: null,
    final_failure_message: null,
    last_provider_stage: null,
    generation_model: input.generation_model,
    critic_model: input.critic_model,
    status: input.status,
    stage: input.stage,
    attempt: input.attempt,
    deadline_at: input.deadline_at,
  };
}

test("resolveGeneratePackSuccessRuntime prefers metadata runtime with richer stage history", () => {
  const metadataRuntime = createRuntime({
    status: "succeeded",
    stage: "repair_critic",
    attempt: 2,
    started_at: "2026-03-29T19:21:47.503Z",
    updated_at: "2026-03-29T19:27:16.000Z",
    deadline_at: "2026-03-29T19:33:47.503Z",
    generation_model: "gpt-5-mini",
    critic_model: "gpt-5-mini",
    stages: [
      {
        stage: "load_context",
        attempt: 1,
        entered_at: "2026-03-29T19:21:47.503Z",
        exited_at: "2026-03-29T19:21:47.520Z",
        duration_ms: 17,
        status: "succeeded",
      },
      {
        stage: "initial_generation",
        attempt: 1,
        entered_at: "2026-03-29T19:21:47.541Z",
        exited_at: "2026-03-29T19:24:02.149Z",
        duration_ms: 134608,
        status: "succeeded",
      },
      {
        stage: "repair_critic",
        attempt: 2,
        entered_at: "2026-03-29T19:26:00.000Z",
        exited_at: "2026-03-29T19:27:16.000Z",
        duration_ms: 76000,
        status: "succeeded",
      },
    ],
  });

  const lastRuntime = createRuntime({
    status: "running",
    stage: "load_context",
    attempt: 1,
    started_at: "2026-03-29T19:27:16.322Z",
    updated_at: "2026-03-29T19:27:16.322Z",
    deadline_at: "2026-03-29T19:39:16.322Z",
    generation_model: "gpt-5-mini",
    critic_model: "gpt-5-mini",
  });

  const fallbackRuntime = createRuntime({
    status: "running",
    stage: "load_context",
    attempt: 1,
    started_at: "2026-03-29T19:27:16.322Z",
    updated_at: "2026-03-29T19:27:16.322Z",
    deadline_at: "2026-03-29T19:39:16.322Z",
    generation_model: "gpt-5-mini",
    critic_model: "gpt-5-mini",
  });

  const runtime = resolveGeneratePackSuccessRuntime({
    metadataRuntime,
    lastRuntime,
    fallbackRuntime,
  });

  assert.equal(runtime.started_at, metadataRuntime.started_at);
  assert.equal(runtime.current_stage, "repair_critic");
  assert.equal(runtime.stages.length, 3);
});

test("resolveGeneratePackSuccessRuntime falls back to the newest non-fallback runtime when metadata runtime is absent", () => {
  const lastRuntime = createRuntime({
    status: "running",
    stage: "repair_validation",
    attempt: 2,
    started_at: "2026-03-29T19:21:47.503Z",
    updated_at: "2026-03-29T19:26:10.000Z",
    deadline_at: "2026-03-29T19:33:47.503Z",
    generation_model: "gpt-5-mini",
    critic_model: "gpt-5-mini",
    stages: [
      {
        stage: "load_context",
        attempt: 1,
        entered_at: "2026-03-29T19:21:47.503Z",
        exited_at: "2026-03-29T19:21:47.520Z",
        duration_ms: 17,
        status: "succeeded",
      },
      {
        stage: "repair_validation",
        attempt: 2,
        entered_at: "2026-03-29T19:26:00.000Z",
        status: "entered",
      },
    ],
  });

  const fallbackRuntime = createRuntime({
    status: "running",
    stage: "load_context",
    attempt: 1,
    started_at: "2026-03-29T19:27:16.322Z",
    updated_at: "2026-03-29T19:27:16.322Z",
    deadline_at: "2026-03-29T19:39:16.322Z",
    generation_model: "gpt-5-mini",
    critic_model: "gpt-5-mini",
  });

  const runtime = resolveGeneratePackSuccessRuntime({
    metadataRuntime: null,
    lastRuntime,
    fallbackRuntime,
  });

  assert.equal(runtime.current_stage, "repair_validation");
  assert.equal(runtime.stages.length, 2);
});
