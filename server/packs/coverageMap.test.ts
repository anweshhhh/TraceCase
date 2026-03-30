import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import {
  buildAcceptanceCoverageMap,
  formatUncoveredAcceptanceCriteria,
} from "@/server/packs/coverageMap";
import type { AcceptanceCriterion } from "@/server/packs/acceptanceCriteriaPlanner";
import { validatePackContent } from "@/server/packs/validatePack";

function getCriteria(): AcceptanceCriterion[] {
  return [
    {
      id: "AC-01",
      text: "The login form shows email and password fields and a Continue button.",
      expected_layers: ["UI"],
    },
    {
      id: "AC-02",
      text: "POST /auth/login returns challenge_id for an active user.",
      expected_layers: ["API"],
    },
    {
      id: "AC-03",
      text: "Successful OTP verification creates a session and updates User.lastLoginAt.",
      expected_layers: ["SQL", "SESSION"],
    },
  ];
}

function getPack() {
  const next = structuredClone(examplePack);
  next.scenarios[0].tags.push("AC-01", "noise", "AC-01");
  next.test_cases[0].tags.push("AC-01", "AC-02");
  next.checks.api[0].title = `${next.checks.api[0].title} [AC-02]`;
  next.checks.sql[0].validations.push("AC-03 updates last login timestamp");
  return validatePackContent(next).value;
}

test("buildAcceptanceCoverageMap marks coverage from tags and check text deterministically", () => {
  const coverageMap = buildAcceptanceCoverageMap(getCriteria(), getPack());

  assert.equal(coverageMap.total, 3);
  assert.equal(coverageMap.covered, 3);
  assert.deepEqual(coverageMap.uncovered_ids, []);
  assert.deepEqual(
    coverageMap.coverage_by_id.map((item) => item.id),
    ["AC-01", "AC-02", "AC-03"],
  );
  assert.deepEqual(
    coverageMap.coverage_by_id[0]?.references,
    [
      { kind: "scenario", id: "SCN-001" },
      { kind: "test_case", id: "TC-001" },
    ],
  );
});

test("buildAcceptanceCoverageMap reports uncovered IDs without double-counting repeated references", () => {
  const pack = getPack();
  pack.scenarios[0].tags = ["AC-01", "AC-01"];
  pack.test_cases[0].tags = ["AC-01"];
  pack.checks.api[0].title = "API check without AC id";
  pack.checks.api[0].assertions = ["No AC here"];
  pack.checks.sql[0].validations = ["No mapped AC reference"];

  const coverageMap = buildAcceptanceCoverageMap(getCriteria(), pack);

  assert.equal(coverageMap.covered, 1);
  assert.deepEqual(coverageMap.uncovered_ids, ["AC-02", "AC-03"]);
  assert.equal(coverageMap.coverage_by_id[0]?.references.length, 2);
});

test("buildAcceptanceCoverageMap ignores invalid AC-like strings", () => {
  const pack = getPack();
  pack.scenarios[0].tags = ["AC-1", "AC-999", "prefix-AC-02x"];
  pack.test_cases[0].tags = [];
  pack.checks.api[0].title = "No valid AC reference";
  pack.checks.api[0].assertions = ["Still no valid AC reference"];
  pack.checks.sql[0].validations = [];

  const coverageMap = buildAcceptanceCoverageMap(getCriteria(), pack);

  assert.deepEqual(coverageMap.uncovered_ids, ["AC-01", "AC-02", "AC-03"]);
});

test("formatUncoveredAcceptanceCriteria keeps deterministic AC order", () => {
  const coverageMap = {
    total: 3,
    covered: 1,
    uncovered_ids: ["AC-02", "AC-03"],
    coverage_by_id: [],
  };

  const formatted = formatUncoveredAcceptanceCriteria(getCriteria(), coverageMap);
  assert.match(formatted, /^AC-02 \[API\]/);
  assert.match(formatted, /AC-03 \[SQL, SESSION\]/);
});
