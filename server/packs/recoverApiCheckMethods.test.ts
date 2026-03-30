import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import { recoverApiCheckMethodsFromGrounding } from "@/server/packs/recoverApiCheckMethods";

test("recoverApiCheckMethodsFromGrounding fills a missing method when endpoint matches one grounded operation", () => {
  const pack = structuredClone(examplePack);
  delete pack.checks.api[0].method;

  const result = recoverApiCheckMethodsFromGrounding(pack, {
    artifact_id: "art_openapi",
    operations_count: 1,
    operations: [{ method: "post", path: "/api/v1/auth/login" }],
  });

  assert.equal(result.pack.checks.api[0].method, "POST");
  assert.deepEqual(result.recovered, [
    {
      path: "checks.api[0].method",
      method: "POST",
      endpoint: "/api/v1/auth/login",
      note: "Recovered POST from grounded OpenAPI operation /api/v1/auth/login.",
    },
  ]);
});

test("recoverApiCheckMethodsFromGrounding does not invent a method when endpoint does not match grounding", () => {
  const pack = structuredClone(examplePack);
  delete pack.checks.api[0].method;

  const result = recoverApiCheckMethodsFromGrounding(pack, {
    artifact_id: "art_openapi",
    operations_count: 1,
    operations: [{ method: "post", path: "/api/v1/auth/verify-otp" }],
  });

  assert.equal(result.pack.checks.api[0].method, undefined);
  assert.deepEqual(result.recovered, []);
});

test("recoverApiCheckMethodsFromGrounding does not invent a method when multiple grounded operations share the endpoint", () => {
  const pack = structuredClone(examplePack);
  delete pack.checks.api[0].method;

  const result = recoverApiCheckMethodsFromGrounding(pack, {
    artifact_id: "art_openapi",
    operations_count: 2,
    operations: [
      { method: "post", path: "/api/v1/auth/login" },
      { method: "put", path: "/api/v1/auth/login" },
    ],
  });

  assert.equal(result.pack.checks.api[0].method, undefined);
  assert.deepEqual(result.recovered, []);
});
