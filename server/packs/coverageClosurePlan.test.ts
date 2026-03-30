import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCoverageClosurePlan,
  formatCoverageClosurePlan,
} from "@/server/packs/coverageClosurePlan";
import type { AcceptanceCriterion } from "@/server/packs/acceptanceCriteriaPlanner";

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
  {
    id: "AC-04",
    text: "All authentication failures are recorded in the audit log.",
    expected_layers: ["AUDIT"],
  },
];

test("buildCoverageClosurePlan maps uncovered ACs to deterministic required actions", () => {
  const plan = buildCoverageClosurePlan(criteria, [
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
      why_uncovered: "Missing session and persistence coverage.",
    },
    {
      id: "AC-04",
      criterion: criteria[3]!.text,
      why_uncovered: "Missing audit coverage.",
    },
  ]);

  assert.deepEqual(
    plan.obligations.map((obligation) => [obligation.id, obligation.required_action]),
    [
      ["AC-01", "add_ui_case"],
      ["AC-02", "add_api_case_or_check"],
      ["AC-03", "add_session_case_or_check"],
      ["AC-04", "add_audit_or_logging_check"],
    ],
  );
});

test("buildCoverageClosurePlan keeps deterministic ordering and stable formatting", () => {
  const plan = buildCoverageClosurePlan(criteria, [
    {
      id: "AC-04",
      criterion: criteria[3]!.text,
      why_uncovered: "Missing audit coverage.",
    },
    {
      id: "AC-02",
      criterion: criteria[1]!.text,
      why_uncovered: "Missing API coverage.",
    },
    {
      id: "AC-02",
      criterion: criteria[1]!.text,
      why_uncovered: "Duplicate should be ignored.",
    },
  ]);

  assert.deepEqual(plan.uncovered_ids, ["AC-04", "AC-02"]);
  const formatted = formatCoverageClosurePlan(plan);
  assert.match(formatted, /^AC-04 \[AUDIT\] add_audit_or_logging_check:/);
  assert.match(formatted, /AC-02 \[API, SECURITY\] add_api_case_or_check:/);
});
