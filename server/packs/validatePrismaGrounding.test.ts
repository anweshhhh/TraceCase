import assert from "node:assert/strict";
import test from "node:test";
import examplePack from "@/server/packs/examples/examplePack.json";
import type { PrismaGroundingSummary } from "@/server/prismaGrounding";
import {
  downgradeSqlChecksToSemantic,
  validatePrismaGrounding,
} from "@/server/packs/validatePrismaGrounding";
import { validatePackContent } from "@/server/packs/validatePack";

function cloneExamplePack() {
  return structuredClone(examplePack);
}

function buildGroundingSummary(
  models: Array<{
    name: string;
    fields: Array<{ name: string; type: string }>;
  }>,
): PrismaGroundingSummary {
  return {
    artifact_id: "art_prisma_123",
    model_count: models.length,
    models,
  };
}

test("validatePrismaGrounding grounds concrete SQL checks with supported models and fields", () => {
  const packInput = cloneExamplePack();
  packInput.checks.sql[0].query_hint =
    "SELECT lastLoginAt FROM User WHERE email = ?";

  const pack = validatePackContent(packInput).value;
  const report = validatePrismaGrounding(
    pack,
    buildGroundingSummary([
      {
        name: "User",
        fields: [
          { name: "email", type: "String" },
          { name: "lastLoginAt", type: "DateTime" },
        ],
      },
    ]),
  );

  assert.equal(report.status, "grounded");
  assert.equal(report.sql_checks_total, 1);
  assert.equal(report.sql_checks_grounded, 1);
  assert.equal(report.sql_checks_semantic, 0);
  assert.deepEqual(report.mismatches, []);
});

test("validatePrismaGrounding counts SQL checks without query hints as semantic", () => {
  const packInput = cloneExamplePack();
  delete packInput.checks.sql[0].query_hint;

  const pack = validatePackContent(packInput).value;
  const report = validatePrismaGrounding(
    pack,
    buildGroundingSummary([
      {
        name: "User",
        fields: [{ name: "email", type: "String" }],
      },
    ]),
  );

  assert.equal(report.status, "grounded");
  assert.equal(report.sql_checks_grounded, 0);
  assert.equal(report.sql_checks_semantic, 1);
});

test("validatePrismaGrounding treats NEEDS_MAPPING query hints as semantic", () => {
  const packInput = cloneExamplePack();
  packInput.checks.sql[0].query_hint =
    "NEEDS_MAPPING: Verify login persistence updates the application's last-login record after schema mapping.";

  const pack = validatePackContent(packInput).value;
  const report = validatePrismaGrounding(
    pack,
    buildGroundingSummary([
      {
        name: "User",
        fields: [{ name: "email", type: "String" }],
      },
    ]),
  );

  assert.equal(report.status, "grounded");
  assert.equal(report.sql_checks_grounded, 0);
  assert.equal(report.sql_checks_semantic, 1);
  assert.deepEqual(report.mismatches, []);
});

test("validatePrismaGrounding reports unsupported Prisma models", () => {
  const packInput = cloneExamplePack();
  packInput.checks.sql[0].query_hint =
    "SELECT lastLoginAt FROM users WHERE email = ?";

  const pack = validatePackContent(packInput).value;
  const report = validatePrismaGrounding(
    pack,
    buildGroundingSummary([
      {
        name: "User",
        fields: [
          { name: "email", type: "String" },
          { name: "lastLoginAt", type: "DateTime" },
        ],
      },
    ]),
  );

  assert.equal(report.status, "needs_repair");
  assert.equal(report.mismatches[0]?.check_id, "CHK-SQL-001");
  assert.match(report.mismatches[0]?.reason ?? "", /unsupported prisma model/i);
  assert.deepEqual(report.mismatches[0]?.referenced_models, ["users"]);
});

test("validatePrismaGrounding reports unsupported Prisma fields", () => {
  const packInput = cloneExamplePack();
  packInput.checks.sql[0].query_hint =
    "SELECT last_login_at FROM User WHERE email = ?";

  const pack = validatePackContent(packInput).value;
  const report = validatePrismaGrounding(
    pack,
    buildGroundingSummary([
      {
        name: "User",
        fields: [
          { name: "email", type: "String" },
          { name: "lastLoginAt", type: "DateTime" },
        ],
      },
    ]),
  );

  assert.equal(report.status, "needs_repair");
  assert.match(report.mismatches[0]?.reason ?? "", /unsupported prisma field/i);
  assert.deepEqual(report.mismatches[0]?.referenced_fields, [
    "email",
    "last_login_at",
  ]);
});

test("validatePrismaGrounding skips validation when no artifact exists", () => {
  const pack = validatePackContent(cloneExamplePack()).value;
  const report = validatePrismaGrounding(pack, null);

  assert.equal(report.status, "skipped");
  assert.equal(report.artifact_id, null);
  assert.equal(report.models_available, 0);
});

test("validatePrismaGrounding counts multiple grounded checks and sorts grounded models deterministically", () => {
  const packInput = cloneExamplePack();
  packInput.checks.sql = [
    {
      ...packInput.checks.sql[0],
      id: "CHK-SQL-001",
      query_hint: "SELECT lastLoginAt FROM User WHERE email = ?",
    },
    {
      ...packInput.checks.sql[0],
      id: "CHK-SQL-002",
      title: "Session timestamp updated",
      query_hint: "SELECT createdAt FROM Session WHERE userId = ?",
    },
  ];

  const pack = validatePackContent(packInput).value;
  const report = validatePrismaGrounding(
    pack,
    buildGroundingSummary([
      {
        name: "User",
        fields: [
          { name: "lastLoginAt", type: "DateTime" },
          { name: "email", type: "String" },
        ],
      },
      {
        name: "Session",
        fields: [
          { name: "userId", type: "String" },
          { name: "createdAt", type: "DateTime" },
        ],
      },
    ]),
  );

  assert.equal(report.status, "grounded");
  assert.equal(report.sql_checks_total, 2);
  assert.equal(report.sql_checks_grounded, 2);
  assert.equal(report.sql_checks_semantic, 0);
  assert.deepEqual(report.grounded_models, [
    {
      name: "Session",
      fields: ["createdAt", "userId"],
    },
    {
      name: "User",
      fields: ["email", "lastLoginAt"],
    },
  ]);
});

test("validatePrismaGrounding grounds empty SQL checks when artifact exists", () => {
  const packInput = cloneExamplePack();
  packInput.checks.sql = [];

  const pack = validatePackContent(packInput).value;
  const report = validatePrismaGrounding(
    pack,
    buildGroundingSummary([
      {
        name: "User",
        fields: [{ name: "email", type: "String" }],
      },
    ]),
  );

  assert.equal(report.status, "grounded");
  assert.equal(report.sql_checks_total, 0);
  assert.equal(report.sql_checks_grounded, 0);
});

test("downgradeSqlChecksToSemantic converts mismatched concrete checks into semantic checks", () => {
  const packInput = cloneExamplePack();
  packInput.checks.sql[0].query_hint =
    "SELECT last_login_at FROM users WHERE email = ?";

  const grounding = buildGroundingSummary([
    {
      name: "User",
      fields: [
        { name: "email", type: "String" },
        { name: "lastLoginAt", type: "DateTime" },
      ],
    },
  ]);

  const pack = validatePackContent(packInput).value;
  const initialReport = validatePrismaGrounding(pack, grounding);
  const downgradedPack = downgradeSqlChecksToSemantic(pack, initialReport);
  const downgradedReport = validatePrismaGrounding(downgradedPack, grounding);

  assert.match(
    downgradedPack.checks.sql[0]?.query_hint ?? "",
    /^NEEDS_MAPPING:/,
  );
  assert.match(
    downgradedPack.checks.sql[0]?.title ?? "",
    /needs schema mapping/i,
  );
  assert.equal(downgradedReport.status, "grounded");
  assert.equal(downgradedReport.sql_checks_grounded, 0);
  assert.equal(downgradedReport.sql_checks_semantic, 1);
});
