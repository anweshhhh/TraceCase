import { z } from "zod";

export const REQUIREMENT_ARTIFACT_TYPES = [
  "OPENAPI",
  "PRISMA_SCHEMA",
] as const;

export type RequirementArtifactTypeValue =
  (typeof REQUIREMENT_ARTIFACT_TYPES)[number];

export const requirementArtifactTypeSchema = z.enum(REQUIREMENT_ARTIFACT_TYPES);

export const requirementArtifactPayloadSchema = z.object({
  type: requirementArtifactTypeSchema,
  title: z.string().trim().max(120, "Title must be 120 characters or fewer.").optional(),
  content_text: z.string().trim().min(1, "Artifact content is required."),
});

export type RequirementArtifactPayload = z.infer<
  typeof requirementArtifactPayloadSchema
>;
