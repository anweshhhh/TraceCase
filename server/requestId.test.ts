import assert from "node:assert/strict";
import test from "node:test";
import { resolveRequestId } from "@/server/requestId";

test("resolveRequestId returns existing x-request-id from headers", () => {
  const id = resolveRequestId(new Headers({ "x-request-id": "trace-123" }));

  assert.equal(id, "trace-123");
});

test("resolveRequestId generates a UUID when request id is absent", () => {
  const id = resolveRequestId(new Headers());

  assert.equal(typeof id, "string");
  assert.ok(id.length > 20);
});
