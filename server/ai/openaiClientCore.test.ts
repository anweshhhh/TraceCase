import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import {
  buildStructuredOutputRequestOptions,
  normalizeStructuredOutputError,
  OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MESSAGE,
  OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MS,
  withStructuredOutputTimeout,
} from "@/server/ai/openaiClientCore";

test("buildStructuredOutputRequestOptions bounds request time and disables hidden retries", () => {
  assert.deepEqual(buildStructuredOutputRequestOptions(), {
    timeout: OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MS,
    maxRetries: 0,
    signal: undefined,
  });
});

test("buildStructuredOutputRequestOptions accepts per-stage timeout overrides", () => {
  assert.deepEqual(buildStructuredOutputRequestOptions(240_000), {
    timeout: 240_000,
    maxRetries: 0,
    signal: undefined,
  });
});

test("buildStructuredOutputRequestOptions forwards an abort signal", () => {
  const controller = new AbortController();

  assert.deepEqual(
    buildStructuredOutputRequestOptions(240_000, controller.signal),
    {
      timeout: 240_000,
      maxRetries: 0,
      signal: controller.signal,
    },
  );
});

test("normalizeStructuredOutputError maps provider timeouts to a safe retry message", () => {
  const error = normalizeStructuredOutputError(
    new OpenAI.APIConnectionTimeoutError(),
  );

  assert.equal(error.message, OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MESSAGE);
});

test("normalizeStructuredOutputError preserves regular errors", () => {
  const original = new Error("validation failed");

  assert.equal(normalizeStructuredOutputError(original), original);
});

test("withStructuredOutputTimeout rejects long-running operations with the timeout message", async () => {
  let aborted = false;

  await assert.rejects(
    withStructuredOutputTimeout(
      async (signal) =>
        await new Promise<never>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      20,
    ),
    /OpenAI request timed out while generating the pack/i,
  );

  assert.equal(aborted, true);
});
