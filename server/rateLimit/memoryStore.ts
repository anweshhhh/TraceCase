import type { RateLimitIncrResult, RateLimitStore } from "@/server/rateLimit/store";

type MemoryEntry = {
  count: number;
  resetAt: number;
};

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly map = new Map<string, MemoryEntry>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60_000);
    this.cleanupTimer.unref?.();
  }

  async incr(key: string, windowSeconds: number): Promise<RateLimitIncrResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const existing = this.map.get(key);

    if (!existing || existing.resetAt <= now) {
      const next = { count: 1, resetAt: now + windowMs };
      this.map.set(key, next);
      return next;
    }

    const next = {
      count: existing.count + 1,
      resetAt: existing.resetAt,
    };
    this.map.set(key, next);
    return next;
  }

  private cleanup() {
    const now = Date.now();

    for (const [key, value] of this.map.entries()) {
      if (value.resetAt <= now) {
        this.map.delete(key);
      }
    }
  }
}
