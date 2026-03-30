import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import { sanitizeGeneratedPack } from "@/server/packs/sanitizeGeneratedPack";

test("sanitizeGeneratedPack swaps reversed source_ref ranges deterministically", () => {
  const pack = structuredClone(examplePack);
  pack.checks.api[0].source_refs[0].line_start = 10;
  pack.checks.api[0].source_refs[0].line_end = 4;

  const result = sanitizeGeneratedPack(pack);

  assert.equal(result.pack.checks.api[0].source_refs[0].line_start, 4);
  assert.equal(result.pack.checks.api[0].source_refs[0].line_end, 10);
  assert.deepEqual(result.fixes_applied[0], {
    kind: "source_ref_range_swapped",
    path: "checks.api[0].source_refs[0]",
    note: "Swapped reversed line_start/line_end range.",
  });
});

test("sanitizeGeneratedPack leaves valid source_ref ranges unchanged", () => {
  const result = sanitizeGeneratedPack(structuredClone(examplePack));
  assert.equal(
    result.fixes_applied.some((fix) => fix.kind === "source_ref_range_swapped"),
    false,
  );
});

test("sanitizeGeneratedPack normalizes source_ref snapshot ids to the current snapshot", () => {
  const pack = structuredClone(examplePack);
  pack.checks.sql[0].source_refs[0].snapshot_id = " stale_snapshot ";

  const result = sanitizeGeneratedPack(pack);

  assert.equal(
    result.pack.checks.sql[0].source_refs[0].snapshot_id,
    examplePack.source.requirement_snapshot_id,
  );
  assert.deepEqual(result.fixes_applied[0], {
    kind: "source_ref_snapshot_normalized",
    path: "checks.sql[0].source_refs[0].snapshot_id",
    note: `Normalized source_ref snapshot_id to ${examplePack.source.requirement_snapshot_id}.`,
  });
});

test("sanitizeGeneratedPack normalizes API method casing without inventing missing methods", () => {
  const pack = structuredClone(examplePack);
  pack.checks.api[0].method = " post ";
  pack.checks.api.push({
    ...structuredClone(pack.checks.api[0]),
    id: "CHK-API-EXTRA",
  });
  delete pack.checks.api[1]?.method;

  const result = sanitizeGeneratedPack(pack);

  assert.equal(result.pack.checks.api[0].method, "POST");
  assert.equal(result.pack.checks.api[1].method, undefined);
  assert.equal(
    result.fixes_applied.some((fix) => fix.kind === "api_method_normalized"),
    true,
  );
});

test("sanitizeGeneratedPack reassigns duplicate ids deterministically", () => {
  const pack = structuredClone(examplePack);
  pack.test_cases.push({
    ...structuredClone(pack.test_cases[0]),
    id: pack.test_cases[0].id,
  });
  pack.checks.api.push({
    ...structuredClone(pack.checks.api[0]),
    id: "BAD-ID",
  });

  const result = sanitizeGeneratedPack(pack);

  assert.deepEqual(
    result.pack.test_cases.map((testCase) => testCase.id),
    ["TC-001", "TC-002"],
  );
  assert.deepEqual(
    result.pack.checks.api.map((check) => check.id),
    ["CHK-API-001", "CHK-API-002"],
  );
  assert.deepEqual(
    result.fixes_applied
      .filter((fix) => fix.kind === "duplicate_id_reassigned")
      .map((fix) => fix.path),
    ["test_cases[1].id", "checks.api[1].id"],
  );
});

test("sanitizeGeneratedPack trims safe text fields and reports deterministic fix kinds", () => {
  const pack = structuredClone(examplePack);
  pack.assumptions[0] = "  Example assumption  ";
  pack.checks.sql[0].query_hint = "  SELECT 1  ";

  const result = sanitizeGeneratedPack(pack);

  assert.equal(result.pack.assumptions[0], "Example assumption");
  assert.equal(result.pack.checks.sql[0].query_hint, "SELECT 1");
  assert.deepEqual(
    [...new Set(result.fixes_applied.map((fix) => fix.kind))].sort(),
    ["trimmed_text"],
  );
});
