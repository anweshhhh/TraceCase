import { hashSourceText, normalizeSourceText } from "@/lib/sourceText";
import type { RequirementArtifactTypeValue } from "@/lib/validators/requirementArtifacts";

export function normalizeArtifactText(text: string) {
  return normalizeSourceText(text);
}

export function hashArtifactText(text: string) {
  return hashSourceText(text);
}

export function getRequirementArtifactDefaultTitle(
  type: RequirementArtifactTypeValue,
) {
  return type === "OPENAPI" ? "OpenAPI Spec" : "Prisma Schema";
}

export function getRequirementArtifactTypeLabel(type: RequirementArtifactTypeValue) {
  return type === "OPENAPI" ? "OpenAPI" : "Prisma Schema";
}
