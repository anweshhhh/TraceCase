import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import type { StructuredOutputRunner } from "@/server/ai/openaiClient";
import {
  AiPackGenerationError,
  generateAiPackWithCritic,
  type GenerateAiPackInput,
} from "@/server/packs/generateAiPack";
import { createGenerationRunContext } from "@/server/packs/generationRunContext";
import type { PackCriticReport } from "@/server/packs/critiquePack";
import type { OpenApiGroundingSummary } from "@/server/openapiGrounding";
import type { PrismaGroundingSummary } from "@/server/prismaGrounding";

type MockResponse = {
  output: unknown;
  model?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
};

function getInput(): GenerateAiPackInput {
  return {
    requirement: {
      id: "req_abc123",
      title: "MFA login with OTP expiry, resend invalidation, and lockout rules",
      module_type: "LOGIN",
      test_focus: ["UI", "API", "SQL", "REGRESSION"],
    },
    snapshot: {
      id: "snap_xyz789",
      version: 2,
      source_hash:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      source_text: [
        "Users sign in with email and password.",
        "If MFA is enabled, a 6-digit OTP is required before session creation.",
        "OTPs expire after 5 minutes.",
        "Resending a code invalidates the previous OTP immediately.",
        "After 5 failed OTP attempts, the account is locked for 15 minutes.",
        "Duplicate submit clicks must not create duplicate sessions.",
        "Failure messages must stay generic and must not reveal whether the OTP was wrong or expired.",
      ].join("\n"),
    },
  };
}

function getCoverageClosureInput(): GenerateAiPackInput {
  return {
    requirement: {
      id: "req_cov_closure",
      title: "Email OTP login flow",
      module_type: "LOGIN",
      test_focus: ["UI", "API", "SQL", "REGRESSION"],
    },
    snapshot: {
      id: "snap_cov_closure",
      version: 1,
      source_hash:
        "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      source_text: [
        "Email OTP login flow",
        "",
        "Acceptance Criteria:",
        "1. The login form shows email and password fields and a Continue button.",
        "2. POST /auth/login returns challenge_id for an active user.",
        "3. All authentication failures must be recorded in the audit log.",
      ].join("\n"),
    },
  };
}

function getOpenApiGrounding(
  operations: Array<{ method: string; path: string }>,
): OpenApiGroundingSummary {
  return {
    artifact_id: "art_openapi_123",
    operations_count: operations.length,
    operations,
  };
}

function getPrismaGrounding(
  models: Array<{
    name: string;
    fields: Array<{ name: string; type: string }>;
  }>,
): PrismaGroundingSummary {
  return {
    artifact_id: "art_prisma_123",
    model_count: models.length,
    models,
  };
}

function cloneExamplePack() {
  return structuredClone(examplePack);
}

function createRunner(responses: MockResponse[]): StructuredOutputRunner {
  let index = 0;

  return async <T>() => {
    const next = responses[index];
    index += 1;

    if (!next) {
      throw new Error("Mock OpenAI runner was called more times than expected.");
    }

    return {
      output: structuredClone(next.output) as T,
      model: next.model ?? "gpt-5-mini",
      usage: next.usage,
    };
  };
}

function createCapturingRunner(
  responses: MockResponse[],
  seenModels: string[],
): StructuredOutputRunner {
  let index = 0;

  return async <T>(request?: { model?: string }) => {
    seenModels.push(request?.model ?? "default");
    const next = responses[index];
    index += 1;

    if (!next) {
      throw new Error("Mock OpenAI runner was called more times than expected.");
    }

    return {
      output: structuredClone(next.output) as T,
      model: next.model ?? request?.model ?? "gpt-5-mini",
      usage: next.usage,
    };
  };
}

function createInputCapturingRunner(
  responses: MockResponse[],
  seenInputs: string[],
): StructuredOutputRunner {
  let index = 0;

  return async <T>(request?: { input?: string }) => {
    seenInputs.push(request?.input ?? "");
    const next = responses[index];
    index += 1;

    if (!next) {
      throw new Error("Mock OpenAI runner was called more times than expected.");
    }

    return {
      output: structuredClone(next.output) as T,
      model: next.model ?? "gpt-5-mini",
      usage: next.usage,
    };
  };
}

function buildCritic(
  overrides: Partial<PackCriticReport> = {},
): PackCriticReport {
  return {
    verdict: "pass",
    coverage: {
      acceptance_criteria_total: 4,
      acceptance_criteria_covered: 4,
      uncovered: [],
    },
    major_risks: [],
    quality_notes: ["Pack is grounded in OTP timing, lockout, and duplicate-click handling."],
    ...overrides,
  };
}

test("generateAiPackWithCritic returns canonical content on initial pass", async () => {
  const pack = cloneExamplePack();
  pack.assumptions[0] = "  Users authenticate with email and password.  ";

  const result = await generateAiPackWithCritic(getInput(), {
    model: "gpt-5-mini",
    runner: createRunner([
      {
        output: pack,
        usage: {
          input_tokens: 100,
          output_tokens: 60,
          total_tokens: 160,
        },
      },
      {
        output: buildCritic(),
        usage: {
          input_tokens: 30,
          output_tokens: 10,
          total_tokens: 40,
        },
      },
    ]),
  });

  assert.equal(result.content.assumptions[0], "Users authenticate with email and password.");
  assert.equal(result.metadata.ai.attempts, 1);
  assert.equal(result.metadata.ai.critic.verdict, "pass");
  assert.equal(result.metadata.ai.grounding.openapi.status, "skipped");
  assert.equal(result.metadata.ai.grounding.prisma.status, "skipped");
  assert.deepEqual(result.metadata.ai.token_usage, {
    input_tokens: 130,
    output_tokens: 70,
    total_tokens: 200,
  });
});

test("generateAiPackWithCritic sanitizes reversible structural defects before validation", async () => {
  const pack = cloneExamplePack();
  const sourceRef = pack.checks.api[0].source_refs[0];
  assert.ok(sourceRef);
  const originalStart = sourceRef.line_start;
  sourceRef.line_start = sourceRef.line_end;
  sourceRef.line_end = originalStart;

  const result = await generateAiPackWithCritic(getInput(), {
    model: "gpt-5-mini",
    runner: createRunner([
      {
        output: pack,
      },
      {
        output: buildCritic(),
      },
    ]),
  });

  assert.equal(
    result.metadata.ai.sanitization?.initial?.fixes_applied_count,
    1,
  );
  assert.deepEqual(result.metadata.ai.sanitization?.initial?.kinds, [
    "source_ref_range_swapped",
  ]);
  assert.match(
    result.metadata.runtime?.stages.find(
      (stage) => stage.stage === "initial_validation",
    )?.note ?? "",
    /source_ref_range_swapped at checks\.api\[0\]\.source_refs\[0\]/,
  );
  assert.equal(
    result.content.checks.api[0]?.source_refs[0]?.line_start,
    Math.min(sourceRef.line_start, sourceRef.line_end),
  );
});

test("generateAiPackWithCritic sanitizes repaired duplicate ids and snapshot drift before repair validation", async () => {
  const initialPack = cloneExamplePack();
  const repairedPack = cloneExamplePack();
  let criticCalls = 0;
  repairedPack.test_cases.push({
    ...structuredClone(repairedPack.test_cases[0]),
    id: repairedPack.test_cases[0].id,
    title: "Rate limiting and retry behaviour remains safe",
  });
  repairedPack.test_cases[1].source_refs[0].snapshot_id = " stale_snapshot ";
  repairedPack.checks.api.push({
    ...structuredClone(repairedPack.checks.api[0]),
    id: "BAD-ID",
    method: undefined,
    endpoint: "/api/v1/auth/login",
    title: "Login endpoint keeps documented rate-limit response",
  });

  const result = await generateAiPackWithCritic(
    {
      ...getInput(),
      openApiGrounding: getOpenApiGrounding([
        { method: "post", path: "/api/v1/auth/login" },
      ]),
    },
    {
    model: "gpt-5-mini",
    runner: createRunner([
      {
        output: initialPack,
      },
      {
        output: repairedPack,
      },
    ]),
    critic: async ({ model }) => {
      criticCalls += 1;
      const report =
        criticCalls === 1
          ? buildCritic({
              verdict: "needs_work",
              coverage: {
                acceptance_criteria_total: 1,
                acceptance_criteria_covered: 0,
                uncovered: [
                  {
                    id: "AC-18",
                    criterion:
                      "Rate limiting may be applied to login and verify endpoints, but the API must return a documented error status when the limit is exceeded.",
                    why_uncovered:
                      "The initial pack does not assert the documented rate-limit response.",
                  },
                ],
              },
            })
          : buildCritic();
      return {
        report,
        model: model ?? "gpt-5-mini",
      };
    },
  });

  assert.equal(result.metadata.ai.attempts, 2);
  assert.deepEqual(result.metadata.ai.sanitization?.repair?.kinds, [
    "duplicate_id_reassigned",
    "source_ref_snapshot_normalized",
  ]);
  assert.equal(
    result.content.test_cases[1]?.id,
    "TC-002",
  );
  assert.equal(
    result.content.test_cases[1]?.source_refs[0]?.snapshot_id,
    getInput().snapshot.id,
  );
  assert.equal(result.content.checks.api[1]?.method, "post");
  assert.match(
    result.metadata.runtime?.stages.find(
      (stage) => stage.stage === "repair_validation",
    )?.note ?? "",
    /duplicate_id_reassigned/,
  );
  assert.match(
    result.metadata.runtime?.stages.find(
      (stage) => stage.stage === "repair_validation",
    )?.note ?? "",
    /Recovered API method from grounding/,
  );
});

test("generateAiPackWithCritic performs one repair attempt when critic needs work", async () => {
  const initialPack = cloneExamplePack();
  const repairedPack = cloneExamplePack();
  repairedPack.test_cases[0].title =
    "Login with valid credentials, OTP, and no duplicate session creation";

  const result = await generateAiPackWithCritic(getInput(), {
    model: "gpt-5-mini",
    runner: createRunner([
      {
        output: initialPack,
      },
      {
        output: buildCritic({
          verdict: "needs_work",
          coverage: {
            acceptance_criteria_total: 4,
            acceptance_criteria_covered: 3,
            uncovered: [
              {
                id: "AC-13",
                criterion:
                  "Resending a code invalidates the previous OTP immediately.",
                why_uncovered:
                  "The pack never proves that the older OTP becomes unusable after resend.",
              },
            ],
          },
          major_risks: ["Resend invalidation rule is missing from coverage."],
          quality_notes: ["One happy-path case is still too generic."],
        }),
      },
      {
        output: repairedPack,
      },
      {
        output: buildCritic(),
      },
    ]),
  });

  assert.equal(result.metadata.ai.attempts, 2);
  assert.equal(
    result.content.test_cases[0].title,
    "Login with valid credentials, OTP, and no duplicate session creation",
  );
  assert.equal(result.metadata.ai.critic.coverage.acceptance_criteria_covered, 4);
  assert.equal(result.metadata.ai.grounding.openapi.status, "skipped");
  assert.equal(result.metadata.ai.grounding.prisma.status, "skipped");
});

test("generateAiPackWithCritic exposes metadata ready for Job.metadata_json", async () => {
  const result = await generateAiPackWithCritic(getInput(), {
    model: "gpt-5-mini",
    runner: createRunner([
      {
        output: cloneExamplePack(),
      },
      {
        output: buildCritic(),
      },
    ]),
  });

  assert.equal(result.metadata.ai_mode, "openai");
  assert.equal(result.metadata.ai.provider, "openai");
  assert.equal(result.metadata.ai.model, "gpt-5-mini");
  assert.equal(
    result.metadata.ai.critic.coverage.acceptance_criteria_total,
    4,
  );
  assert.equal(result.metadata.ai.coverage_plan?.acceptance_criteria_total, 0);
  assert.equal(result.metadata.ai.coverage_map?.total, 0);
  assert.equal(result.metadata.ai.grounding.openapi.status, "skipped");
  assert.equal(result.metadata.ai.grounding.prisma.status, "skipped");
});

test("generateAiPackWithCritic includes the acceptance criteria plan in prompt input and metadata", async () => {
  const seenInputs: string[] = [];
  const pack = cloneExamplePack();
  pack.scenarios[0].tags.push("AC-01", "AC-02");
  pack.test_cases[0].tags.push("AC-03", "AC-04");
  const result = await generateAiPackWithCritic(
    {
      requirement: {
        id: "req_plan_1",
        title: "Email OTP login flow",
        module_type: "LOGIN",
        test_focus: ["UI", "API", "SQL", "REGRESSION"],
      },
      snapshot: {
        id: "snap_plan_1",
        version: 1,
        source_hash:
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        source_text: [
          "Email OTP login flow",
          "",
          "Acceptance Criteria:",
          "1. The login form shows email and password fields and a Continue button.",
          "2. POST /auth/login returns challenge_id for an active user.",
          "3. Successful OTP verification creates a session and updates User.lastLoginAt.",
          "4. Rate limiting may be applied to login and verify endpoints, but the API must return a documented error status when the limit is exceeded.",
          "",
          "API contract:",
          "- POST /auth/login",
        ].join("\n"),
      },
    },
    {
      model: "gpt-5-mini",
      runner: createInputCapturingRunner(
        [
          {
            output: pack,
          },
          {
            output: buildCritic(),
          },
        ],
        seenInputs,
      ),
    },
  );

  assert.match(seenInputs[0] ?? "", /Acceptance criteria coverage plan:/);
  assert.match(seenInputs[0] ?? "", /AC-01 \[UI\]/);
  assert.match(seenInputs[0] ?? "", /AC-04 \[API, SECURITY\]/);
  assert.equal(result.metadata.ai.coverage_plan?.acceptance_criteria_total, 4);
  assert.deepEqual(result.metadata.ai.coverage_map?.uncovered_ids, []);
  assert.deepEqual(
    result.metadata.ai.coverage_plan?.items[2]?.expected_layers,
    ["SQL", "SESSION"],
  );
});

test("generateAiPackWithCritic triggers one repair attempt when deterministic AC coverage is missing before critic", async () => {
  const criticCalls: string[] = [];
  const initialPack = cloneExamplePack();
  const repairedPack = cloneExamplePack();
  repairedPack.scenarios[0].tags.push("AC-01");
  repairedPack.test_cases[0].tags.push("AC-01", "AC-02");

  const result = await generateAiPackWithCritic(
    {
      requirement: {
        id: "req_cov_1",
        title: "Login form coverage",
        module_type: "LOGIN",
        test_focus: ["UI", "API"],
      },
      snapshot: {
        id: "snap_cov_1",
        version: 1,
        source_hash:
          "1111111111111111111111111111111111111111111111111111111111111111",
        source_text: [
          "Login form coverage",
          "",
          "Acceptance Criteria:",
          "1. The login form shows email and password fields and a Continue button.",
          "2. POST /auth/login returns challenge_id for an active user.",
        ].join("\n"),
      },
    },
    {
      model: "gpt-5-mini",
      runner: createRunner([
        { output: initialPack },
        { output: repairedPack },
      ]),
      critic: async ({ coverageMap }) => {
        criticCalls.push(coverageMap.uncovered_ids.join(","));
        return {
          report: buildCritic({
            coverage: {
              acceptance_criteria_total: 2,
              acceptance_criteria_covered: 2,
              uncovered: [],
            },
          }),
          model: "gpt-5-mini",
        };
      },
    },
  );

  assert.equal(result.metadata.ai.attempts, 2);
  assert.deepEqual(criticCalls, [""]);
  assert.deepEqual(result.metadata.ai.coverage_map?.uncovered_ids, []);
  assert.equal(result.metadata.ai.coverage_map?.covered, 2);
});

test("generateAiPackWithCritic fails with explicit uncovered AC ids when repaired pack still misses deterministic coverage", async () => {
  const initialPack = cloneExamplePack();
  const repairedPack = cloneExamplePack();
  const criticCalls: string[] = [];

  await assert.rejects(
    () =>
      generateAiPackWithCritic(
        {
          requirement: {
            id: "req_cov_2",
            title: "Login form coverage",
            module_type: "LOGIN",
            test_focus: ["UI", "API"],
          },
          snapshot: {
            id: "snap_cov_2",
            version: 1,
            source_hash:
              "2222222222222222222222222222222222222222222222222222222222222222",
            source_text: [
              "Login form coverage",
              "",
              "Acceptance Criteria:",
              "1. The login form shows email and password fields and a Continue button.",
              "2. POST /auth/login returns challenge_id for an active user.",
            ].join("\n"),
          },
        },
        {
          model: "gpt-5-mini",
          runner: createRunner([
            { output: initialPack },
            { output: repairedPack },
          ]),
          critic: async ({ coverageMap }) => {
            criticCalls.push(coverageMap.uncovered_ids.join(","));
            return {
              report: buildCritic({
                verdict: "needs_work",
                coverage: {
                  acceptance_criteria_total: 2,
                  acceptance_criteria_covered: 0,
                  uncovered: [
                    {
                      id: "AC-01",
                      criterion:
                        "The login form shows email and password fields and a Continue button.",
                      why_uncovered: "Missing explicit UI coverage.",
                    },
                    {
                      id: "AC-02",
                      criterion:
                        "POST /auth/login returns challenge_id for an active user.",
                      why_uncovered: "Missing explicit API coverage.",
                    },
                  ],
                },
              }),
              model: "gpt-5-mini",
            };
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.match(error.message, /uncovered acceptance criteria/i);
      assert.equal(error.metadata.runtime?.final_outcome, "critic_coverage");
      assert.equal(error.metadata.runtime?.final_failure_stage, "repair_critic");
      assert.match(error.metadata.runtime?.final_failure_message ?? "", /acceptance criteria/i);
      assert.ok(error.metadata.ai);
      assert.equal(error.metadata.ai.critic.phase, "repair");
      assert.deepEqual(error.metadata.ai.coverage_map?.uncovered_ids, [
        "AC-01",
        "AC-02",
      ]);
      assert.deepEqual(error.metadata.ai.coverage_closure_plan?.uncovered_ids, [
        "AC-01",
        "AC-02",
      ]);
      assert.equal(
        error.metadata.ai.coverage_closure_validation?.status,
        "still_incomplete",
      );
      assert.deepEqual(
        error.metadata.ai.critic.coverage.uncovered.map((item) => item.id),
        ["AC-01", "AC-02"],
      );
      assert.match(
        error.metadata.runtime?.stages?.at(-1)?.note ?? "",
        /AC-01, AC-02/,
      );
      assert.deepEqual(criticCalls, ["AC-01,AC-02"]);
      return true;
    },
  );
});

test("generateAiPackWithCritic builds a coverage closure plan and passes explicit obligations into repair", async () => {
  const seenInputs: string[] = [];
  let criticCalls = 0;
  const initialPack = cloneExamplePack();
  initialPack.scenarios[0].tags.push("AC-01", "AC-02", "AC-03");
  const repairedPack = cloneExamplePack();
  repairedPack.scenarios[0].tags.push("AC-01", "AC-02", "AC-03");
  repairedPack.test_cases[0].tags.push("AC-01");
  repairedPack.checks.sql[0].title = `Audit log contains failed-auth event [AC-03]`;
  repairedPack.checks.sql[0].validations.push(
    "Audit logging is recorded for failed login attempts [AC-03]",
  );

  const result = await generateAiPackWithCritic(getCoverageClosureInput(), {
    model: "gpt-5-mini",
    runner: createInputCapturingRunner(
      [
        { output: initialPack },
        { output: repairedPack },
      ],
      seenInputs,
    ),
    critic: async () => {
      criticCalls += 1;

      if (criticCalls === 1) {
        return {
          report: buildCritic({
            verdict: "needs_work",
            coverage: {
              acceptance_criteria_total: 3,
              acceptance_criteria_covered: 1,
              uncovered: [
                {
                  id: "AC-01",
                  criterion:
                    "The login form shows email and password fields and a Continue button.",
                  why_uncovered:
                    "The pack references the AC but does not add concrete UI coverage.",
                },
                {
                  id: "AC-03",
                  criterion:
                    "All authentication failures must be recorded in the audit log.",
                  why_uncovered:
                    "The pack does not verify audit logging explicitly.",
                },
              ],
            },
          }),
          model: "gpt-5-mini",
        };
      }

      return {
        report: buildCritic({
          coverage: {
            acceptance_criteria_total: 3,
            acceptance_criteria_covered: 3,
            uncovered: [],
          },
        }),
        model: "gpt-5-mini",
      };
    },
  });

  assert.match(seenInputs[1] ?? "", /Coverage closure obligations for repair:/);
  assert.match(seenInputs[1] ?? "", /AC-01 \[UI\] add_ui_case:/);
  assert.match(
    seenInputs[1] ?? "",
    /AC-03 \[AUDIT\] add_audit_or_logging_check:/,
  );
  assert.match(
    seenInputs[1] ?? "",
    /Keep ids unique while repairing\./,
  );
  assert.match(
    seenInputs[1] ?? "",
    /Do not add incomplete API checks without both method and endpoint\./,
  );
  assert.deepEqual(result.metadata.ai.coverage_closure_plan?.uncovered_ids, [
    "AC-01",
    "AC-03",
  ]);
  assert.equal(result.metadata.ai.coverage_closure_validation?.status, "closed");
  assert.equal(result.metadata.ai.critic.phase, "repair");
});

test("generateAiPackWithCritic preserves final critic uncovered ids and closure validation when repair stays incomplete", async () => {
  let criticCalls = 0;
  const initialPack = cloneExamplePack();
  initialPack.scenarios[0].tags.push("AC-01", "AC-02", "AC-03");
  const repairedPack = cloneExamplePack();
  repairedPack.scenarios[0].tags.push("AC-02", "AC-03");
  repairedPack.checks.api[0].title = `${repairedPack.checks.api[0].title} [AC-01]`;
  repairedPack.test_cases[0].tags.push("AC-03");

  await assert.rejects(
    () =>
      generateAiPackWithCritic(getCoverageClosureInput(), {
        model: "gpt-5-mini",
        runner: createRunner([
          { output: initialPack },
          { output: repairedPack },
        ]),
        critic: async () => {
          criticCalls += 1;

          if (criticCalls === 1) {
            return {
              report: buildCritic({
                verdict: "needs_work",
                coverage: {
                  acceptance_criteria_total: 3,
                  acceptance_criteria_covered: 1,
                  uncovered: [
                    {
                      id: "AC-01",
                      criterion:
                        "The login form shows email and password fields and a Continue button.",
                      why_uncovered:
                        "The pack references the AC but does not add concrete UI coverage.",
                    },
                    {
                      id: "AC-03",
                      criterion:
                        "All authentication failures must be recorded in the audit log.",
                      why_uncovered:
                        "The pack does not verify audit logging explicitly.",
                    },
                  ],
                },
              }),
              model: "gpt-5-mini",
            };
          }

          return {
            report: buildCritic({
              verdict: "needs_work",
              coverage: {
                acceptance_criteria_total: 3,
                acceptance_criteria_covered: 1,
                uncovered: [
                  {
                    id: "AC-01",
                    criterion:
                      "The login form shows email and password fields and a Continue button.",
                    why_uncovered:
                      "Still no tagged UI scenario or test case covers this AC.",
                  },
                  {
                    id: "AC-03",
                    criterion:
                      "All authentication failures must be recorded in the audit log.",
                    why_uncovered:
                      "Still no audit or logging verification covers this AC.",
                  },
                ],
              },
            }),
            model: "gpt-5-mini",
          };
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.equal(error.metadata.runtime?.final_outcome, "critic_coverage");
      assert.equal(error.metadata.runtime?.final_failure_stage, "repair_critic");
      assert.equal(error.metadata.ai?.critic.phase, "repair");
      assert.deepEqual(
        error.metadata.ai?.critic.coverage.uncovered.map((item) => item.id),
        ["AC-01", "AC-03"],
      );
      assert.deepEqual(
        error.metadata.ai?.coverage_closure_validation?.still_unclosed.map(
          (item) => item.id,
        ),
        ["AC-01", "AC-03"],
      );
      assert.match(
        error.metadata.runtime?.stages?.at(-1)?.note ?? "",
        /AC-01, AC-03/,
      );
      return true;
    },
  );
});

test("generateAiPackWithCritic records sufficient compensating coverage after semantic SQL fallback", async () => {
  let criticCalls = 0;
  const initialPack = cloneExamplePack();
  initialPack.scenarios[0].tags.push("AC-01", "AC-02", "AC-03");

  const repairedPack = cloneExamplePack();
  repairedPack.scenarios[0].tags.push("AC-01", "AC-02", "AC-03");
  repairedPack.test_cases[0].tags.push("AC-01", "AC-03");
  repairedPack.test_cases[0].title = "Audit logging stays generic and recorded";
  repairedPack.checks.api[0].title = `${repairedPack.checks.api[0].title} [AC-02]`;
  repairedPack.checks.api[0].assertions.push(
    "The documented challenge response is returned [AC-02]",
  );
  repairedPack.checks.sql.forEach((check) => {
    check.title = `${check.title} [AC-03]`;
    check.query_hint = "SELECT test_user_id FROM auth_failures";
    check.validations.push("Audit logging persists the failure event [AC-03]");
  });

  const result = await generateAiPackWithCritic(
    {
      ...getCoverageClosureInput(),
      prismaGrounding: getPrismaGrounding([
        {
          name: "User",
          fields: [
            { name: "id", type: "String" },
            { name: "email", type: "String" },
          ],
        },
      ]),
    },
    {
      model: "gpt-5-mini",
      runner: createRunner([
        { output: initialPack },
        { output: repairedPack },
      ]),
      critic: async () => {
        criticCalls += 1;

        if (criticCalls === 1) {
          return {
            report: buildCritic({
              verdict: "needs_work",
              coverage: {
                acceptance_criteria_total: 3,
                acceptance_criteria_covered: 1,
                uncovered: [
                  {
                    id: "AC-01",
                    criterion:
                      "The login form shows email and password fields and a Continue button.",
                    why_uncovered: "Missing explicit UI coverage.",
                  },
                  {
                    id: "AC-03",
                    criterion:
                      "All authentication failures must be recorded in the audit log.",
                    why_uncovered: "Missing explicit audit coverage.",
                  },
                ],
              },
            }),
            model: "gpt-5-mini",
          };
        }

        return {
          report: buildCritic({
            coverage: {
              acceptance_criteria_total: 3,
              acceptance_criteria_covered: 3,
              uncovered: [],
            },
          }),
          model: "gpt-5-mini",
        };
      },
    },
  );

  assert.equal(result.metadata.ai.grounding.prisma.sql_checks_semantic > 0, true);
  assert.equal(result.metadata.ai.compensating_coverage?.status, "sufficient");
  assert.match(
    result.metadata.runtime?.stages.find(
      (stage) => stage.stage === "repair_prisma_grounding",
    )?.note ?? "",
    /semantic SQL fallback/i,
  );
});

test("generateAiPackWithCritic fails when semantic SQL fallback lacks compensating concrete coverage", async () => {
  let criticCalls = 0;
  const initialPack = cloneExamplePack();
  initialPack.scenarios[0].tags.push("AC-01", "AC-02", "AC-03");

  const repairedPack = cloneExamplePack();
  repairedPack.scenarios[0].tags.push("AC-01", "AC-02", "AC-03");
  repairedPack.test_cases[0].tags.push("AC-01");
  repairedPack.checks.sql.forEach((check) => {
    check.title = `${check.title} [AC-02]`;
    check.query_hint = "SELECT test_user_id FROM auth_failures";
    check.validations.push("Challenge persistence stays durable [AC-02]");
  });

  await assert.rejects(
    () =>
      generateAiPackWithCritic(
        {
          ...getCoverageClosureInput(),
          prismaGrounding: getPrismaGrounding([
            {
              name: "User",
              fields: [
                { name: "id", type: "String" },
                { name: "email", type: "String" },
              ],
            },
          ]),
        },
        {
          model: "gpt-5-mini",
          runner: createRunner([
            { output: initialPack },
            { output: repairedPack },
          ]),
          critic: async () => {
            criticCalls += 1;

            if (criticCalls === 1) {
              return {
                report: buildCritic({
                  verdict: "needs_work",
                  coverage: {
                    acceptance_criteria_total: 3,
                    acceptance_criteria_covered: 2,
                    uncovered: [
                      {
                        id: "AC-02",
                        criterion:
                          "POST /auth/login returns challenge_id for an active user.",
                        why_uncovered:
                          "Missing concrete API coverage for the documented response.",
                      },
                    ],
                  },
                }),
                model: "gpt-5-mini",
              };
            }

            return {
              report: buildCritic({
                coverage: {
                  acceptance_criteria_total: 3,
                  acceptance_criteria_covered: 3,
                  uncovered: [],
                },
              }),
              model: "gpt-5-mini",
            };
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.match(error.message, /insufficient compensating coverage/i);
      assert.equal(error.metadata.runtime?.final_outcome, "critic_coverage");
      assert.equal(error.metadata.runtime?.final_failure_stage, "repair_critic");
      assert.equal(error.metadata.ai?.critic.phase, "repair");
      assert.equal(error.metadata.ai?.compensating_coverage?.status, "insufficient");
      assert.deepEqual(
        error.metadata.ai?.compensating_coverage?.issues.map((issue) => issue.id),
        ["AC-02"],
      );
      assert.match(
        error.metadata.runtime?.stages.at(-1)?.note ?? "",
        /AC-02/,
      );
      return true;
    },
  );
});

test("generateAiPackWithCritic stores grounded OpenAPI metadata when checks match", async () => {
  const result = await generateAiPackWithCritic(
    {
      ...getInput(),
      openApiGrounding: getOpenApiGrounding([
        { method: "post", path: "/api/v1/auth/login" },
      ]),
    },
    {
      model: "gpt-5-mini",
      runner: createRunner([
        {
          output: cloneExamplePack(),
        },
        {
          output: buildCritic(),
        },
      ]),
    },
  );

  assert.equal(result.metadata.ai.grounding.openapi.status, "grounded");
  assert.equal(result.metadata.ai.grounding.openapi.artifact_id, "art_openapi_123");
  assert.equal(result.metadata.ai.grounding.openapi.api_checks_total, 1);
  assert.equal(result.metadata.ai.grounding.openapi.api_checks_grounded, 1);
  assert.equal(result.metadata.ai.grounding.prisma.status, "skipped");
});

test("generateAiPackWithCritic performs one repair attempt for OpenAPI grounding mismatches", async () => {
  const initialPack = cloneExamplePack();
  initialPack.checks.api[0].endpoint = "/api/v1/auth/verify-otp";

  const repairedPack = cloneExamplePack();

  const result = await generateAiPackWithCritic(
    {
      ...getInput(),
      openApiGrounding: getOpenApiGrounding([
        { method: "post", path: "/api/v1/auth/login" },
      ]),
    },
    {
      model: "gpt-5-mini",
      runner: createRunner([
        {
          output: initialPack,
        },
        {
          output: buildCritic(),
        },
        {
          output: repairedPack,
        },
        {
          output: buildCritic(),
        },
      ]),
    },
  );

  assert.equal(result.metadata.ai.attempts, 2);
  assert.equal(result.metadata.ai.grounding.openapi.status, "grounded");
  assert.equal(result.metadata.ai.grounding.openapi.api_checks_grounded, 1);
  assert.equal(result.metadata.ai.grounding.prisma.status, "skipped");
});

test("generateAiPackWithCritic fails cleanly when OpenAPI grounding still mismatches after repair", async () => {
  const initialPack = cloneExamplePack();
  initialPack.checks.api[0].endpoint = "/api/v1/auth/verify-otp";

  const repairedPack = cloneExamplePack();
  repairedPack.checks.api[0].endpoint = "/api/v1/auth/resend-otp";

  await assert.rejects(
    () =>
      generateAiPackWithCritic(
        {
          ...getInput(),
          openApiGrounding: getOpenApiGrounding([
            { method: "post", path: "/api/v1/auth/login" },
          ]),
        },
        {
          model: "gpt-5-mini",
          runner: createRunner([
            {
              output: initialPack,
            },
            {
              output: buildCritic(),
            },
            {
              output: repairedPack,
            },
          ]),
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.match(
        error.message,
        /did not match the grounded OpenAPI artifact after repair/i,
      );
      assert.ok(error.metadata.ai);
      assert.equal(error.metadata.ai.attempts, 2);
      assert.equal(error.metadata.ai.grounding.openapi.status, "failed");
      assert.equal(error.metadata.ai.grounding.openapi.api_checks_grounded, 0);
      assert.equal(error.metadata.ai.grounding.openapi.mismatches.length, 1);

      return true;
    },
  );
});

test("generateAiPackWithCritic skips OpenAPI grounding when no valid artifact exists", async () => {
  const result = await generateAiPackWithCritic(getInput(), {
    model: "gpt-5-mini",
    runner: createRunner([
      {
        output: cloneExamplePack(),
      },
      {
        output: buildCritic(),
      },
    ]),
  });

  assert.equal(result.metadata.ai.grounding.openapi.status, "skipped");
  assert.equal(result.metadata.ai.grounding.openapi.artifact_id, null);
  assert.equal(result.metadata.ai.grounding.prisma.status, "skipped");
});

test("generateAiPackWithCritic stores grounded Prisma metadata when SQL checks match", async () => {
  const pack = cloneExamplePack();
  pack.checks.sql[0].query_hint =
    "SELECT lastLoginAt FROM User WHERE email = ?";

  const result = await generateAiPackWithCritic(
    {
      ...getInput(),
      prismaGrounding: getPrismaGrounding([
        {
          name: "User",
          fields: [
            { name: "email", type: "String" },
            { name: "lastLoginAt", type: "DateTime" },
          ],
        },
      ]),
    },
    {
      model: "gpt-5-mini",
      runner: createRunner([
        {
          output: pack,
        },
        {
          output: buildCritic(),
        },
      ]),
    },
  );

  assert.equal(result.metadata.ai.grounding.prisma.status, "grounded");
  assert.equal(result.metadata.ai.grounding.prisma.artifact_id, "art_prisma_123");
  assert.equal(result.metadata.ai.grounding.prisma.sql_checks_total, 1);
  assert.equal(result.metadata.ai.grounding.prisma.sql_checks_grounded, 1);
  assert.equal(result.metadata.ai.grounding.prisma.sql_checks_semantic, 0);
});

test("generateAiPackWithCritic performs one repair attempt for Prisma grounding mismatches", async () => {
  const initialPack = cloneExamplePack();
  initialPack.checks.sql[0].query_hint =
    "SELECT last_login_at FROM users WHERE email = ?";

  const repairedPack = cloneExamplePack();
  repairedPack.checks.sql[0].query_hint =
    "SELECT lastLoginAt FROM User WHERE email = ?";

  const result = await generateAiPackWithCritic(
    {
      ...getInput(),
      prismaGrounding: getPrismaGrounding([
        {
          name: "User",
          fields: [
            { name: "email", type: "String" },
            { name: "lastLoginAt", type: "DateTime" },
          ],
        },
      ]),
    },
    {
      model: "gpt-5-mini",
      runner: createRunner([
        {
          output: initialPack,
        },
        {
          output: buildCritic(),
        },
        {
          output: repairedPack,
        },
        {
          output: buildCritic(),
        },
      ]),
    },
  );

  assert.equal(result.metadata.ai.attempts, 2);
  assert.equal(result.metadata.ai.grounding.prisma.status, "grounded");
  assert.equal(result.metadata.ai.grounding.prisma.sql_checks_grounded, 1);
  assert.equal(result.metadata.ai.grounding.prisma.sql_checks_semantic, 0);
});

test("generateAiPackWithCritic downgrades unsupported concrete SQL checks to semantic form after repair", async () => {
  const initialPack = cloneExamplePack();
  initialPack.checks.sql[0].query_hint =
    "SELECT last_login_at FROM users WHERE email = ?";

  const repairedPack = cloneExamplePack();
  repairedPack.checks.sql[0].query_hint =
    "UPDATE users SET last_login_at = NOW() WHERE email = ?";

  const result = await generateAiPackWithCritic(
    {
      ...getInput(),
      prismaGrounding: getPrismaGrounding([
        {
          name: "User",
          fields: [
            { name: "email", type: "String" },
            { name: "lastLoginAt", type: "DateTime" },
          ],
        },
      ]),
    },
    {
      model: "gpt-5-mini",
      runner: createRunner([
        {
          output: initialPack,
        },
        {
          output: buildCritic(),
        },
        {
          output: repairedPack,
        },
        {
          output: buildCritic(),
        },
      ]),
    },
  );

  assert.equal(result.metadata.ai.attempts, 2);
  assert.equal(result.metadata.ai.grounding.prisma.status, "grounded");
  assert.equal(result.metadata.ai.grounding.prisma.sql_checks_grounded, 0);
  assert.equal(result.metadata.ai.grounding.prisma.sql_checks_semantic, 1);
  assert.match(
    result.content.checks.sql[0]?.query_hint ?? "",
    /^NEEDS_MAPPING:/,
  );
  assert.match(
    result.content.checks.sql[0]?.title ?? "",
    /needs schema mapping/i,
  );
});

test("generateAiPackWithCritic fails cleanly when Prisma grounding remains unsafe after repair and fallback cannot resolve it", async () => {
  const initialPack = cloneExamplePack();
  initialPack.checks.sql[0].query_hint =
    "SELECT last_login_at FROM users WHERE email = ?";

  const repairedPack = cloneExamplePack();
  repairedPack.checks.sql[0].query_hint =
    "UPDATE users SET last_login_at = NOW() WHERE email = ?";

  await assert.rejects(
    () =>
      generateAiPackWithCritic(
        {
          ...getInput(),
          prismaGrounding: getPrismaGrounding([
            {
              name: "User",
              fields: [
                { name: "email", type: "String" },
                { name: "lastLoginAt", type: "DateTime" },
              ],
            },
          ]),
        },
        {
          model: "gpt-5-mini",
          runner: createRunner([
            {
              output: initialPack,
            },
            {
              output: buildCritic(),
            },
            {
              output: repairedPack,
            },
            {
              output: buildCritic(),
            },
          ]),
          prismaFallback: ({ packContent, report }) => ({
            packContent,
            report,
          }),
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.match(
        error.message,
        /did not match the grounded Prisma schema after repair/i,
      );
      assert.ok(error.metadata.ai);
      assert.equal(error.metadata.ai.attempts, 2);
      assert.equal(error.metadata.ai.grounding.prisma.status, "failed");
      assert.equal(error.metadata.ai.grounding.prisma.sql_checks_grounded, 0);
      assert.equal(error.metadata.ai.grounding.prisma.mismatches.length, 1);

      return true;
    },
  );
});

test("generateAiPackWithCritic reports stage progress before generation and critic", async () => {
  const stageTransitions: string[] = [];

  await generateAiPackWithCritic(getInput(), {
    model: "gpt-5-mini",
    runner: createRunner([
      {
        output: cloneExamplePack(),
      },
      {
        output: buildCritic(),
      },
    ]),
    onProgress: async (runtime) => {
      const stage = runtime.stages.at(-1);
      const marker = `${stage?.stage}:${stage?.status}:${stage?.attempt ?? runtime.attempt}`;
      if (stageTransitions.at(-1) !== marker) {
        stageTransitions.push(marker);
      }
    },
  });

  assert.deepEqual(stageTransitions, [
    "initial_generation:entered:1",
    "initial_generation:succeeded:1",
    "initial_validation:entered:1",
    "initial_validation:succeeded:1",
    "openapi_grounding:entered:1",
    "openapi_grounding:skipped:1",
    "prisma_grounding:entered:1",
    "prisma_grounding:skipped:1",
    "initial_critic:entered:1",
    "initial_critic:succeeded:1",
  ]);
});

test("generateAiPackWithCritic reports repair stages on the second attempt", async () => {
  const stageTransitions: string[] = [];
  const initialPack = cloneExamplePack();
  const repairedPack = cloneExamplePack();
  repairedPack.test_cases[0].title =
    "Login with valid credentials, OTP resend invalidation, and no duplicate session creation";

  await generateAiPackWithCritic(getInput(), {
    model: "gpt-5-mini",
    runner: createRunner([
      {
        output: initialPack,
      },
      {
        output: buildCritic({
          verdict: "needs_work",
          coverage: {
            acceptance_criteria_total: 4,
            acceptance_criteria_covered: 3,
            uncovered: [
              {
                id: "AC-13",
                criterion:
                  "Resending a code invalidates the previous OTP immediately.",
                why_uncovered:
                  "The pack never proves the previous OTP becomes invalid after resend.",
              },
            ],
          },
        }),
      },
      {
        output: repairedPack,
      },
      {
        output: buildCritic(),
      },
    ]),
    onProgress: async (runtime) => {
      const stage = runtime.stages.at(-1);
      const marker = `${stage?.stage}:${stage?.status}:${stage?.attempt ?? runtime.attempt}`;
      if (stageTransitions.at(-1) !== marker) {
        stageTransitions.push(marker);
      }
    },
  });

  assert.deepEqual(stageTransitions, [
    "initial_generation:entered:1",
    "initial_generation:succeeded:1",
    "initial_validation:entered:1",
    "initial_validation:succeeded:1",
    "openapi_grounding:entered:1",
    "openapi_grounding:skipped:1",
    "prisma_grounding:entered:1",
    "prisma_grounding:skipped:1",
    "initial_critic:entered:1",
    "initial_critic:failed:1",
    "repair_generation:entered:2",
    "repair_generation:succeeded:2",
    "repair_validation:entered:2",
    "repair_validation:succeeded:2",
    "repair_openapi_grounding:entered:2",
    "repair_openapi_grounding:skipped:2",
    "repair_prisma_grounding:entered:2",
    "repair_prisma_grounding:skipped:2",
    "repair_critic:entered:2",
    "repair_critic:succeeded:2",
  ]);
});

test("generateAiPackWithCritic uses a stronger generation model than the critic model when configured", async () => {
  const seenModels: string[] = [];
  const criticModels: string[] = [];

  const result = await generateAiPackWithCritic(getInput(), {
    generationModel: "gpt-5",
    criticModel: "gpt-5-mini",
    runner: createCapturingRunner(
      [
        {
          output: cloneExamplePack(),
          model: "gpt-5",
        },
      ],
      seenModels,
    ),
    critic: async ({ model }) => {
      criticModels.push(model ?? "default");
      return {
        report: buildCritic(),
        model: model ?? "gpt-5-mini",
      };
    },
  });

  assert.deepEqual(seenModels, ["gpt-5"]);
  assert.deepEqual(criticModels, ["gpt-5-mini"]);
  assert.equal(result.metadata.ai.model, "gpt-5");
  assert.equal(result.metadata.ai.critic_model, "gpt-5-mini");
});

test("generateAiPackWithCritic fails cleanly when the workflow budget is exhausted during initial generation", async () => {
  const runContext = createGenerationRunContext({
    startedAt: new Date("2026-03-14T08:00:00.000Z"),
    deadlineMs: 1,
    now: () => new Date("2026-03-14T08:00:01.000Z"),
    generationModel: "gpt-5",
    criticModel: "gpt-5-mini",
  });

  await assert.rejects(
    () =>
      generateAiPackWithCritic(getInput(), {
        generationModel: "gpt-5",
        criticModel: "gpt-5-mini",
        runner: createRunner([]),
        runContext,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.match(error.message, /workflow deadline/i);
      assert.equal(error.metadata.runtime?.stage, "initial_generation");
      assert.equal(error.metadata.runtime?.final_outcome, "workflow_deadline");
      assert.equal(error.metadata.runtime?.final_failure_stage, "initial_generation");
      return true;
    },
  );
});

test("generateAiPackWithCritic fails cleanly when the workflow budget is exhausted during the initial critic", async () => {
  let currentTime = new Date("2026-03-14T08:00:00.000Z");
  const runContext = createGenerationRunContext({
    startedAt: currentTime,
    deadlineMs: 5_000,
    now: () => currentTime,
    generationModel: "gpt-5",
    criticModel: "gpt-5-mini",
  });

  await assert.rejects(
    () =>
      generateAiPackWithCritic(getInput(), {
        generationModel: "gpt-5",
        criticModel: "gpt-5-mini",
        runner: async <T>() => {
          return {
            output: cloneExamplePack() as T,
            model: "gpt-5",
          };
        },
        onProgress: async (runtime) => {
          if (runtime.stage === "initial_critic") {
            currentTime = new Date("2026-03-14T08:00:06.000Z");
          }
        },
        critic: async () => {
          throw new Error("critic should not run");
        },
        runContext,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.match(error.message, /workflow deadline/i);
      assert.equal(error.metadata.runtime?.stage, "initial_critic");
      assert.equal(error.metadata.runtime?.final_outcome, "workflow_deadline");
      assert.equal(error.metadata.runtime?.final_failure_stage, "initial_critic");
      return true;
    },
  );
});

test("generateAiPackWithCritic fails cleanly when the workflow budget is exhausted during repair generation", async () => {
  let currentTime = new Date("2026-03-14T08:00:00.000Z");
  let generationCalls = 0;
  const runContext = createGenerationRunContext({
    startedAt: currentTime,
    deadlineMs: 6_000,
    now: () => currentTime,
    generationModel: "gpt-5",
    criticModel: "gpt-5-mini",
  });

  await assert.rejects(
    () =>
      generateAiPackWithCritic(getInput(), {
        generationModel: "gpt-5",
        criticModel: "gpt-5-mini",
        runner: async <T>() => {
          generationCalls += 1;

          if (generationCalls === 1) {
            return {
              output: cloneExamplePack() as T,
              model: "gpt-5",
            };
          }

          throw new Error("repair generation should not start");
        },
        critic: async () => {
          currentTime = new Date("2026-03-14T08:00:07.000Z");
          return {
            report: buildCritic({
              verdict: "needs_work",
              coverage: {
                acceptance_criteria_total: 4,
                acceptance_criteria_covered: 3,
                uncovered: [
                  {
                    criterion: "Resending a code invalidates the previous OTP immediately.",
                    id: "AC-13",
                    why_uncovered: "Missing resend invalidation coverage.",
                  },
                ],
              },
            }),
            model: "gpt-5-mini",
          };
        },
        runContext,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.match(error.message, /workflow deadline/i);
      assert.equal(error.metadata.ai?.critic.phase, "initial");
      assert.equal(
        error.metadata.ai?.critic.coverage.uncovered[0]?.id,
        "AC-13",
      );
      assert.equal(error.metadata.runtime?.stage, "repair_generation");
      assert.equal(error.metadata.runtime?.final_outcome, "workflow_deadline");
      assert.equal(error.metadata.runtime?.final_failure_stage, "repair_generation");
      return true;
    },
  );
});

test("generateAiPackWithCritic rejects missing API methods during validation before grounding", async () => {
  const invalidPack = cloneExamplePack();
  delete invalidPack.checks.api[0].method;

  await assert.rejects(
    () =>
      generateAiPackWithCritic(getInput(), {
        model: "gpt-5-mini",
        runner: createRunner([{ output: invalidPack }, { output: invalidPack }]),
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.match(error.message, /missing method/i);
      assert.equal(error.metadata.runtime?.final_outcome, "validation");
      assert.equal(error.metadata.runtime?.final_failure_stage, "repair_validation");
      return true;
    },
  );
});

test("generateAiPackWithCritic recovers a missing API method from unique grounded OpenAPI context", async () => {
  const pack = cloneExamplePack();
  delete pack.checks.api[0].method;

  const result = await generateAiPackWithCritic(
    {
      ...getInput(),
      openApiGrounding: getOpenApiGrounding([
        { method: "post", path: "/api/v1/auth/login" },
      ]),
    },
    {
      model: "gpt-5-mini",
      runner: createRunner([
        { output: pack },
        { output: buildCritic() },
      ]),
    },
  );

  assert.equal(result.content.checks.api[0]?.method, "post");
  assert.match(
    result.metadata.runtime?.stages.find(
      (stage) => stage.stage === "initial_validation",
    )?.note ?? "",
    /Recovered API method from grounding at checks\.api\[0\]\.method/,
  );
});

test("generateAiPackWithCritic fails cleanly when the workflow budget is exhausted during repair critic", async () => {
  let currentTime = new Date("2026-03-14T08:00:00.000Z");
  let criticCalls = 0;
  const initialPack = cloneExamplePack();
  const repairedPack = cloneExamplePack();
  const runContext = createGenerationRunContext({
    startedAt: currentTime,
    deadlineMs: 8_000,
    now: () => currentTime,
    generationModel: "gpt-5",
    criticModel: "gpt-5-mini",
  });

  await assert.rejects(
    () =>
      generateAiPackWithCritic(getInput(), {
        generationModel: "gpt-5",
        criticModel: "gpt-5-mini",
        runner: createRunner([
          {
            output: initialPack,
          },
          {
            output: repairedPack,
          },
        ]),
        critic: async () => {
          criticCalls += 1;

          if (criticCalls === 1) {
            return {
              report: buildCritic({
                verdict: "needs_work",
                coverage: {
                  acceptance_criteria_total: 4,
                  acceptance_criteria_covered: 3,
                  uncovered: [
                    {
                      criterion: "Resending a code invalidates the previous OTP immediately.",
                      id: "AC-13",
                      why_uncovered: "Missing resend invalidation coverage.",
                    },
                  ],
                },
              }),
              model: "gpt-5-mini",
            };
          }
          return {
            report: buildCritic(),
            model: "gpt-5-mini",
          };
        },
        onProgress: async (runtime) => {
          if (runtime.stage === "repair_critic") {
            currentTime = new Date("2026-03-14T08:00:09.000Z");
          }
        },
        runContext,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AiPackGenerationError);
      assert.match(error.message, /workflow deadline/i);
      assert.equal(error.metadata.runtime?.stage, "repair_critic");
      assert.equal(error.metadata.runtime?.final_outcome, "workflow_deadline");
      assert.equal(error.metadata.runtime?.final_failure_stage, "repair_critic");
      return true;
    },
  );
});
