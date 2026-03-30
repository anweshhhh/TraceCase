import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequirementArtifactAuditMetadata,
  buildRequirementArtifactsPanelViewModel,
  prepareRequirementArtifactForWrite,
  readArtifactParseSummary,
} from "@/lib/requirementArtifacts";
import { parseRequirementArtifactContent } from "@/server/artifactParsers";
import {
  createRequirementArtifactWithDeps,
  deleteRequirementArtifactWithDeps,
  listRequirementArtifactsWithDeps,
  type RequirementArtifactRecord,
  type RequirementArtifactServiceDeps,
  updateRequirementArtifactWithDeps,
} from "@/server/requirementArtifactsCore";

const FIXED_PARSED_AT = new Date("2026-03-09T22:00:00.000Z");

function createArtifactHarness() {
  const workspaceId = "ws_123";
  const actorId = "user_123";
  const requirementId = "req_123";
  const snapshots = [
    {
      id: "snap_v1",
      requirement_id: requirementId,
    },
    {
      id: "snap_v2",
      requirement_id: requirementId,
    },
  ];
  const artifacts: Array<RequirementArtifactRecord & { workspace_id: string }> = [];
  const auditEvents: Array<{
    workspaceId: string;
    actorClerkUserId: string;
    action: string;
    entityType: "requirement_artifact";
    entityId: string;
    metadata: ReturnType<typeof buildRequirementArtifactAuditMetadata>;
  }> = [];
  let sequence = 0;

  function nextTimestamp() {
    const value = new Date(Date.UTC(2026, 2, 9, 22, 0, sequence));
    sequence += 1;

    return value;
  }

  const deps: RequirementArtifactServiceDeps = {
    assertCanEdit: async () => {},
    parseArtifact: ({ type, contentText }) =>
      parseRequirementArtifactContent({
        artifactType: type,
        contentText,
        parsedAt: FIXED_PARSED_AT,
      }),
    listArtifacts: async (inputWorkspaceId, snapshotId) =>
      artifacts
        .filter(
          (artifact) =>
            artifact.workspace_id === inputWorkspaceId &&
            artifact.requirement_snapshot_id === snapshotId,
        )
        .sort((left, right) => right.updated_at.getTime() - left.updated_at.getTime()),
    findSnapshot: async (inputWorkspaceId, snapshotId) => {
      if (inputWorkspaceId !== workspaceId) {
        return null;
      }

      return snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
    },
    createArtifact: async (data) => {
      const timestamp = nextTimestamp();
      const createdArtifact = {
        id: `art_${artifacts.length + 1}`,
        workspace_id: data.workspace_id,
        requirement_snapshot_id: data.requirement_snapshot_id,
        type: data.type,
        title: data.title,
        content_text: data.content_text,
        content_hash: data.content_hash,
        mime_type: data.mime_type,
        metadata_json: data.metadata_json,
        created_at: timestamp,
        updated_at: timestamp,
      };

      artifacts.push(createdArtifact);

      return createdArtifact;
    },
    findArtifact: async (inputWorkspaceId, artifactId) => {
      const artifact = artifacts.find(
        (candidate) =>
          candidate.id === artifactId && candidate.workspace_id === inputWorkspaceId,
      );

      if (!artifact) {
        return null;
      }

      const snapshot = snapshots.find(
        (candidate) => candidate.id === artifact.requirement_snapshot_id,
      );

      if (!snapshot) {
        return null;
      }

      return {
        id: artifact.id,
        requirement_snapshot_id: artifact.requirement_snapshot_id,
        type: artifact.type,
        title: artifact.title,
        content_hash: artifact.content_hash,
        requirement_snapshot: {
          requirement_id: snapshot.requirement_id,
        },
      };
    },
    updateArtifact: async (artifactId, data) => {
      const artifactIndex = artifacts.findIndex(
        (candidate) => candidate.id === artifactId,
      );

      if (artifactIndex === -1) {
        throw new Error("Artifact not found in harness.");
      }

      const updatedArtifact = {
        ...artifacts[artifactIndex],
        ...data,
        updated_at: nextTimestamp(),
      };

      artifacts[artifactIndex] = updatedArtifact;

      return updatedArtifact;
    },
    deleteArtifact: async (artifactId) => {
      const artifactIndex = artifacts.findIndex(
        (candidate) => candidate.id === artifactId,
      );

      if (artifactIndex === -1) {
        throw new Error("Artifact not found in harness.");
      }

      artifacts.splice(artifactIndex, 1);
    },
    logAuditEvent: async (event) => {
      auditEvents.push(event);
    },
  };

  return {
    workspaceId,
    actorId,
    snapshots,
    artifacts,
    auditEvents,
    deps,
  };
}

test("parseRequirementArtifactContent parses valid OpenAPI YAML with sorted operations", async () => {
  const summary = await parseRequirementArtifactContent({
    artifactType: "OPENAPI",
    contentText: [
      "openapi: 3.0.3",
      "info:",
      "  title: TraceCase Auth API",
      "  version: 1.0.0",
      "paths:",
      "  /auth/verify-otp:",
      "    post:",
      "      responses:",
      '        "200":',
      "          description: ok",
      "  /auth/login:",
      "    post:",
      "      responses:",
      '        "200":',
      "          description: ok",
      "    get:",
      "      responses:",
      '        "200":',
      "          description: ok",
    ].join("\n"),
    parsedAt: FIXED_PARSED_AT,
  });

  assert.deepEqual(summary, {
    status: "valid",
    artifact_type: "OPENAPI",
    format: "yaml",
    openapi_version: "3.0.3",
    operations_count: 3,
    operations: [
      { method: "get", path: "/auth/login" },
      { method: "post", path: "/auth/login" },
      { method: "post", path: "/auth/verify-otp" },
    ],
    errors: [],
    parsed_at: FIXED_PARSED_AT.toISOString(),
  });
});

test("parseRequirementArtifactContent parses valid OpenAPI JSON", async () => {
  const summary = await parseRequirementArtifactContent({
    artifactType: "OPENAPI",
    contentText: JSON.stringify({
      openapi: "3.1.0",
      info: {
        title: "TraceCase API",
        version: "1.0.0",
      },
      paths: {
        "/auth/resend-otp": {
          post: {
            responses: {
              200: {
                description: "ok",
              },
            },
          },
        },
      },
    }),
    parsedAt: FIXED_PARSED_AT,
  });

  assert.equal(summary.status, "valid");
  assert.equal(summary.artifact_type, "OPENAPI");
  assert.equal(summary.format, "json");
  assert.equal(summary.operations_count, 1);
  assert.deepEqual(summary.operations, [
    { method: "post", path: "/auth/resend-otp" },
  ]);
});

test("parseRequirementArtifactContent returns safe invalid OpenAPI summaries", async () => {
  const summary = await parseRequirementArtifactContent({
    artifactType: "OPENAPI",
    contentText: "openapi: 3.0.3\ninfo:\n  title: Broken",
    parsedAt: FIXED_PARSED_AT,
  });

  assert.equal(summary.status, "invalid");
  assert.equal(summary.artifact_type, "OPENAPI");
  assert.equal(summary.operations_count, 0);
  assert.equal(summary.errors.length > 0, true);
  assert.equal(summary.errors.every((error) => error.length <= 240), true);
});

test("parseRequirementArtifactContent parses valid Prisma schema with sorted models and fields", async () => {
  const summary = await parseRequirementArtifactContent({
    artifactType: "PRISMA_SCHEMA",
    contentText: [
      'datasource db {',
      '  provider = "postgresql"',
      '  url      = env("DATABASE_URL")',
      "}",
      "",
      "model Post {",
      "  title String",
      "  author User?",
      "  id String @id",
      "}",
      "",
      "model User {",
      "  posts Post[]",
      "  email String @unique",
      "  id String @id @default(cuid())",
      "}",
    ].join("\n"),
    parsedAt: FIXED_PARSED_AT,
  });

  assert.deepEqual(summary, {
    status: "valid",
    artifact_type: "PRISMA_SCHEMA",
    model_count: 2,
    models: [
      {
        name: "Post",
        fields: [
          { name: "author", type: "User?" },
          { name: "id", type: "String" },
          { name: "title", type: "String" },
        ],
      },
      {
        name: "User",
        fields: [
          { name: "email", type: "String" },
          { name: "id", type: "String" },
          { name: "posts", type: "Post[]" },
        ],
      },
    ],
    errors: [],
    parsed_at: FIXED_PARSED_AT.toISOString(),
  });
});

test("parseRequirementArtifactContent returns safe invalid Prisma schema summaries", async () => {
  const summary = await parseRequirementArtifactContent({
    artifactType: "PRISMA_SCHEMA",
    contentText: "model User { id String @id",
    parsedAt: FIXED_PARSED_AT,
  });

  assert.equal(summary.status, "invalid");
  assert.equal(summary.artifact_type, "PRISMA_SCHEMA");
  assert.equal(summary.model_count, 0);
  assert.equal(summary.errors.length > 0, true);
  assert.equal(summary.errors.every((error) => error.length <= 240), true);
});

test("artifact create/update/delete flow stores parse metadata and emits safe audit metadata", async () => {
  const harness = createArtifactHarness();

  const created = await createRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    harness.snapshots[0].id,
    {
      type: "OPENAPI",
      title: "",
      content_text: [
        "openapi: 3.1.0  ",
        "info:",
        "  title: Pets   ",
        "  version: 1.0.0",
        "paths:",
        "  /pets:",
        "    get:",
        "      responses:",
        '        "200":',
        "          description: ok",
      ].join("\r\n"),
    },
  );

  assert.equal(created.artifact.title, "OpenAPI Spec");
  assert.equal(created.artifact.requirement_snapshot_id, harness.snapshots[0].id);
  assert.equal(
    created.artifact.content_text,
    [
      "openapi: 3.1.0",
      "info:",
      "  title: Pets",
      "  version: 1.0.0",
      "paths:",
      "  /pets:",
      "    get:",
      "      responses:",
      '        "200":',
      "          description: ok",
    ].join("\n"),
  );
  assert.match(created.artifact.content_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(readArtifactParseSummary(created.artifact.metadata_json), {
    status: "valid",
    artifact_type: "OPENAPI",
    format: "yaml",
    openapi_version: "3.1.0",
    operations_count: 1,
    operations: [{ method: "get", path: "/pets" }],
    errors: [],
    parsed_at: FIXED_PARSED_AT.toISOString(),
  });
  assert.deepEqual(harness.auditEvents[0]?.metadata, {
    artifact_id: created.artifact.id,
    snapshot_id: harness.snapshots[0].id,
    type: "OPENAPI",
    content_hash: created.artifact.content_hash,
    title: "OpenAPI Spec",
  });
  assert.equal("content_text" in harness.auditEvents[0].metadata, false);
  assert.equal("status" in harness.auditEvents[0].metadata, false);

  const updated = await updateRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    created.artifact.id,
    {
      type: "OPENAPI",
      title: created.artifact.title,
      content_text: [
        "openapi: 3.1.0",
        "info:",
        "  title: Orders",
        "  version: 1.0.0",
        "paths:",
        "  /orders:",
        "    post:",
        "      responses:",
        '        "200":',
        "          description: ok",
      ].join("\n"),
    },
  );

  assert.notEqual(updated.artifact.content_hash, created.artifact.content_hash);
  assert.equal(
    updated.artifact.requirement_snapshot_id,
    created.artifact.requirement_snapshot_id,
  );
  assert.equal(updated.artifact.type, "OPENAPI");
  assert.notEqual(
    updated.artifact.updated_at.toISOString(),
    created.artifact.updated_at.toISOString(),
  );
  assert.deepEqual(readArtifactParseSummary(updated.artifact.metadata_json), {
    status: "valid",
    artifact_type: "OPENAPI",
    format: "yaml",
    openapi_version: "3.1.0",
    operations_count: 1,
    operations: [{ method: "post", path: "/orders" }],
    errors: [],
    parsed_at: FIXED_PARSED_AT.toISOString(),
  });
  assert.deepEqual(harness.auditEvents[1]?.metadata, {
    artifact_id: updated.artifact.id,
    snapshot_id: harness.snapshots[0].id,
    type: "OPENAPI",
    content_hash: updated.artifact.content_hash,
    title: "OpenAPI Spec",
  });
  assert.equal("content_text" in harness.auditEvents[1].metadata, false);
  assert.equal("operations" in harness.auditEvents[1].metadata, false);

  await deleteRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    created.artifact.id,
  );

  assert.equal(
    harness.artifacts.find((artifact) => artifact.id === created.artifact.id) ?? null,
    null,
  );
  assert.deepEqual(harness.auditEvents[2]?.metadata, {
    artifact_id: created.artifact.id,
    snapshot_id: harness.snapshots[0].id,
    type: "OPENAPI",
    content_hash: updated.artifact.content_hash,
    title: "OpenAPI Spec",
  });
  assert.equal("content_text" in harness.auditEvents[2].metadata, false);
  assert.equal("errors" in harness.auditEvents[2].metadata, false);
});

test("artifact create stores valid and invalid parse metadata by artifact type", async () => {
  const harness = createArtifactHarness();

  const invalidOpenApi = await createRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    harness.snapshots[0].id,
    {
      type: "OPENAPI",
      title: "",
      content_text: "openapi: 3.0.3\ninfo:\n  title: Broken",
    },
  );
  const validPrisma = await createRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    harness.snapshots[1].id,
    {
      type: "PRISMA_SCHEMA",
      title: "",
      content_text: [
        'datasource db {',
        '  provider = "postgresql"',
        '  url      = env("DATABASE_URL")',
        "}",
        "",
        "model User {",
        "  id    String @id @default(cuid())",
        "  email String @unique",
        "}",
        "",
        "model Session {",
        "  id     String @id",
        "  userId String",
        "}",
      ].join("\n"),
    },
  );

  assert.equal(readArtifactParseSummary(invalidOpenApi.artifact.metadata_json)?.status, "invalid");
  assert.deepEqual(readArtifactParseSummary(validPrisma.artifact.metadata_json), {
    status: "valid",
    artifact_type: "PRISMA_SCHEMA",
    model_count: 2,
    models: [
      {
        name: "Session",
        fields: [
          { name: "id", type: "String" },
          { name: "userId", type: "String" },
        ],
      },
      {
        name: "User",
        fields: [
          { name: "email", type: "String" },
          { name: "id", type: "String" },
        ],
      },
    ],
    errors: [],
    parsed_at: FIXED_PARSED_AT.toISOString(),
  });
});

test("artifact update recomputes metadata_json across valid and invalid content", async () => {
  const harness = createArtifactHarness();

  const created = await createRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    harness.snapshots[0].id,
    {
      type: "OPENAPI",
      title: "",
      content_text: [
        "openapi: 3.0.3",
        "info:",
        "  title: TraceCase Auth API",
        "  version: 1.0.0",
        "paths:",
        "  /auth/login:",
        "    post:",
        "      responses:",
        '        "200":',
        "          description: ok",
      ].join("\n"),
    },
  );

  assert.equal(readArtifactParseSummary(created.artifact.metadata_json)?.status, "valid");

  const invalidUpdate = await updateRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    created.artifact.id,
    {
      type: "OPENAPI",
      title: created.artifact.title,
      content_text: "openapi: 3.0.3\ninfo:\n  title: Broken",
    },
  );

  assert.equal(readArtifactParseSummary(invalidUpdate.artifact.metadata_json)?.status, "invalid");

  const validRecovery = await updateRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    created.artifact.id,
    {
      type: "OPENAPI",
      title: created.artifact.title,
      content_text: JSON.stringify({
        openapi: "3.0.3",
        info: {
          title: "TraceCase Auth API",
          version: "1.0.0",
        },
        paths: {
          "/auth/resend-otp": {
            post: {
              responses: {
                200: {
                  description: "ok",
                },
              },
            },
          },
        },
      }),
    },
  );

  const recoveredSummary = readArtifactParseSummary(validRecovery.artifact.metadata_json);
  assert.equal(recoveredSummary?.status, "valid");
  assert.equal(recoveredSummary?.artifact_type, "OPENAPI");
  if (recoveredSummary?.artifact_type === "OPENAPI") {
    assert.equal(recoveredSummary.format, "json");
    assert.equal(recoveredSummary.operations_count, 1);
  }
});

test("artifacts stay attached to the original snapshot when newer snapshots exist", async () => {
  const harness = createArtifactHarness();

  const createdOpenApi = await createRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    harness.snapshots[0].id,
    {
      type: "OPENAPI",
      title: "",
      content_text: [
        "openapi: 3.0.3",
        "info:",
        "  title: TraceCase Auth API",
        "  version: 1.0.0",
        "paths:",
        "  /auth/login:",
        "    post:",
        "      responses:",
        '        "200":',
        "          description: ok",
      ].join("\n"),
    },
  );
  const createdPrisma = await createRequirementArtifactWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.actorId,
    harness.snapshots[1].id,
    {
      type: "PRISMA_SCHEMA",
      title: "",
      content_text: [
        'datasource db {',
        '  provider = "postgresql"',
        '  url      = env("DATABASE_URL")',
        "}",
        "",
        "model User {",
        "  id String @id",
        "}",
      ].join("\n"),
    },
  );

  const snapshotOneArtifacts = await listRequirementArtifactsWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.snapshots[0].id,
  );
  const snapshotTwoArtifacts = await listRequirementArtifactsWithDeps(
    harness.deps,
    harness.workspaceId,
    harness.snapshots[1].id,
  );

  assert.equal(createdPrisma.artifact.title, "Prisma Schema");
  assert.equal(snapshotOneArtifacts.length, 1);
  assert.equal(snapshotTwoArtifacts.length, 1);
  assert.equal(snapshotOneArtifacts[0]?.id, createdOpenApi.artifact.id);
  assert.equal(snapshotTwoArtifacts[0]?.id, createdPrisma.artifact.id);
  assert.equal(
    snapshotTwoArtifacts.every(
      (artifact) =>
        artifact.requirement_snapshot_id === harness.snapshots[1].id &&
        artifact.id !== createdOpenApi.artifact.id,
    ),
    true,
  );
});

test("panel view model exposes parse state summaries and respects edit permissions", () => {
  const view = buildRequirementArtifactsPanelViewModel({
    artifacts: [
      {
        id: "art_latest",
        type: "OPENAPI",
        title: "Auth API",
        content_text: "openapi: 3.0.3",
        content_hash: "abcdef0123456789",
        updated_at_label: "Mar 9, 2026, 4:00 PM",
        parse_summary: {
          status: "valid",
          artifact_type: "OPENAPI",
          format: "yaml",
          openapi_version: "3.0.3",
          operations_count: 3,
          operations: [
            { method: "get", path: "/auth/login" },
            { method: "post", path: "/auth/login" },
            { method: "post", path: "/auth/verify-otp" },
          ],
          errors: [],
          parsed_at: FIXED_PARSED_AT.toISOString(),
        },
      },
      {
        id: "art_invalid_openapi",
        type: "OPENAPI",
        title: "Broken Auth API",
        content_text: "openapi: 3.0.3\ninfo:\n  title: Broken",
        content_hash: "fedcba9876543210",
        updated_at_label: "Mar 9, 2026, 4:01 PM",
        parse_summary: {
          status: "invalid",
          artifact_type: "OPENAPI",
          format: "yaml",
          openapi_version: "3.0.3",
          operations_count: 0,
          operations: [],
          errors: ["Missing required property: version"],
          parsed_at: FIXED_PARSED_AT.toISOString(),
        },
      },
      {
        id: "art_valid_prisma",
        type: "PRISMA_SCHEMA",
        title: "Prisma Schema",
        content_text: "model User { id String @id }",
        content_hash: "1234567890abcdef",
        updated_at_label: "Mar 9, 2026, 4:02 PM",
        parse_summary: {
          status: "valid",
          artifact_type: "PRISMA_SCHEMA",
          model_count: 5,
          models: [],
          errors: [],
          parsed_at: FIXED_PARSED_AT.toISOString(),
        },
      },
    ],
    canEdit: false,
  });

  assert.equal(view.emptyMessage, null);
  assert.deepEqual(view.items, [
    {
      id: "art_latest",
      type: "OPENAPI",
      title: "Auth API",
      content_text: "openapi: 3.0.3",
      content_hash: "abcdef0123456789",
      updated_at_label: "Mar 9, 2026, 4:00 PM",
      parse_summary: {
        status: "valid",
        artifact_type: "OPENAPI",
        format: "yaml",
        openapi_version: "3.0.3",
        operations_count: 3,
        operations: [
          { method: "get", path: "/auth/login" },
          { method: "post", path: "/auth/login" },
          { method: "post", path: "/auth/verify-otp" },
        ],
        errors: [],
        parsed_at: FIXED_PARSED_AT.toISOString(),
      },
      typeLabel: "OpenAPI",
      hashPrefix: "abcdef01",
      updatedLabel: "Mar 9, 2026, 4:00 PM",
      parseStatus: "valid",
      parseStatusLabel: "Valid",
      parseSummaryText: "OpenAPI valid • 3 operations",
      parseErrorPreview: null,
      canEdit: false,
      canDelete: false,
    },
    {
      id: "art_invalid_openapi",
      type: "OPENAPI",
      title: "Broken Auth API",
      content_text: "openapi: 3.0.3\ninfo:\n  title: Broken",
      content_hash: "fedcba9876543210",
      updated_at_label: "Mar 9, 2026, 4:01 PM",
      parse_summary: {
        status: "invalid",
        artifact_type: "OPENAPI",
        format: "yaml",
        openapi_version: "3.0.3",
        operations_count: 0,
        operations: [],
        errors: ["Missing required property: version"],
        parsed_at: FIXED_PARSED_AT.toISOString(),
      },
      typeLabel: "OpenAPI",
      hashPrefix: "fedcba98",
      updatedLabel: "Mar 9, 2026, 4:01 PM",
      parseStatus: "invalid",
      parseStatusLabel: "Invalid",
      parseSummaryText: "OpenAPI invalid • Invalid spec",
      parseErrorPreview: "Missing required property: version",
      canEdit: false,
      canDelete: false,
    },
    {
      id: "art_valid_prisma",
      type: "PRISMA_SCHEMA",
      title: "Prisma Schema",
      content_text: "model User { id String @id }",
      content_hash: "1234567890abcdef",
      updated_at_label: "Mar 9, 2026, 4:02 PM",
      parse_summary: {
        status: "valid",
        artifact_type: "PRISMA_SCHEMA",
        model_count: 5,
        models: [],
        errors: [],
        parsed_at: FIXED_PARSED_AT.toISOString(),
      },
      typeLabel: "Prisma Schema",
      hashPrefix: "12345678",
      updatedLabel: "Mar 9, 2026, 4:02 PM",
      parseStatus: "valid",
      parseStatusLabel: "Valid",
      parseSummaryText: "Prisma schema valid • 5 models",
      parseErrorPreview: null,
      canEdit: false,
      canDelete: false,
    },
  ]);

  const fallbackView = buildRequirementArtifactsPanelViewModel({
    artifacts: [
      {
        id: "art_editable",
        type: "PRISMA_SCHEMA",
        title: "Schema",
        content_text: "model User { id String @id }",
        content_hash: "1234567890abcdef",
        updated_at_label: "   ",
        parse_summary: {
          status: "invalid",
          artifact_type: "PRISMA_SCHEMA",
          model_count: 0,
          models: [],
          errors: ["Unexpected token."],
          parsed_at: FIXED_PARSED_AT.toISOString(),
        },
      },
      {
        id: "art_unknown",
        type: "OPENAPI",
        title: "Unknown Parse",
        content_text: "{}",
        content_hash: "ffffffffffffffff",
        updated_at_label: "Mar 9, 2026, 4:03 PM",
        parse_summary: null,
      },
    ],
    canEdit: true,
  });

  assert.equal(fallbackView.items[0]?.typeLabel, "Prisma Schema");
  assert.equal(fallbackView.items[0]?.updatedLabel, "recently");
  assert.equal(fallbackView.items[0]?.parseStatusLabel, "Invalid");
  assert.equal(
    fallbackView.items[0]?.parseSummaryText,
    "Prisma schema invalid • Invalid schema",
  );
  assert.equal(fallbackView.items[0]?.parseErrorPreview, "Unexpected token.");
  assert.equal(fallbackView.items[0]?.canEdit, true);
  assert.equal(fallbackView.items[0]?.canDelete, true);
  assert.equal(fallbackView.items[1]?.parseStatusLabel, "Unknown");
  assert.equal(
    fallbackView.items[1]?.parseSummaryText,
    "OpenAPI parse state unavailable",
  );
  assert.equal(
    buildRequirementArtifactsPanelViewModel({
      artifacts: [],
      canEdit: true,
    }).emptyMessage,
    "No artifacts saved for the latest snapshot yet.",
  );
});

test("artifact write preparation changes content_hash when normalized content changes", () => {
  const initial = prepareRequirementArtifactForWrite({
    type: "OPENAPI",
    title: "",
    content_text: "openapi: 3.1.0\ninfo:\n  title: Pets",
  });
  const updated = prepareRequirementArtifactForWrite({
    type: "OPENAPI",
    title: "",
    content_text: "openapi: 3.1.0\ninfo:\n  title: Orders",
  });

  assert.equal(initial.title, "OpenAPI Spec");
  assert.equal(updated.title, "OpenAPI Spec");
  assert.notEqual(initial.content_hash, updated.content_hash);
});
