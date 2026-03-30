import assert from "node:assert/strict";
import test from "node:test";
import { buildHealthResult } from "@/server/health";

function getValidEnv() {
  return {
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/tracecase_test",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_tracecase",
    CLERK_SECRET_KEY: "sk_test_tracecase",
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: "/dashboard",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: "/dashboard",
    INNGEST_DEV: "1",
  } as const;
}

test("health returns 200 when env and db checks pass", async () => {
  const now = new Date("2026-03-05T12:00:00.000Z");
  const result = await buildHealthResult({
    now,
    version: "0.1.0",
    commitSha: "abc123",
    envSource: getValidEnv(),
    dbCheck: async () => ({ status: "ok", latency_ms: 3 }),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "ok");
  assert.equal(result.body.timestamp, now.toISOString());
  assert.equal(result.body.checks.env.status, "ok");
  assert.equal(result.body.checks.db.status, "ok");
  assert.equal(result.body.checks.openai.status, "skip");
});

test("health returns 503 when env validation fails", async () => {
  let dbCalled = false;
  const result = await buildHealthResult({
    version: "0.1.0",
    commitSha: null,
    envSource: {
      ...getValidEnv(),
      DATABASE_URL: "",
    },
    dbCheck: async () => {
      dbCalled = true;
      return { status: "ok", latency_ms: 2 };
    },
  });

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.status, "degraded");
  assert.equal(result.body.checks.env.status, "fail");
  assert.equal(result.body.checks.db.status, "fail");
  assert.equal(dbCalled, false);
});

test("health returns 503 when db check fails", async () => {
  const result = await buildHealthResult({
    version: "0.1.0",
    commitSha: null,
    envSource: getValidEnv(),
    dbCheck: async () => ({ status: "fail", error: "db unavailable" }),
  });

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.status, "degraded");
  assert.equal(result.body.checks.env.status, "ok");
  assert.equal(result.body.checks.db.status, "fail");
});

test("health reports OpenAI as ok when AI_PROVIDER=openai is fully configured", async () => {
  const result = await buildHealthResult({
    version: "0.1.0",
    commitSha: null,
    envSource: {
      ...getValidEnv(),
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-live-redacted",
      OPENAI_MODEL: "gpt-5-mini",
    },
    dbCheck: async () => ({ status: "ok", latency_ms: 2 }),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.checks.openai.status, "ok");
});
