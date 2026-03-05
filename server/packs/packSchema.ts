import { z } from "zod";

const trimmedString = z.string().trim().min(1);

export const testFocusSchema = z.enum([
  "UI",
  "API",
  "SQL",
  "ETL",
  "REGRESSION",
]);

export const layerSchema = z.enum(["UI", "API", "SQL", "ETL"]);
export const prioritySchema = z.enum(["P0", "P1", "P2", "P3"]);

export const sourceRefSchema = z.object({
  snapshot_id: trimmedString,
  line_start: z.number().int().min(1),
  line_end: z.number().int().min(1),
});

export const clarifyingQuestionSchema = z.object({
  id: z.string().regex(/^Q-\d{3}$/, "Invalid question id format"),
  question: trimmedString,
  reason: z.string().trim().optional(),
});

export const scenarioSchema = z.object({
  id: z.string().regex(/^SCN-\d{3}$/, "Invalid scenario id format"),
  title: trimmedString,
  description: trimmedString,
  priority: prioritySchema,
  tags: z.array(trimmedString),
  test_focus: z.array(testFocusSchema),
  source_refs: z.array(sourceRefSchema),
});

export const testCaseStepSchema = z.object({
  step_no: z.number().int().min(1),
  action: trimmedString,
  expected: trimmedString,
});

export const testCaseSchema = z.object({
  id: z.string().regex(/^TC-\d{3}$/, "Invalid test case id format"),
  scenario_id: z.string().regex(/^SCN-\d{3}$/, "Invalid scenario id format"),
  title: trimmedString,
  layer: layerSchema,
  priority: prioritySchema,
  type: z.enum(["POSITIVE", "NEGATIVE", "EDGE"]),
  preconditions: z.array(trimmedString),
  test_data: z.array(trimmedString),
  steps: z.array(testCaseStepSchema),
  tags: z.array(trimmedString),
  source_refs: z.array(sourceRefSchema),
});

export const apiCheckSchema = z.object({
  id: z.string().regex(/^CHK-API-\d{3}$/, "Invalid API check id format"),
  title: trimmedString,
  method: z.string().trim().optional(),
  endpoint: z.string().trim().optional(),
  assertions: z.array(trimmedString),
  source_refs: z.array(sourceRefSchema),
});

export const sqlCheckSchema = z.object({
  id: z.string().regex(/^CHK-SQL-\d{3}$/, "Invalid SQL check id format"),
  title: trimmedString,
  query_hint: z.string().trim().optional(),
  validations: z.array(trimmedString),
  source_refs: z.array(sourceRefSchema),
});

export const etlCheckSchema = z.object({
  id: z.string().regex(/^CHK-ETL-\d{3}$/, "Invalid ETL check id format"),
  title: trimmedString,
  validations: z.array(trimmedString),
  source_refs: z.array(sourceRefSchema),
});

export const checksSchema = z.object({
  api: z.array(apiCheckSchema).optional(),
  sql: z.array(sqlCheckSchema).optional(),
  etl: z.array(etlCheckSchema).optional(),
});

export const packSourceSchema = z.object({
  requirement_id: trimmedString,
  requirement_snapshot_id: trimmedString,
  requirement_snapshot_version: z.number().int().min(1),
  source_hash: z.string().regex(/^[a-f0-9]{64}$/i, "Invalid source hash format"),
});

export const packContentSchema = z.object({
  schema_version: z.literal("1.0"),
  source: packSourceSchema,
  assumptions: z.array(trimmedString),
  clarifying_questions: z.array(clarifyingQuestionSchema),
  scenarios: z.array(scenarioSchema),
  test_cases: z.array(testCaseSchema),
  checks: checksSchema,
});

export type PackContentInput = z.input<typeof packContentSchema>;
export type PackContent = z.output<typeof packContentSchema>;
export type PackSourceRef = z.output<typeof sourceRefSchema>;
