import type { Requirement, RequirementSnapshot } from "@prisma/client";
import { validatePackContent, type CanonicalPackContent } from "@/server/packs/validatePack";

type PlaceholderRequirement = Pick<
  Requirement,
  "id" | "title" | "module_type" | "test_focus"
>;

type PlaceholderSnapshot = Pick<
  RequirementSnapshot,
  "id" | "version" | "source_hash" | "source_text"
>;

type GeneratePlaceholderPackInput = {
  requirement: PlaceholderRequirement;
  snapshot: PlaceholderSnapshot;
  actorClerkUserId: string;
};

function createSourceRef(
  snapshotId: string,
  lineCount: number,
  lineStart: number,
  lineEnd: number,
) {
  const boundedLineCount = Math.max(1, lineCount);
  const safeStart = Math.min(Math.max(lineStart, 1), boundedLineCount);
  const safeEnd = Math.max(safeStart, Math.min(Math.max(lineEnd, 1), boundedLineCount));

  return {
    snapshot_id: snapshotId,
    line_start: safeStart,
    line_end: safeEnd,
  };
}

function getScenarioFocus(testFocus: string[]) {
  const allowed = new Set(["UI", "API", "SQL", "ETL", "REGRESSION"]);
  const filtered = testFocus.filter((focus) => allowed.has(focus));

  if (filtered.length > 0) {
    return filtered as Array<"UI" | "API" | "SQL" | "ETL" | "REGRESSION">;
  }

  return ["UI", "API", "REGRESSION"] as Array<
    "UI" | "API" | "SQL" | "ETL" | "REGRESSION"
  >;
}

export function generatePlaceholderPack({
  requirement,
  snapshot,
  actorClerkUserId,
}: GeneratePlaceholderPackInput): CanonicalPackContent {
  const lineCount = snapshot.source_text.split(/\r\n|\n/).length;
  const scenarioFocus = getScenarioFocus(requirement.test_focus);
  const moduleTag = requirement.module_type.toLowerCase();
  const sourceRefA = createSourceRef(snapshot.id, lineCount, 1, 4);
  const sourceRefB = createSourceRef(snapshot.id, lineCount, 5, 8);
  const sourceRefC = createSourceRef(snapshot.id, lineCount, 9, 12);

  const draftPack = {
    schema_version: "1.0" as const,
    source: {
      requirement_id: requirement.id,
      requirement_snapshot_id: snapshot.id,
      requirement_snapshot_version: snapshot.version,
      source_hash: snapshot.source_hash,
    },
    assumptions: [
      "Authentication and authorization are already configured for this flow.",
      "Feature flags and environment configuration are stable in staging.",
    ],
    clarifying_questions: [
      {
        id: "Q-001",
        question: `What is the expected fallback behavior when ${requirement.title} receives invalid input?`,
        reason: "Needed to define negative-path expected outcomes.",
      },
      {
        id: "Q-002",
        question: "Are there workspace-level constraints that change data visibility rules?",
        reason: `Raised by ${actorClerkUserId} during draft generation.`,
      },
    ],
    scenarios: [
      {
        id: "SCN-001",
        title: `${requirement.title} happy path`,
        description:
          "Primary successful user journey should complete with expected persistence and response.",
        priority: "P1" as const,
        tags: [moduleTag, "smoke", "happy-path"],
        test_focus: scenarioFocus,
        source_refs: [sourceRefA],
      },
      {
        id: "SCN-002",
        title: `${requirement.title} validation and edge behavior`,
        description:
          "Invalid and boundary input handling should be deterministic and observable.",
        priority: "P1" as const,
        tags: [moduleTag, "validation", "edge-case"],
        test_focus: scenarioFocus,
        source_refs: [sourceRefB],
      },
    ],
    test_cases: [
      {
        id: "TC-001",
        scenario_id: "SCN-001",
        title: "UI flow succeeds with valid input",
        layer: "UI" as const,
        priority: "P1" as const,
        type: "POSITIVE" as const,
        preconditions: ["Authorized user in active workspace."],
        test_data: ["Valid request payload and identifiers."],
        steps: [
          {
            step_no: 1,
            action: "Open the target screen and provide valid input.",
            expected: "UI accepts input and enables submit action.",
          },
          {
            step_no: 2,
            action: "Submit the request.",
            expected: "Success confirmation is displayed to the user.",
          },
        ],
        tags: ["ui", "positive", moduleTag],
        source_refs: [sourceRefA],
      },
      {
        id: "TC-002",
        scenario_id: "SCN-001",
        title: "API contract returns success payload",
        layer: "API" as const,
        priority: "P1" as const,
        type: "POSITIVE" as const,
        preconditions: ["API authentication token is valid."],
        test_data: ["Well-formed JSON body for happy path."],
        steps: [
          {
            step_no: 1,
            action: "Send API request with valid payload.",
            expected: "HTTP 2xx status is returned.",
          },
          {
            step_no: 2,
            action: "Inspect API response body.",
            expected: "Response includes expected identifiers and status fields.",
          },
        ],
        tags: ["api", "positive", moduleTag],
        source_refs: [sourceRefA],
      },
      {
        id: "TC-003",
        scenario_id: "SCN-002",
        title: "UI rejects malformed input",
        layer: "UI" as const,
        priority: "P1" as const,
        type: "NEGATIVE" as const,
        preconditions: ["Authorized user in active workspace."],
        test_data: ["Input missing mandatory fields."],
        steps: [
          {
            step_no: 1,
            action: "Open the form and submit malformed input.",
            expected: "Validation errors are displayed and save is blocked.",
          },
          {
            step_no: 2,
            action: "Correct one field while leaving another invalid.",
            expected: "Validation updates incrementally and still prevents completion.",
          },
        ],
        tags: ["ui", "negative", "validation"],
        source_refs: [sourceRefB],
      },
      {
        id: "TC-004",
        scenario_id: "SCN-002",
        title: "API handles boundary values safely",
        layer: "API" as const,
        priority: "P2" as const,
        type: "EDGE" as const,
        preconditions: ["API authentication token is valid."],
        test_data: ["Boundary values near max lengths and numeric limits."],
        steps: [
          {
            step_no: 1,
            action: "Send API request with boundary values.",
            expected: "Request is handled without unhandled exceptions.",
          },
          {
            step_no: 2,
            action: "Verify response and persisted output.",
            expected: "Behavior matches documented validation and constraints.",
          },
        ],
        tags: ["api", "edge", "boundary"],
        source_refs: [sourceRefC],
      },
    ],
    checks: {
      api: [
        {
          id: "CHK-API-001",
          title: "Core endpoint contract check",
          method: "POST",
          endpoint: "/api/v1/placeholder",
          assertions: [
            "Response status should be 2xx for valid payloads.",
            "Error body shape should be stable for invalid payloads.",
          ],
          source_refs: [sourceRefB],
        },
      ],
      sql: [
        {
          id: "CHK-SQL-001",
          title: "Persistence integrity check",
          query_hint: "SELECT id, updated_at FROM target_table WHERE id = ?",
          validations: [
            "Row should be inserted or updated exactly once per successful action.",
            "Updated timestamp should reflect most recent successful request.",
          ],
          source_refs: [sourceRefC],
        },
      ],
      etl: [],
    },
  };

  return validatePackContent(draftPack).value;
}
