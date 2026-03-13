import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import type { StructuredOutputRunner } from "@/server/ai/openaiClient";
import {
  AiPackGenerationError,
  generateAiPackWithCritic,
  type GenerateAiPackInput,
} from "@/server/packs/generateAiPack";
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
  assert.equal(result.metadata.ai.grounding.openapi.status, "skipped");
  assert.equal(result.metadata.ai.grounding.prisma.status, "skipped");
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
  assert.equal(result.content.checks.sql[0]?.query_hint, undefined);
  assert.match(
    result.content.checks.sql[0]?.title ?? "",
    /needs schema mapping/i,
  );
});
