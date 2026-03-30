import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import {
  PackValidationError,
  validatePackContent,
} from "@/server/packs/validatePack";

test("example pack validates successfully", () => {
  const result = validatePackContent(examplePack);

  assert.equal(result.ok, true);
  assert.equal(result.value.schema_version, "1.0");
  assert.ok(result.value.test_cases.length > 0);
});

test("rejects when test case steps are not sequential", () => {
  const invalidPack = structuredClone(examplePack);
  invalidPack.test_cases[0].steps[1].step_no = 3;

  assert.throws(
    () => validatePackContent(invalidPack),
    (error) =>
      error instanceof PackValidationError &&
      error.message.includes("non-sequential step_no"),
  );
});

test("rejects when test case references missing scenario", () => {
  const invalidPack = structuredClone(examplePack);
  invalidPack.test_cases[0].scenario_id = "SCN-999";

  assert.throws(
    () => validatePackContent(invalidPack),
    (error) =>
      error instanceof PackValidationError &&
      error.message.includes("references missing scenario_id"),
  );
});

test("rejects when an API check is missing method before grounding", () => {
  const invalidPack = structuredClone(examplePack);
  delete invalidPack.checks.api[0].method;

  assert.throws(
    () => validatePackContent(invalidPack),
    (error) =>
      error instanceof PackValidationError &&
      error.message.includes("checks.api[0] is missing method"),
  );
});

test("rejects when an API check is missing endpoint before grounding", () => {
  const invalidPack = structuredClone(examplePack);
  delete invalidPack.checks.api[0].endpoint;

  assert.throws(
    () => validatePackContent(invalidPack),
    (error) =>
      error instanceof PackValidationError &&
      error.message.includes("checks.api[0] is missing endpoint"),
  );
});
