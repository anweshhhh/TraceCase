import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import { validatePackContent } from "@/server/packs/validatePack";
import {
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
