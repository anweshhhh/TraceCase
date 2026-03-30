import type { GeneratePackRuntimeMetadata } from "@/server/packs/generationRunContext";

type ResolveGeneratePackSuccessRuntimeInput = {
  metadataRuntime?: GeneratePackRuntimeMetadata | null;
  lastRuntime?: GeneratePackRuntimeMetadata | null;
  fallbackRuntime: GeneratePackRuntimeMetadata;
};

function isFallbackLoadContextRuntime(
  runtime: GeneratePackRuntimeMetadata | null | undefined,
) {
  return runtime?.stage === "load_context" && runtime.attempt === 1;
}

function compareRuntimeQuality(
  candidate: GeneratePackRuntimeMetadata,
  best: GeneratePackRuntimeMetadata,
) {
  const candidateIsFallback = isFallbackLoadContextRuntime(candidate);
  const bestIsFallback = isFallbackLoadContextRuntime(best);

  if (candidateIsFallback !== bestIsFallback) {
    return candidateIsFallback ? -1 : 1;
  }

  if (candidate.stages.length !== best.stages.length) {
    return candidate.stages.length - best.stages.length;
  }

  if (candidate.current_attempt !== best.current_attempt) {
    return candidate.current_attempt - best.current_attempt;
  }

  return (
    new Date(candidate.updated_at).getTime() - new Date(best.updated_at).getTime()
  );
}

export function resolveGeneratePackSuccessRuntime({
  metadataRuntime,
  lastRuntime,
  fallbackRuntime,
}: ResolveGeneratePackSuccessRuntimeInput): GeneratePackRuntimeMetadata {
  const candidates = [metadataRuntime, lastRuntime, fallbackRuntime].filter(
    (runtime): runtime is GeneratePackRuntimeMetadata => Boolean(runtime),
  );

  return candidates.reduce((best, candidate) =>
    compareRuntimeQuality(candidate, best) > 0 ? candidate : best,
  );
}
