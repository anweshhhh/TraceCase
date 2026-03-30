import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import { validatePackContent } from "@/server/packs/validatePack";
import {
  buildGenerationEvidence,
  buildGenerationJobSummary,
  buildArtifactGroundingReadiness,
  buildPackOverview,
  buildPackReviewHighlights,
  getGeneratePackJobFailurePresentation,
  readGeneratePackJobMetadata,
} from "@/lib/packUx";

test("readGeneratePackJobMetadata parses openai generation metadata", () => {
  const metadata = readGeneratePackJobMetadata({
    ai_mode: "openai",
    runtime: {
      version: 1,
      status: "succeeded",
      stage: "finalize",
      attempt: 2,
      started_at: "2026-03-14T08:00:00.000Z",
      updated_at: "2026-03-14T08:04:00.000Z",
      deadline_at: "2026-03-14T08:12:00.000Z",
      current_stage: "finalize",
      current_attempt: 2,
      stages: [
        {
          stage: "initial_generation",
          attempt: 1,
          entered_at: "2026-03-14T08:00:05.000Z",
          exited_at: "2026-03-14T08:02:05.000Z",
          duration_ms: 120000,
          status: "succeeded",
          provider_call: true,
          model: "gpt-5",
          timeout_ms: 240000,
          requirement_chars: 1200,
          requirement_lines: 28,
          openapi_operations_count: 3,
          prisma_models_count: 2,
          pack_api_checks_count: 2,
          pack_sql_checks_count: 1,
        },
      ],
      repair_entered: true,
      critic_entered: true,
      repair_critic_entered: true,
      workflow_deadline_at: "2026-03-14T08:12:00.000Z",
      final_outcome: "succeeded",
      final_failure_stage: null,
      final_failure_message: null,
      last_provider_stage: "repair_critic",
      generation_model: "gpt-5",
      critic_model: "gpt-5-mini",
    },
    ai: {
      provider: "openai",
      model: "gpt-5",
      critic_model: "gpt-5-mini",
      attempts: 2,
      coverage_plan: {
        acceptance_criteria_total: 2,
        items: [
          {
            id: "AC-01",
            text: "The login form shows email and password fields and a Continue button.",
            expected_layers: ["UI"],
          },
          {
            id: "AC-02",
            text: "Successful OTP verification creates a session and updates User.lastLoginAt.",
            expected_layers: ["SQL", "SESSION"],
          },
        ],
      },
      coverage_map: {
        total: 2,
        covered: 2,
        uncovered_ids: [],
      },
      coverage_closure_plan: {
        uncovered_ids: ["AC-01"],
        obligations: [
          {
            id: "AC-01",
            required_action: "add_ui_case",
            expected_layers: ["UI"],
          },
        ],
      },
      coverage_closure_validation: {
        status: "closed",
        still_unclosed: [],
      },
      sanitization: {
        initial: {
          fixes_applied_count: 1,
          kinds: ["source_ref_range_swapped"],
        },
        repair: {
          fixes_applied_count: 2,
          kinds: ["trimmed_text", "api_method_normalized"],
        },
      },
      compensating_coverage: {
        status: "insufficient",
        issues: [
          {
            id: "AC-02",
            reason: "Session AC only has semantic SQL coverage after fallback.",
          },
        ],
      },
      critic: {
        phase: "repair",
        verdict: "pass",
        coverage: {
          acceptance_criteria_total: 3,
          acceptance_criteria_covered: 3,
          uncovered: [],
        },
        major_risks: ["risk"],
        quality_notes: ["note"],
      },
      grounding: {
        openapi: {
          status: "grounded",
          artifact_id: "art_123",
          operations_available: 3,
          api_checks_total: 2,
          api_checks_grounded: 2,
          mismatches: [],
        },
        prisma: {
          status: "grounded",
          artifact_id: "art_prisma",
          models_available: 2,
          sql_checks_total: 1,
          sql_checks_grounded: 1,
          sql_checks_semantic: 0,
          mismatches: [],
        },
      },
    },
  });

  assert.equal(metadata?.ai_mode, "openai");
  if (metadata?.ai_mode === "openai" && metadata.ai) {
    assert.equal(metadata.ai.grounding.openapi.status, "grounded");
    assert.equal(metadata.ai.grounding.prisma.status, "grounded");
    assert.equal(metadata.ai.coverage_plan?.acceptance_criteria_total, 2);
    assert.equal(metadata.ai.coverage_map?.covered, 2);
    assert.equal(metadata.ai.coverage_closure_plan?.obligations[0]?.id, "AC-01");
    assert.equal(metadata.ai.coverage_closure_validation?.status, "closed");
    assert.equal(metadata.ai.sanitization?.initial?.fixes_applied_count, 1);
    assert.equal(metadata.ai.sanitization?.repair?.kinds[1], "api_method_normalized");
    assert.equal(metadata.ai.compensating_coverage?.status, "insufficient");
    assert.equal(metadata.ai.compensating_coverage?.issues[0]?.id, "AC-02");
    assert.equal(metadata.ai.critic.phase, "repair");
    assert.equal(metadata.runtime?.generation_model, "gpt-5");
  }
});

test("readGeneratePackJobMetadata parses running runtime-only metadata", () => {
  const metadata = readGeneratePackJobMetadata({
    ai_mode: "openai",
    runtime: {
      status: "running",
      stage: "initial_critic",
      attempt: 1,
      started_at: "2026-03-14T08:00:00.000Z",
      updated_at: "2026-03-14T08:01:00.000Z",
      deadline_at: "2026-03-14T08:12:00.000Z",
      generation_model: "gpt-5",
      critic_model: "gpt-5-mini",
    },
  });

  assert.equal(metadata?.ai_mode, "openai");
  if (metadata?.ai_mode === "openai") {
    assert.equal(metadata.ai, undefined);
    assert.equal(metadata.runtime?.stage, "initial_critic");
  }
});

test("getGeneratePackJobFailurePresentation classifies common failure causes", () => {
  assert.equal(
    getGeneratePackJobFailurePresentation(
      "fetch failed | connect ECONNREFUSED 127.0.0.1:8288",
    ).label,
    "Dispatch issue",
  );
  assert.equal(
    getGeneratePackJobFailurePresentation(
      "OpenAI request timed out while generating the pack. Please retry.",
      {
        ai_mode: "openai",
        runtime: {
          status: "failed",
          stage: "repair_generation",
          attempt: 2,
          started_at: "2026-03-14T08:00:00.000Z",
          updated_at: "2026-03-14T08:05:00.000Z",
          deadline_at: "2026-03-14T08:12:00.000Z",
          final_outcome: "provider_timeout",
          final_failure_stage: "repair_generation",
          final_failure_message:
            "OpenAI request timed out while generating the pack. Please retry.",
          last_provider_stage: "repair_generation",
          generation_model: "gpt-5",
          critic_model: "gpt-5-mini",
        },
      },
    ).label,
    "AI provider timeout",
  );
  assert.equal(
    getGeneratePackJobFailurePresentation(
      "AI-generated API checks did not match the grounded OpenAPI artifact after repair.",
    ).label,
    "Grounding mismatch",
  );
  assert.equal(
    getGeneratePackJobFailurePresentation(
      "Pack generation exceeded the 12-minute workflow deadline during repair_critic. Please retry.",
      {
        ai_mode: "openai",
        runtime: {
          status: "failed",
          stage: "repair_critic",
          attempt: 2,
          started_at: "2026-03-14T08:00:00.000Z",
          updated_at: "2026-03-14T08:12:00.000Z",
          deadline_at: "2026-03-14T08:12:00.000Z",
          final_outcome: "workflow_deadline",
          final_failure_stage: "repair_critic",
          final_failure_message:
            "Pack generation exceeded the 12-minute workflow deadline during repair_critic. Please retry.",
          generation_model: "gpt-5",
          critic_model: "gpt-5-mini",
        },
      },
    ).label,
    "Workflow deadline exceeded",
  );
});

test("buildArtifactGroundingReadiness reports valid invalid and missing states", () => {
  const readiness = buildArtifactGroundingReadiness([
    {
      type: "OPENAPI",
      parse_summary: {
        status: "valid",
        artifact_type: "OPENAPI",
        format: "yaml",
        openapi_version: "3.0.3",
        operations_count: 3,
        operations: [],
        errors: [],
        parsed_at: "2026-03-12T00:00:00.000Z",
      },
    },
    {
      type: "PRISMA_SCHEMA",
      parse_summary: {
        status: "invalid",
        artifact_type: "PRISMA_SCHEMA",
        model_count: 0,
        models: [],
        errors: ["Unexpected token"],
        parsed_at: "2026-03-12T00:00:00.000Z",
      },
    },
  ]);

  assert.deepEqual(readiness, [
    {
      type: "OPENAPI",
      status: "valid",
      label: "OpenAPI",
      note: "3 grounded operations available.",
    },
    {
      type: "PRISMA_SCHEMA",
      status: "invalid",
      label: "Prisma",
      note: "Unexpected token",
    },
  ]);

  const missing = buildArtifactGroundingReadiness([]);
  assert.equal(missing[0]?.status, "missing");
  assert.match(missing[0]?.note ?? "", /grounding will be skipped/i);
});

test("buildGenerationJobSummary emphasizes active success and failure states", () => {
  assert.deepEqual(
    buildGenerationJobSummary({
      status: "RUNNING",
      metadata: {
        ai_mode: "openai",
        runtime: {
          status: "running",
          stage: "initial_critic",
          attempt: 1,
          started_at: "2026-03-14T08:00:00.000Z",
          updated_at: "2026-03-14T08:01:00.000Z",
          deadline_at: "2026-03-14T08:12:00.000Z",
          generation_model: "gpt-5",
          critic_model: "gpt-5-mini",
        },
      },
    }),
    {
      title: "Checking requirement coverage",
      description:
        "Running the critic to verify coverage quality and non-generic behavior.",
      tone: "secondary",
    },
  );

  assert.deepEqual(
    buildGenerationJobSummary({
      status: "SUCCEEDED",
      metadata: {
        ai_mode: "openai",
        ai: {
          provider: "openai",
          model: "gpt-5",
          critic_model: "gpt-5-mini",
          attempts: 2,
          critic: {
            verdict: "pass",
            coverage: {
              acceptance_criteria_total: 2,
              acceptance_criteria_covered: 2,
              uncovered: [],
            },
            major_risks: [],
            quality_notes: [],
          },
          grounding: {
            openapi: {
              status: "grounded",
              artifact_id: "art_123",
              operations_available: 3,
              api_checks_total: 2,
              api_checks_grounded: 2,
              mismatches: [],
            },
            prisma: {
              status: "grounded",
              artifact_id: "art_prisma",
              models_available: 2,
              sql_checks_total: 1,
              sql_checks_grounded: 1,
              sql_checks_semantic: 0,
              mismatches: [],
            },
          },
        },
      },
    }),
    {
      title: "Draft ready",
      description:
        "gpt-5 completed in 2 attempts. Critic pass; Grounded API checks 2/2.",
      tone: "default",
    },
  );

  assert.deepEqual(
    buildGenerationJobSummary({
      status: "FAILED",
      metadata: {
        ai_mode: "openai",
        runtime: {
          status: "failed",
          stage: "repair_critic",
          attempt: 2,
          started_at: "2026-03-14T08:00:00.000Z",
          updated_at: "2026-03-14T08:12:00.000Z",
          deadline_at: "2026-03-14T08:12:00.000Z",
          generation_model: "gpt-5",
          critic_model: "gpt-5-mini",
        },
      },
      error:
        "Pack generation exceeded the 12-minute workflow deadline during repair_critic. Please retry.",
    }),
    {
      title: "Workflow deadline exceeded",
      description:
        "Generation hit the 12-minute workflow deadline during re-checking requirement coverage. Retry once; if it repeats, reduce grounding/context size or use a stronger generation model.",
      tone: "destructive",
    },
  );
});

test("buildGenerationEvidence returns compact proof metrics and notes", () => {
  assert.deepEqual(buildGenerationEvidence(null), null);

  assert.deepEqual(buildGenerationEvidence({ ai_mode: "placeholder" }), {
    metrics: [
      {
        label: "Mode",
        value: "Placeholder",
        tone: "secondary",
      },
    ],
    notes: ["Placeholder mode does not include critic or grounding proof."],
  });

  assert.deepEqual(
    buildGenerationEvidence({
      ai_mode: "openai",
      ai: {
        provider: "openai",
        model: "gpt-5",
        critic_model: "gpt-5-mini",
        attempts: 2,
        critic: {
          verdict: "pass",
          coverage: {
            acceptance_criteria_total: 5,
            acceptance_criteria_covered: 5,
            uncovered: [],
          },
          major_risks: [
            "Lockout timing can be flaky in distributed environments.",
          ],
          quality_notes: [],
        },
        grounding: {
          openapi: {
            status: "grounded",
            artifact_id: "artifact_12345678",
            operations_available: 3,
            api_checks_total: 4,
            api_checks_grounded: 4,
            mismatches: [],
          },
          prisma: {
            status: "grounded",
            artifact_id: "prisma_12345678",
            models_available: 2,
            sql_checks_total: 1,
            sql_checks_grounded: 1,
            sql_checks_semantic: 0,
            mismatches: [],
          },
        },
      },
    }),
    {
      metrics: [
        {
          label: "Coverage",
          value: "5/5",
          tone: "default",
        },
        {
          label: "Attempts",
          value: "2",
          tone: "secondary",
        },
        {
          label: "Grounding",
          value: "grounded",
          tone: "default",
        },
        {
          label: "API Checks",
          value: "4/4",
          tone: "default",
        },
        {
          label: "Operations",
          value: "3",
          tone: "secondary",
        },
        {
          label: "SQL Checks",
          value: "1/1",
          tone: "default",
        },
      ],
      notes: [
        "Grounded against OpenAPI artifact artifact.",
        "Grounded against Prisma artifact prisma_1.",
        "One repair loop was used before the final result was stored.",
        "Top critic risk: Lockout timing can be flaky in distributed environments.",
      ],
    },
  );
});

test("buildPackOverview and buildPackReviewHighlights summarize canonical packs", () => {
  const content = validatePackContent(structuredClone(examplePack)).value;
  const overview = buildPackOverview(content);
  const highlights = buildPackReviewHighlights({
    content,
    metadata: {
      ai_mode: "openai",
      ai: {
        provider: "openai",
        model: "gpt-5-mini",
        attempts: 1,
        critic: {
          verdict: "pass",
          coverage: {
            acceptance_criteria_total: 2,
            acceptance_criteria_covered: 2,
            uncovered: [],
          },
          major_risks: ["Race conditions"],
          quality_notes: ["Well grounded"],
        },
        grounding: {
          openapi: {
            status: "grounded",
            artifact_id: "art_123",
            operations_available: 1,
            api_checks_total: 1,
            api_checks_grounded: 1,
            mismatches: [],
          },
          prisma: {
            status: "grounded",
            artifact_id: "art_prisma",
            models_available: 1,
            sql_checks_total: 1,
            sql_checks_grounded: 1,
            sql_checks_semantic: 0,
            mismatches: [],
          },
        },
      },
    },
  });

  assert.equal(overview[0]?.label, "Scenarios");
  assert.equal(overview[0]?.value, 1);
  assert.equal(highlights.clarifyingQuestions.length, 1);
  assert.equal(highlights.assumptions.length, 2);
  assert.deepEqual(highlights.majorRisks, ["Race conditions"]);
  assert.deepEqual(highlights.qualityNotes, ["Well grounded"]);
});
