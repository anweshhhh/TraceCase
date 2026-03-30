import { randomUUID } from "node:crypto";
import { headers } from "next/headers";

export function resolveRequestId(
  input?: Headers | Record<string, string | undefined> | null,
): string {
  if (input instanceof Headers) {
    return input.get("x-request-id")?.trim() || randomUUID();
  }

  if (input) {
    const value =
      input["x-request-id"] ??
      input["X-Request-Id"] ??
      input["X-REQUEST-ID"];
    return value?.trim() || randomUUID();
  }

  return randomUUID();
}

export async function getRequestIdFromHeaders(): Promise<string> {
  try {
    const headerStore = await headers();
    return resolveRequestId(headerStore);
  } catch {
    return randomUUID();
  }
}
