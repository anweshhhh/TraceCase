import assert from "node:assert/strict";
import test from "node:test";
import { hashArtifactText, normalizeArtifactText } from "@/lib/artifacts";

test("artifact hashing is stable across newline and trailing-space normalization", () => {
  const withCrLf = "openapi: 3.1.0\r\npaths:\r\n  /health:  \r\n";
  const withLf = "openapi: 3.1.0\npaths:\n  /health:\n";

  assert.equal(normalizeArtifactText(withCrLf), normalizeArtifactText(withLf));
  assert.equal(hashArtifactText(withCrLf), hashArtifactText(withLf));
});
