import OpenAI from "openai";

export const OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MS = 120_000;
export const OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MESSAGE =
  "OpenAI request timed out while generating the pack. Please retry.";

export function buildStructuredOutputRequestOptions(
  timeoutMs = OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MS,
  signal?: AbortSignal,
) {
  return {
    timeout: timeoutMs,
    maxRetries: 0,
    signal,
  } as const;
}

export function normalizeStructuredOutputError(error: unknown) {
  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error instanceof OpenAI.APIUserAbortError ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error &&
      error.message === OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MESSAGE)
  ) {
    return new Error(OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MESSAGE);
  }

  return error instanceof Error
    ? error
    : new Error("OpenAI request failed while generating structured output.");
}

export async function withStructuredOutputTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MS,
) {
  const controller = new AbortController();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(OPENAI_STRUCTURED_OUTPUT_TIMEOUT_MESSAGE));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    throw normalizeStructuredOutputError(error);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
