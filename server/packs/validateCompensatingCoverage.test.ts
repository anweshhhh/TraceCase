import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import { validatePackContent } from "@/server/packs/validatePack";
import type { AcceptanceCriterion } from "@/server/packs/acceptanceCriteriaPlanner";
import { validateCompensatingCoverage } from "@/server/packs/validateCompensatingCoverage";

const criteria: AcceptanceCriterion[] = [
  {
    id: "AC-01",
    text: "The login form shows email and password fields and a Continue button.",
    expected_layers: ["UI"],
  },
  {
    id: "AC-02",
    text: "The API returns a documented rate-limit status when the limit is exceeded.",
    expected_layers: ["API", "SECURITY"],
  },
  {
    id: "AC-03",
    text: "Successful OTP verification creates a session and updates User.lastLoginAt.",
    expected_layers: ["SQL", "SESSION"],
  },
];

function getPack() {
  return validatePackContent(structuredClone(examplePack)).value;
}

test("validateCompensatingCoverage requires UI-tagged coverage when only semantic or API references exist", () => {
  const pack = getPack();
  pack.checks.api[0].title = `${pack.checks.api[0].title} [AC-01]`;

  const result = validateCompensatingCoverage(criteria, pack, 3);
  assert.deepEqual(result.issues.map((issue) => issue.id), ["AC-01"]);
});

test("validateCompensatingCoverage requires concrete API coverage for API/SECURITY ACs", () => {
  const pack = getPack();
  pack.test_cases[0].tags.push("AC-02");
  pack.checks.sql[0].title = `Semantic rate limit persistence [AC-02]`;
  pack.checks.sql[0].query_hint =
    "NEEDS_MAPPING: Verify rate limiting persists counters for AC-02";

  const result = validateCompensatingCoverage(criteria, pack, 2);
  assert.deepEqual(result.issues.map((issue) => issue.id), ["AC-02"]);
});

test("validateCompensatingCoverage requires compensating session coverage when SQL is only semantic", () => {
  const pack = getPack();
  pack.checks.sql[0].title = `Session persistence remains correct [AC-03]`;
  pack.checks.sql[0].query_hint =
    "NEEDS_MAPPING: Verify session persistence and last-login updates [AC-03]";

  let result = validateCompensatingCoverage(criteria, pack, 4);
  assert.deepEqual(result.issues.map((issue) => issue.id), ["AC-03"]);

  pack.test_cases[0].tags.push("AC-03");
  pack.test_cases[0].title = "Session record is created after OTP verification";
  result = validateCompensatingCoverage(criteria, pack, 4);
  assert.deepEqual(result.issues, []);
});

test("validateCompensatingCoverage keeps deterministic issue ordering", () => {
  const pack = getPack();
  pack.checks.api[0].title = `${pack.checks.api[0].title} [AC-01]`;
  pack.checks.sql[0].title = `Session persistence remains correct [AC-03]`;
  pack.checks.sql[0].query_hint =
    "NEEDS_MAPPING: Verify session persistence and last-login updates [AC-03]";

  const result = validateCompensatingCoverage(criteria, pack, 4);
  assert.deepEqual(result.issues.map((issue) => issue.id), ["AC-01", "AC-03"]);
});
