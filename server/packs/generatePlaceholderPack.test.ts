import assert from "node:assert/strict";
import test from "node:test";
import { generatePlaceholderPack } from "@/server/packs/generatePlaceholderPack";
import { validatePackContent } from "@/server/packs/validatePack";

test("generatePlaceholderPack returns schema-valid canonical content", () => {
  const pack = generatePlaceholderPack({
    requirement: {
      id: "req_123",
      title: "Login flow supports success and validation paths",
      module_type: "LOGIN",
      test_focus: ["UI", "API", "REGRESSION"],
    },
    snapshot: {
      id: "snap_123",
      version: 1,
      source_hash:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      source_text: "line one\nline two\nline three\nline four",
    },
    actorClerkUserId: "user_123",
  });

  const result = validatePackContent(pack);

  assert.equal(result.ok, true);
  assert.equal(result.value.schema_version, "1.0");
  assert.equal(result.value.scenarios.length, 2);
  assert.equal(result.value.test_cases.length, 4);
  assert.equal(result.value.checks.api.length, 1);
  assert.equal(result.value.checks.sql.length, 1);
});
