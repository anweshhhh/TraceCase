import type { OpenApiGroundingSummary } from "@/server/openapiGrounding";
import type { CanonicalPackContent } from "@/server/packs/validatePack";

export type OpenApiGroundingReport = {
  status: "grounded" | "needs_repair" | "skipped" | "failed";
  artifact_id: string | null;
  operations_available: number;
  api_checks_total: number;
  api_checks_grounded: number;
  mismatches: Array<{
    check_id: string;
    method: string | null;
    endpoint: string | null;
    reason: string;
  }>;
  validated_operations: Array<{ method: string; path: string }>;
};

function normalizeMethod(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

function normalizeEndpoint(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  let normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  try {
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(normalized)) {
      normalized = new URL(normalized).pathname;
    }
  } catch {}

  normalized = normalized.split(/[?#]/, 1)[0] ?? normalized;

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, "");
  }

  return normalized || "/";
}

function toOperationKey(method: string, path: string) {
  return `${method} ${path}`;
}

function normalizeValidatedOperations(
  operations: Array<{ method: string; path: string }>,
) {
  const unique = new Map<string, { method: string; path: string }>();

  for (const operation of operations) {
    const method = normalizeMethod(operation.method);
    const path = normalizeEndpoint(operation.path);

    if (!method || !path) {
      continue;
    }

    unique.set(toOperationKey(method, path), { method, path });
  }

  return [...unique.values()].sort((left, right) => {
    if (left.path === right.path) {
      return left.method.localeCompare(right.method);
    }

    return left.path.localeCompare(right.path);
  });
}

export function validateOpenApiGrounding(
  packContent: CanonicalPackContent,
  grounding: OpenApiGroundingSummary | null,
): OpenApiGroundingReport {
  const apiChecks = packContent.checks.api ?? [];

  if (!grounding) {
    return {
      status: "skipped",
      artifact_id: null,
      operations_available: 0,
      api_checks_total: apiChecks.length,
      api_checks_grounded: 0,
      mismatches: [],
      validated_operations: [],
    };
  }

  const validatedOperations = normalizeValidatedOperations(grounding.operations);
  const validKeys = new Set(
    validatedOperations.map((operation) =>
      toOperationKey(operation.method, operation.path),
    ),
  );

  if (apiChecks.length === 0) {
    return {
      status: "grounded",
      artifact_id: grounding.artifact_id,
      operations_available: validatedOperations.length,
      api_checks_total: 0,
      api_checks_grounded: 0,
      mismatches: [],
      validated_operations: validatedOperations,
    };
  }

  const mismatches: OpenApiGroundingReport["mismatches"] = [];
  let apiChecksGrounded = 0;

  for (const check of apiChecks) {
    const method = normalizeMethod(check.method);
    const endpoint = normalizeEndpoint(check.endpoint);

    if (!method) {
      mismatches.push({
        check_id: check.id,
        method,
        endpoint,
        reason: "API check is missing an HTTP method.",
      });
      continue;
    }

    if (!endpoint) {
      mismatches.push({
        check_id: check.id,
        method,
        endpoint,
        reason: "API check is missing an endpoint path.",
      });
      continue;
    }

    if (!validKeys.has(toOperationKey(method, endpoint))) {
      mismatches.push({
        check_id: check.id,
        method,
        endpoint,
        reason: `Operation ${method.toUpperCase()} ${endpoint} is not defined in the grounded OpenAPI artifact.`,
      });
      continue;
    }

    apiChecksGrounded += 1;
  }

  return {
    status: mismatches.length > 0 ? "needs_repair" : "grounded",
    artifact_id: grounding.artifact_id,
    operations_available: validatedOperations.length,
    api_checks_total: apiChecks.length,
    api_checks_grounded: apiChecksGrounded,
    mismatches,
    validated_operations: validatedOperations,
  };
}
