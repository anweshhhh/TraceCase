import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import {
  buildScenariosCsv,
  buildTestCasesCsv,
} from "@/server/exports/packCsv";
import { validatePackContent } from "@/server/packs/validatePack";

test("CSV escaping handles commas, quotes, and newlines", () => {
  const canonical = validatePackContent(structuredClone(examplePack)).value;
  canonical.scenarios[0].description = 'Line 1,\nLine "2"';

  const csv = buildScenariosCsv(canonical);

  assert.ok(csv.includes('"Line 1,\nLine ""2"""'));
});

test("buildScenariosCsv includes stable header and rows", () => {
  const canonical = validatePackContent(structuredClone(examplePack)).value;
  const csv = buildScenariosCsv(canonical);
  const lines = csv.trim().split("\n");

  assert.equal(
    lines[0],
    "scenario_id,title,description,priority,tags,test_focus,source_refs",
  );
  assert.ok(lines.length >= 2);
});

test("buildTestCasesCsv includes stable header and rows", () => {
  const canonical = validatePackContent(structuredClone(examplePack)).value;
  const csv = buildTestCasesCsv(canonical);
  const lines = csv.trim().split("\n");

  assert.equal(
    lines[0],
    "case_id,scenario_id,title,layer,priority,type,preconditions,test_data,steps,tags,source_refs",
  );
  assert.ok(lines.length >= 2);
});
