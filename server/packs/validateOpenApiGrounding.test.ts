import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import type { OpenApiGroundingSummary } from "@/server/openapiGrounding";
import { validateOpenApiGrounding } from "@/server/packs/validateOpenApiGrounding";
import { validatePackContent } from "@/server/packs/validatePack";

function cloneExamplePack() {
  return structuredClone(examplePack);
}

function buildGroundingSummary(
  operations: Array<{ method: string; path: string }>,
): OpenApiGroundingSummary {
  return {
    artifact_id: "art_openapi_123",
    operations_count: operations.length,
    operations,
  };
}

test("validateOpenApiGrounding passes exact method/path matches", () => {
  const pack = validatePackContent(cloneExamplePack()).value;
  const report = validateOpenApiGrounding(
    pack,
    buildGroundingSummary([{ method: "post", path: "/api/v1/auth/login" }]),
  );

  assert.equal(report.status, "grounded");
  assert.equal(report.api_checks_total, 1);
  assert.equal(report.api_checks_grounded, 1);
  assert.deepEqual(report.mismatches, []);
});

test("validateOpenApiGrounding normalizes method case and endpoint leading slash", () => {
  const packInput = cloneExamplePack();
  packInput.checks.api[0].method = "POST";
  packInput.checks.api[0].endpoint = "api/v1/auth/login";

  const pack = validatePackContent(packInput).value;
  const report = validateOpenApiGrounding(
    pack,
    buildGroundingSummary([{ method: "post", path: "/api/v1/auth/login" }]),
  );

  assert.equal(report.status, "grounded");
  assert.equal(report.api_checks_grounded, 1);
});

test("validateOpenApiGrounding reports mismatched endpoints", () => {
  const pack = validatePackContent(cloneExamplePack()).value;
  const report = validateOpenApiGrounding(
    pack,
    buildGroundingSummary([{ method: "post", path: "/api/v1/auth/verify-otp" }]),
  );

  assert.equal(report.status, "needs_repair");
  assert.equal(report.api_checks_grounded, 0);
  assert.equal(report.mismatches[0]?.check_id, "CHK-API-001");
  assert.match(report.mismatches[0]?.reason ?? "", /not defined/i);
});

test("validateOpenApiGrounding reports mismatched methods", () => {
  const pack = validatePackContent(cloneExamplePack()).value;
  const report = validateOpenApiGrounding(
    pack,
    buildGroundingSummary([{ method: "get", path: "/api/v1/auth/login" }]),
  );

  assert.equal(report.status, "needs_repair");
  assert.equal(report.mismatches[0]?.method, "post");
});

test("validateOpenApiGrounding grounds empty API checks when artifact exists", () => {
  const packInput = cloneExamplePack();
  packInput.checks.api = [];

  const pack = validatePackContent(packInput).value;
  const report = validateOpenApiGrounding(
    pack,
    buildGroundingSummary([{ method: "post", path: "/api/v1/auth/login" }]),
  );

  assert.equal(report.status, "grounded");
  assert.equal(report.api_checks_total, 0);
  assert.equal(report.api_checks_grounded, 0);
});

test("validateOpenApiGrounding skips validation when no artifact exists", () => {
  const pack = validatePackContent(cloneExamplePack()).value;
  const report = validateOpenApiGrounding(pack, null);

  assert.equal(report.status, "skipped");
  assert.equal(report.artifact_id, null);
  assert.equal(report.operations_available, 0);
});

test("validateOpenApiGrounding returns deterministically sorted operations", () => {
  const pack = validatePackContent(cloneExamplePack()).value;
  const report = validateOpenApiGrounding(
    pack,
    buildGroundingSummary([
      { method: "post", path: "/zeta" },
      { method: "get", path: "/alpha" },
      { method: "post", path: "/alpha" },
    ]),
  );

  assert.deepEqual(report.validated_operations, [
    { method: "get", path: "/alpha" },
    { method: "post", path: "/alpha" },
    { method: "post", path: "/zeta" },
  ]);
});
