import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import { validatePackContent } from "@/server/packs/validatePack";
import {
  buildCoverageClosurePlan,
  type CoverageClosurePlan,
} from "@/server/packs/coverageClosurePlan";
import type { AcceptanceCriterion } from "@/server/packs/acceptanceCriteriaPlanner";
import { validateCoverageClosure } from "@/server/packs/validateCoverageClosure";

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
    text: "All authentication failures are recorded in the audit log.",
    expected_layers: ["AUDIT"],
  },
];

function getPack() {
  return validatePackContent(structuredClone(examplePack)).value;
}

function getPlan(): CoverageClosurePlan {
  return buildCoverageClosurePlan(criteria, [
    {
      id: "AC-01",
      criterion: criteria[0]!.text,
      why_uncovered: "Missing UI coverage.",
    },
    {
      id: "AC-02",
      criterion: criteria[1]!.text,
      why_uncovered: "Missing API coverage.",
    },
    {
      id: "AC-03",
      criterion: criteria[2]!.text,
      why_uncovered: "Missing audit coverage.",
    },
  ]);
}

test("validateCoverageClosure requires UI closure through scenario or test case tags", () => {
  const pack = getPack();
  pack.checks.api[0].title = `${pack.checks.api[0].title} [AC-01]`;

  const validation = validateCoverageClosure(getPlan(), pack);
  assert.deepEqual(
    validation.still_unclosed.map((item) => item.id),
    ["AC-01", "AC-02", "AC-03"],
  );

  pack.test_cases[0].tags.push("AC-01");
  const repairedValidation = validateCoverageClosure(getPlan(), pack);
  assert.deepEqual(
    repairedValidation.still_unclosed.map((item) => item.id),
    ["AC-02", "AC-03"],
  );
});

test("validateCoverageClosure requires layer-appropriate API and AUDIT coverage", () => {
  const pack = getPack();
  pack.test_cases[0].tags.push("AC-02", "AC-03");

  let validation = validateCoverageClosure(getPlan(), pack);
  assert.deepEqual(
    validation.still_unclosed.map((item) => item.id),
    ["AC-01", "AC-02", "AC-03"],
  );

  pack.checks.api[0].title = `${pack.checks.api[0].title} [AC-02]`;
  pack.checks.sql[0].title = `Audit log contains failed-auth event [AC-03]`;
  pack.checks.sql[0].validations.push(
    "Audit logging is recorded for failed login attempts [AC-03]",
  );

  validation = validateCoverageClosure(getPlan(), pack);
  assert.deepEqual(
    validation.still_unclosed.map((item) => item.id),
    ["AC-01"],
  );
});

test("validateCoverageClosure handles multiple closures deterministically", () => {
  const pack = getPack();
  pack.scenarios[0].tags.push("AC-01");
  pack.checks.api[0].title = `${pack.checks.api[0].title} [AC-02]`;
  pack.checks.sql[0].title = `Audit log contains failed-auth event [AC-03]`;
  pack.checks.sql[0].validations.push(
    "Audit logging is recorded for failed login attempts [AC-03]",
  );

  const validation = validateCoverageClosure(getPlan(), pack);
  assert.equal(validation.status, "closed");
  assert.deepEqual(validation.still_unclosed, []);
});
