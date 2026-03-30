import "server-only";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = {
  request_id?: string;
  workspace_id?: string;
  actor_clerk_user_id?: string;
  entity_type?: string;
  entity_id?: string;
  action?: string;
  metadata?: unknown;
};

function sanitizeMetadata(value: unknown): unknown {
  if (value == null) {
    return undefined;
  }

  try {
    const json = JSON.stringify(value);
    if (!json) {
      return undefined;
    }

    if (json.length > 1200) {
      return `${json.slice(0, 1200)}...`;
    }

    return JSON.parse(json) as unknown;
  } catch {
    return { note: "metadata_unserializable" };
  }
}

function emit(level: LogLevel, msg: string, context: LogContext = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    request_id: context.request_id ?? "unknown",
    ...(context.workspace_id ? { workspace_id: context.workspace_id } : {}),
    ...(context.actor_clerk_user_id
      ? { actor_clerk_user_id: context.actor_clerk_user_id }
      : {}),
    ...(context.entity_type ? { entity_type: context.entity_type } : {}),
    ...(context.entity_id ? { entity_id: context.entity_id } : {}),
    ...(context.action ? { action: context.action } : {}),
    ...(context.metadata ? { metadata: sanitizeMetadata(context.metadata) } : {}),
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  if (level === "info") {
    console.info(line);
    return;
  }

  console.debug(line);
}

export const logger = {
  debug: (msg: string, context?: LogContext) => emit("debug", msg, context),
  info: (msg: string, context?: LogContext) => emit("info", msg, context),
  warn: (msg: string, context?: LogContext) => emit("warn", msg, context),
  error: (msg: string, context?: LogContext) => emit("error", msg, context),
};
