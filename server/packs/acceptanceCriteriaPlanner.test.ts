import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAcceptanceCriteriaPlan,
  formatAcceptanceCriteriaPlan,
  planAcceptanceCriteria,
} from "@/server/packs/acceptanceCriteriaPlanner";

const sourceText = `Email OTP login flow

Acceptance Criteria:
1. The login form shows email and password fields and a Continue button.
2. Email is required and must be a valid email format before submission.
3. Submitting valid email and password for an active user creates an OTP challenge and returns a challenge_id.
4. Successful OTP verification creates a session and updates User.lastLoginAt.
5. All authentication failures must be recorded in the audit log.
6. Rate limiting may be applied to login and verify endpoints, but the API must return a documented error status when the limit is exceeded.

API contract:
- POST /auth/login
`;

test("planAcceptanceCriteria extracts ordered acceptance criteria until the next section", () => {
  const criteria = planAcceptanceCriteria(sourceText);

  assert.equal(criteria.length, 6);
  assert.deepEqual(
    criteria.map((criterion) => criterion.id),
    ["AC-01", "AC-02", "AC-03", "AC-04", "AC-05", "AC-06"],
  );
  assert.equal(
    criteria[0]?.text,
    "The login form shows email and password fields and a Continue button.",
  );
  assert.match(criteria[5]?.text ?? "", /documented error status/i);
});

test("planAcceptanceCriteria assigns deterministic expected layers", () => {
  const criteria = planAcceptanceCriteria(sourceText);

  assert.deepEqual(criteria[0]?.expected_layers, ["UI"]);
  assert.deepEqual(criteria[1]?.expected_layers, ["UI"]);
  assert.deepEqual(criteria[2]?.expected_layers, ["API"]);
  assert.deepEqual(criteria[3]?.expected_layers, ["SQL", "SESSION"]);
  assert.deepEqual(criteria[4]?.expected_layers, ["AUDIT"]);
  assert.deepEqual(criteria[5]?.expected_layers, ["API", "SECURITY"]);
});

test("buildAcceptanceCriteriaPlan and formatAcceptanceCriteriaPlan return compact stable output", () => {
  const plan = buildAcceptanceCriteriaPlan(sourceText);

  assert.equal(plan.criteria_total, 6);
  assert.equal(plan.criteria[0]?.id, "AC-01");

  const formatted = formatAcceptanceCriteriaPlan(plan.criteria);
  assert.match(formatted, /AC-01 \[UI\]/);
  assert.match(formatted, /AC-06 \[API, SECURITY\]/);
});

test("planAcceptanceCriteria returns an empty plan when the section is missing", () => {
  assert.deepEqual(planAcceptanceCriteria("Business goal:\nNo AC section here."), []);
});
