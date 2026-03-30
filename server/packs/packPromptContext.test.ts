import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import { validatePackContent } from "@/server/packs/validatePack";
import {
  buildCriticReportSummary,
  buildPackPromptSummary,
  describeRepairPack,
} from "@/server/packs/packPromptContext";

const pack = validatePackContent(examplePack).value;

test("buildPackPromptSummary produces a compact deterministic digest", () => {
  const summary = buildPackPromptSummary(pack);

  assert.match(summary, /Pack overview:/);
  assert.match(summary, /API checks:/);
  assert.match(summary, /SQL checks:/);
  assert.match(summary, /CHK-API-/);
  assert.ok(summary.length < JSON.stringify(pack, null, 2).length);
});

test("buildCriticReportSummary formats coverage and issues without raw JSON", () => {
  const summary = buildCriticReportSummary({
    verdict: "needs_work",
    coverage: {
      acceptance_criteria_total: 3,
      acceptance_criteria_covered: 2,
      uncovered: [
        {
          id: "AC-03",
          criterion: "OTP expiry",
          why_uncovered: "No expiry check present.",
        },
      ],
    },
    major_risks: ["Lockout timing may be flaky."],
    quality_notes: ["Clarify resend cooldown."],
  });

  assert.match(summary, /Coverage: 2\/3/);
  assert.match(summary, /AC-03/);
  assert.match(summary, /OTP expiry/);
  assert.match(summary, /Lockout timing may be flaky/);
});

test("describeRepairPack falls back to plain JSON for non-pack values", () => {
  assert.equal(describeRepairPack({ ok: true }), JSON.stringify({ ok: true }));
});
