import assert from "node:assert/strict";
import test from "node:test";
import {
  AiPackGenerationError,
  type OpenAiJobMetadata,
} from "@/server/packs/generateAiPack";
import {
  restoreGeneratePackStepError,
  serializeGeneratePackStepError,
} from "@/server/packs/generatePackStepError";

function getMetadata(): OpenAiJobMetadata {
  return {
    ai_mode: "openai",
    runtime: {
      status: "failed",
      stage: "repair_critic",
      attempt: 2,
      started_at: "2026-03-29T18:50:15.500Z",
      updated_at: "2026-03-29T18:53:51.402Z",
      deadline_at: "2026-03-29T19:02:15.500Z",
      current_stage: "repair_critic",
      current_attempt: 2,
      version: 1,
      stages: [],
      repair_entered: true,
      critic_entered: true,
      repair_critic_entered: true,
      final_outcome: "critic_coverage",
      final_failure_stage: "repair_critic",
      final_failure_message:
        "AI-generated pack still has uncovered acceptance criteria after one repair attempt.",
      generation_model: "gpt-5-mini",
      critic_model: "gpt-5-mini",
    },
    ai: {
      provider: "openai",
      model: "gpt-5-mini",
      attempts: 2,
      critic: {
        phase: "repair",
        verdict: "needs_work",
        coverage: {
          acceptance_criteria_total: 18,
          acceptance_criteria_covered: 17,
          uncovered: [
            {
              id: "AC-05",
              criterion:
                "The OTP verification screen shows an OTP input, Verify button, and Resend code button.",
              why_uncovered:
                "The repaired pack still does not add explicit UI coverage for the OTP verification screen.",
            },
          ],
        },
        major_risks: [],
        quality_notes: [],
      },
      grounding: {
        openapi: {
          status: "grounded",
          artifact_id: "art_openapi",
          operations_available: 3,
          api_checks_total: 5,
          api_checks_grounded: 5,
          mismatches: [],
        },
        prisma: {
          status: "grounded",
          artifact_id: "art_prisma",
          models_available: 4,
          sql_checks_total: 4,
          sql_checks_grounded: 0,
          sql_checks_semantic: 4,
          mismatches: [],
          grounded_models: [],
        },
      },
    },
  };
}

test("serializeGeneratePackStepError captures OpenAI generation metadata for step transport", () => {
  const metadata = getMetadata();
  const error = new AiPackGenerationError(
    "AI-generated pack still has uncovered acceptance criteria after one repair attempt.",
    metadata,
  );

  const serialized = serializeGeneratePackStepError(error);

  assert.ok(serialized);
  assert.equal(serialized?.message, error.message);
  assert.equal(serialized?.metadata.ai?.critic.coverage.uncovered[0]?.id, "AC-05");
});

test("serializeGeneratePackStepError ignores non-AI generation errors", () => {
  assert.equal(serializeGeneratePackStepError(new Error("boom")), null);
});

test("restoreGeneratePackStepError rebuilds AiPackGenerationError with metadata intact", () => {
  const metadata = getMetadata();
  const restored = restoreGeneratePackStepError({
    message:
      "AI-generated pack still has uncovered acceptance criteria after one repair attempt.",
    metadata,
  });

  assert.ok(restored instanceof AiPackGenerationError);
  assert.equal(restored.metadata.ai?.critic.phase, "repair");
  assert.equal(restored.metadata.ai?.critic.coverage.uncovered[0]?.id, "AC-05");
});
