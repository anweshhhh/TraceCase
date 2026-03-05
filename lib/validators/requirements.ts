import { z } from "zod";

export const REQUIREMENT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const MODULE_TYPES = [
  "GENERIC",
  "LOGIN",
  "SIGNUP",
  "PAYMENTS",
  "CRUD",
  "API",
  "ETL",
] as const;
export const TEST_FOCUS_OPTIONS = [
  "UI",
  "API",
  "SQL",
  "ETL",
  "REGRESSION",
] as const;

export const requirementStatusSchema = z.enum(REQUIREMENT_STATUSES);
export const moduleTypeSchema = z.enum(MODULE_TYPES);
export const testFocusSchema = z.enum(TEST_FOCUS_OPTIONS);

export const requirementPayloadSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  module_type: moduleTypeSchema,
  test_focus: z.array(testFocusSchema),
  source_text: z.string().trim().min(1, "Source text is required"),
});

export const requirementListFilterSchema = z.object({
  status: requirementStatusSchema.optional(),
});

export type RequirementPayload = z.infer<typeof requirementPayloadSchema>;
export type RequirementStatusInput = z.infer<typeof requirementStatusSchema>;
