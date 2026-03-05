import assert from "node:assert/strict";
import test from "node:test";
import { buildExportFileName } from "@/server/exports/fileName";

test("buildExportFileName creates deterministic csv filename", () => {
  const fixedDate = new Date("2026-03-05T01:23:45.000Z");
  const fileName = buildExportFileName(
    "pack_123",
    "test_cases",
    fixedDate,
  );

  assert.equal(
    fileName,
    "pack_123_test_cases_2026-03-05T01-23-45.000Z.csv",
  );
});
