import assert from "node:assert/strict";
import test from "node:test";
import { EnvValidationError, parseServerEnv } from "@/server/env";

function getValidEnv() {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/tracecase_test",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_tracecase",
    CLERK_SECRET_KEY: "sk_test_tracecase",
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: "/dashboard",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: "/dashboard",
    INNGEST_DEV: "1",
    INNGEST_BASE_URL: "http://127.0.0.1:8288",
  } as const;
}

test("parseServerEnv succeeds with required env values", () => {
  const result = parseServerEnv(getValidEnv());

  assert.equal(result.INNGEST_DEV, "1");
  assert.equal(result.DATABASE_URL.includes("postgresql://"), true);
  assert.equal(result.AI_PROVIDER, "placeholder");
  assert.equal(result.OPENAI_STORE, false);
});

test("parseServerEnv fails with readable error when vars are missing", () => {
  const env = {
    ...getValidEnv(),
    DATABASE_URL: "",
  };

  assert.throws(
    () => parseServerEnv(env),
    (error) =>
      error instanceof EnvValidationError &&
      error.message.includes("DATABASE_URL"),
  );
});

test("parseServerEnv requires INNGEST_EVENT_KEY when not in dev mode", () => {
  const env = {
    ...getValidEnv(),
    INNGEST_DEV: "0",
    INNGEST_EVENT_KEY: "",
  };

  assert.throws(
    () => parseServerEnv(env),
    (error) =>
      error instanceof EnvValidationError &&
      error.message.includes("INNGEST_EVENT_KEY"),
  );
});

test("parseServerEnv requires Upstash vars when RATE_LIMIT_STORE is redis", () => {
  const env = {
    ...getValidEnv(),
    RATE_LIMIT_STORE: "redis",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
  };

  assert.throws(
    () => parseServerEnv(env),
    (error) =>
      error instanceof EnvValidationError &&
      error.message.includes("UPSTASH_REDIS_REST_URL") &&
      error.message.includes("UPSTASH_REDIS_REST_TOKEN"),
  );
});

test("parseServerEnv accepts valid APP_ENV values", () => {
  const env = {
    ...getValidEnv(),
    APP_ENV: "staging",
  };

  const result = parseServerEnv(env);
  assert.equal(result.APP_ENV, "staging");
});

test("parseServerEnv rejects invalid APP_ENV", () => {
  const env = {
    ...getValidEnv(),
    APP_ENV: "prodish",
  };

  assert.throws(
    () => parseServerEnv(env),
    (error) =>
      error instanceof EnvValidationError &&
      error.message.includes("APP_ENV"),
  );
});

test("parseServerEnv requires OPENAI_API_KEY when AI_PROVIDER=openai", () => {
  const env = {
    ...getValidEnv(),
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "",
  };

  assert.throws(
    () => parseServerEnv(env),
    (error) =>
      error instanceof EnvValidationError &&
      error.message.includes("OPENAI_API_KEY") &&
      error.message.includes("AI_PROVIDER"),
  );
});

test("parseServerEnv does not require OPENAI_API_KEY when AI_PROVIDER=placeholder", () => {
  const env = {
    ...getValidEnv(),
    AI_PROVIDER: "placeholder",
    OPENAI_API_KEY: "",
  };

  const result = parseServerEnv(env);
  assert.equal(result.AI_PROVIDER, "placeholder");
});

test("parseServerEnv accepts OPENAI_GENERATION_MODEL when provided", () => {
  const env = {
    ...getValidEnv(),
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    OPENAI_GENERATION_MODEL: "gpt-5",
  };

  const result = parseServerEnv(env);
  assert.equal(result.OPENAI_GENERATION_MODEL, "gpt-5");
  assert.equal(result.OPENAI_MODEL, "gpt-5-mini");
});
