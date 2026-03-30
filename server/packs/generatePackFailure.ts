import type { GeneratePackRuntimeMetadata } from "@/server/packs/generationRunContext";
import {
  AiPackGenerationError,
  type OpenAiJobMetadata,
} from "@/server/packs/generateAiPack";

type FinalizeGeneratePackFailureMetadataInput = {
  persistedMetadata?: OpenAiJobMetadata | null;
  errorMetadata?: OpenAiJobMetadata | null;
  lastRuntime?: GeneratePackRuntimeMetadata | null;
  fallbackRuntime: GeneratePackRuntimeMetadata;
};

function isFallbackLoadContextRuntime(
  runtime: GeneratePackRuntimeMetadata | null | undefined,
) {
  return runtime?.stage === "load_context" && runtime.attempt === 1;
}

export function finalizeGeneratePackFailureMetadata({
  persistedMetadata,
  errorMetadata,
  lastRuntime,
  fallbackRuntime,
}: FinalizeGeneratePackFailureMetadataInput): OpenAiJobMetadata {
  const persistedRuntime =
    persistedMetadata?.ai_mode === "openai" ? persistedMetadata.runtime : undefined;
  const errorRuntime =
    errorMetadata?.ai_mode === "openai" ? errorMetadata.runtime : undefined;
  const resolvedRuntime =
    persistedRuntime && !isFallbackLoadContextRuntime(persistedRuntime)
      ? persistedRuntime
      : errorRuntime && !isFallbackLoadContextRuntime(errorRuntime)
      ? errorRuntime
      : lastRuntime && !isFallbackLoadContextRuntime(lastRuntime)
        ? lastRuntime
        : persistedRuntime ?? errorRuntime ?? lastRuntime ?? fallbackRuntime;
  const baseMetadata =
    errorMetadata?.ai ? errorMetadata : persistedMetadata?.ai ? persistedMetadata : errorMetadata ?? persistedMetadata ?? { ai_mode: "openai" as const };

  return {
    ...baseMetadata,
    runtime: {
      ...resolvedRuntime,
      status: "failed",
    },
  };
}

export function shouldStopRetryingGeneratePackError(error: unknown) {
  if (error instanceof AiPackGenerationError) {
    return true;
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("openai request timed out") ||
    message.includes("workflow deadline") ||
    message.includes("grounded openapi artifact") ||
    message.includes("grounded prisma schema") ||
    message.includes("acceptance criteria")
  );
}
