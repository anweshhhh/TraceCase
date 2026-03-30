export type RateLimitIncrResult = {
  count: number;
  resetAt: number;
};

export type RateLimitStore = {
  incr(key: string, windowSeconds: number): Promise<RateLimitIncrResult>;
};
