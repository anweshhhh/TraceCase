import "server-only";
import { getServerEnv } from "@/server/env";
import { MemoryRateLimitStore } from "@/server/rateLimit/memoryStore";
import type { RateLimitStore } from "@/server/rateLimit/store";

type RateLimitParams = {
  key: string;
  limit: number;
  windowSeconds: number;
  requestId: string;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  count: number;
};

export class RateLimitError extends Error {
  readonly status = 429;
  readonly code = "RATE_LIMITED";
  readonly retryAfterSeconds: number;
  readonly requestId: string;

  constructor(retryAfterSeconds: number, requestId: string) {
    super("Too many requests. Please retry later.");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.requestId = requestId;
  }
}

const globalForRateLimit = globalThis as unknown as {
  memoryRateLimitStore?: MemoryRateLimitStore;
};

function getRateLimitStore(): RateLimitStore {
  const env = getServerEnv();

  if (env.RATE_LIMIT_STORE === "memory") {
    if (!globalForRateLimit.memoryRateLimitStore) {
      globalForRateLimit.memoryRateLimitStore = new MemoryRateLimitStore();
    }

    return globalForRateLimit.memoryRateLimitStore;
  }

  throw new Error(
    "RATE_LIMIT_STORE=redis is configured but Redis store is not implemented yet.",
  );
}

export async function rateLimit(params: RateLimitParams): Promise<RateLimitResult> {
  const store = getRateLimitStore();
  const { count, resetAt } = await store.incr(params.key, params.windowSeconds);
  const remaining = Math.max(0, params.limit - count);
  const allowed = count <= params.limit;

  if (!allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    throw new RateLimitError(retryAfterSeconds, params.requestId);
  }

  return {
    allowed,
    remaining,
    resetAt,
    count,
  };
}
