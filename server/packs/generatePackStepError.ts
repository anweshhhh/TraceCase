import {
  AiPackGenerationError,
  type OpenAiJobMetadata,
} from "@/server/packs/generateAiPack";

export type SerializedGeneratePackStepError = {
  message: string;
  metadata: OpenAiJobMetadata;
};

export function serializeGeneratePackStepError(error: unknown) {
  if (
    error instanceof AiPackGenerationError &&
    error.metadata.ai_mode === "openai"
  ) {
    return {
      message: error.message,
      metadata: error.metadata,
    } satisfies SerializedGeneratePackStepError;
  }

  return null;
}

export function restoreGeneratePackStepError(
  serialized: SerializedGeneratePackStepError,
) {
  return new AiPackGenerationError(serialized.message, serialized.metadata);
}
