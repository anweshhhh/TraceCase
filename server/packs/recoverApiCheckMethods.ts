import type { PackContentInput } from "@/server/packs/packSchema";
import type { OpenApiGroundingSummary } from "@/server/openapiGrounding";

export type ApiMethodRecovery = {
  path: string;
  method: string;
  endpoint: string;
  note: string;
};

export type ApiMethodRecoveryResult = {
  pack: PackContentInput;
  recovered: ApiMethodRecovery[];
};

function normalizeEndpoint(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed.toLowerCase() : `/${trimmed.toLowerCase()}`;
}

export function recoverApiCheckMethodsFromGrounding(
  input: PackContentInput,
  grounding: OpenApiGroundingSummary | null,
): ApiMethodRecoveryResult {
  const pack = structuredClone(input);
  const recovered: ApiMethodRecovery[] = [];

  if (!grounding || !pack.checks?.api) {
    return { pack, recovered };
  }

  pack.checks.api.forEach((check, index) => {
    if (typeof check.method === "string" && check.method.trim().length > 0) {
      return;
    }

    if (typeof check.endpoint !== "string" || check.endpoint.trim().length === 0) {
      return;
    }

    const normalizedEndpoint = normalizeEndpoint(check.endpoint);
    const matches = grounding.operations.filter(
      (operation) => normalizeEndpoint(operation.path) === normalizedEndpoint,
    );

    if (matches.length !== 1) {
      return;
    }

    const match = matches[0];
    check.method = match.method.toUpperCase();
    recovered.push({
      path: `checks.api[${index}].method`,
      method: check.method,
      endpoint: check.endpoint,
      note: `Recovered ${check.method} from grounded OpenAPI operation ${match.path}.`,
    });
  });

  return { pack, recovered };
}
