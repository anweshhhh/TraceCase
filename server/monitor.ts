import "server-only";
import { logger } from "@/server/log";
import { getRequestIdFromHeaders } from "@/server/requestId";

type MonitorContext = {
  action?: string;
  workspace_id?: string;
  actor_clerk_user_id?: string;
  entity_type?: string;
  entity_id?: string;
  metadata?: unknown;
  request_id?: string;
};

function toSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.slice(0, 300);
}

export async function captureException(
  error: unknown,
  context: MonitorContext = {},
) {
  const requestId = context.request_id ?? (await getRequestIdFromHeaders());

  logger.error("exception.captured", {
    ...context,
    request_id: requestId,
    metadata: {
      ...(context.metadata ? { context: context.metadata } : {}),
      error: toSafeErrorMessage(error),
    },
  });
}

export async function captureMessage(
  message: string,
  context: MonitorContext = {},
) {
  const requestId = context.request_id ?? (await getRequestIdFromHeaders());

  logger.warn("message.captured", {
    ...context,
    request_id: requestId,
    metadata: {
      ...(context.metadata ? { context: context.metadata } : {}),
      message: message.slice(0, 300),
    },
  });
}
