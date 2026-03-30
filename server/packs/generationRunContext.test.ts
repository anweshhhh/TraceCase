import assert from "node:assert/strict";
import test from "node:test";
import {
  completeGenerationRuntimeStage,
  createGenerationRunContext,
  enterGenerationRuntimeStage,
  finalizeGenerationRuntimeFailure,
  GENERATE_PACK_GENERATION_STAGE_TIMEOUT_MS,
  PackGenerationWorkflowDeadlineError,
} from "@/server/packs/generationRunContext";

test("createGenerationRunContext tracks remaining workflow budget", () => {
  const currentTime = new Date("2026-03-14T08:00:00.000Z");
  const context = createGenerationRunContext({
    startedAt: currentTime,
    deadlineMs: 10_000,
    now: () => currentTime,
    generationModel: "gpt-5",
    criticModel: "gpt-5-mini",
  });

  assert.equal(context.remainingMs(), 10_000);

  currentTime.setTime(Date.parse("2026-03-14T08:00:06.500Z"));
  assert.equal(context.remainingMs(), 3_500);
});

test("createGenerationRunContext caps stage timeout to remaining workflow budget", () => {
  const currentTime = new Date("2026-03-14T08:00:00.000Z");
  const context = createGenerationRunContext({
    startedAt: currentTime,
    deadlineMs: 5_000,
    now: () => currentTime,
    generationModel: "gpt-5",
    criticModel: "gpt-5-mini",
  });

  assert.equal(
    context.getTimeoutMs(
      "initial_generation",
      GENERATE_PACK_GENERATION_STAGE_TIMEOUT_MS,
    ),
    5_000,
  );
});

test("createGenerationRunContext throws a workflow deadline error after the budget is exhausted", () => {
  const startedAt = new Date("2026-03-14T08:00:00.000Z");
  const context = createGenerationRunContext({
    startedAt,
    deadlineMs: 1_000,
    now: () => new Date("2026-03-14T08:00:02.000Z"),
    generationModel: "gpt-5",
    criticModel: "gpt-5-mini",
  });

  assert.throws(
    () => context.assertWithinDeadline("repair_critic"),
    (error) => {
      assert.ok(error instanceof PackGenerationWorkflowDeadlineError);
      assert.equal(error.stage, "repair_critic");
      assert.match(error.message, /workflow deadline/i);
      return true;
    },
  );
});

test("generation runtime metadata records stage evidence, repair flags, and final outcome", () => {
  const context = createGenerationRunContext({
    startedAt: new Date("2026-03-14T08:00:00.000Z"),
    generationModel: "gpt-5",
    criticModel: "gpt-5-mini",
  });

  let runtime = context.buildRuntime({
    stage: "load_context",
    attempt: 1,
    requirementChars: 1200,
    requirementLines: 28,
    openapiOperationsCount: 3,
    prismaModelsCount: 2,
  });

  runtime = enterGenerationRuntimeStage(runtime, {
    stage: "repair_critic",
    attempt: 2,
    providerCall: true,
    model: "gpt-5-mini",
    timeoutMs: 90_000,
  });
  runtime = completeGenerationRuntimeStage(runtime, {
    status: "failed",
    packApiChecksCount: 2,
    packSqlChecksCount: 1,
    semanticSqlChecksCount: 1,
    mismatchCount: 2,
    note: "Coverage still missing resend invalidation proof.",
  });
  runtime = finalizeGenerationRuntimeFailure(runtime, {
    finalOutcome: "critic_coverage",
    finalFailureMessage:
      "AI-generated pack still has uncovered acceptance criteria after one repair attempt.",
    packApiChecksCount: 2,
    packSqlChecksCount: 1,
    semanticSqlChecksCount: 1,
    mismatchCount: 2,
  });

  assert.equal(runtime.version, 1);
  assert.equal(runtime.stage, "repair_critic");
  assert.equal(runtime.current_stage, "repair_critic");
  assert.equal(runtime.attempt, 2);
  assert.equal(runtime.critic_entered, true);
  assert.equal(runtime.repair_entered, true);
  assert.equal(runtime.repair_critic_entered, true);
  assert.equal(runtime.last_provider_stage, "repair_critic");
  assert.equal(runtime.final_outcome, "critic_coverage");
  assert.equal(runtime.final_failure_stage, "repair_critic");
  assert.match(runtime.final_failure_message ?? "", /acceptance criteria/i);
  assert.equal(runtime.stages.length, 2);
  assert.equal(runtime.stages[1]?.status, "failed");
  assert.equal(runtime.stages[1]?.provider_call, true);
  assert.equal(runtime.stages[1]?.pack_api_checks_count, 2);
  assert.equal(runtime.stages[1]?.semantic_sql_checks_count, 1);
});
