import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRateLimitStore } from "@/server/rateLimit/memoryStore";

test("MemoryRateLimitStore allows up to limit and increments", async () => {
  const store = new MemoryRateLimitStore();
  const key = "test:key";

  const one = await store.incr(key, 60);
  const two = await store.incr(key, 60);
  const three = await store.incr(key, 60);

  assert.equal(one.count, 1);
  assert.equal(two.count, 2);
  assert.equal(three.count, 3);
});

test("MemoryRateLimitStore resets after window", async () => {
  const store = new MemoryRateLimitStore();
  const key = "test:window";

  const first = await store.incr(key, 1);
  assert.equal(first.count, 1);

  await new Promise((resolve) => setTimeout(resolve, 1100));

  const second = await store.incr(key, 1);
  assert.equal(second.count, 1);
  assert.ok(second.resetAt > first.resetAt);
});
