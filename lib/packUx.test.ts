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
    ai: {
      provider: "openai",
      model: "gpt-5-mini",
      attempts: 2,
      critic: {
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
      },
    },
  });

  assert.equal(metadata?.ai_mode, "openai");
  if (metadata?.ai_mode === "openai") {
    assert.equal(metadata.ai.grounding.openapi.status, "grounded");
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
      "AI-generated API checks did not match the grounded OpenAPI artifact after repair.",
    ).label,
    "Grounding mismatch",
  );
  assert.equal(
    getGeneratePackJobFailurePresentation(
      "Generation job timed out or the worker stopped before completion. Please retry.",
    ).label,
    "Worker interrupted",
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
      metadata: null,
    }),
    {
      title: "Generation in progress",
      description:
        "OpenAI generation can take a few minutes, especially when repair or grounding is active. Keep this page open; status refreshes automatically.",
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
          model: "gpt-5-mini",
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
          },
        },
      },
    }),
    {
      title: "Draft ready",
      description:
        "gpt-5-mini completed in 2 attempts. Critic pass; Grounded API checks 2/2.",
      tone: "default",
    },
  );

  assert.deepEqual(
    buildGenerationJobSummary({
      status: "FAILED",
      metadata: null,
      error:
        "AI-generated API checks did not match the grounded OpenAPI artifact after repair.",
    }),
    {
      title: "Grounding mismatch",
      description:
        "Generated API checks still referenced operations outside the grounded OpenAPI artifact after repair.",
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
        model: "gpt-5-mini",
        attempts: 2,
        critic: {
          verdict: "pass",
          coverage: {
            acceptance_criteria_total: 5,
            acceptance_criteria_covered: 5,
            uncovered: [],
          },
          major_risks: ["Lockout timing can be flaky in distributed environments."],
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
      ],
      notes: [
        "Grounded against OpenAPI artifact artifact.",
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
