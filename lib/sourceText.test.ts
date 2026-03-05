import assert from "node:assert/strict";
import test from "node:test";
import { buildLineIndex, hashSourceText } from "./sourceText";

test("hash normalization keeps equivalent newline variants stable", () => {
  const withLf = "first line\nsecond line\nthird line";
  const withCrLf = "first line\r\nsecond line\r\nthird line";

  assert.equal(hashSourceText(withLf), hashSourceText(withCrLf));
});

test("buildLineIndex returns expected line numbering and line count", () => {
  const lines = buildLineIndex("alpha\nbeta\ngamma");

  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], { lineNo: 1, content: "alpha" });
  assert.deepEqual(lines[1], { lineNo: 2, content: "beta" });
  assert.deepEqual(lines[2], { lineNo: 3, content: "gamma" });
});
