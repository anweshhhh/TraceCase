import type { PrismaGroundingSummary } from "@/server/prismaGrounding";
import type { CanonicalPackContent } from "@/server/packs/validatePack";

export type PrismaGroundingReport = {
  status: "grounded" | "needs_repair" | "skipped" | "failed";
  artifact_id: string | null;
  models_available: number;
  sql_checks_total: number;
  sql_checks_grounded: number;
  sql_checks_semantic: number;
  mismatches: Array<{
    check_id: string;
    reason: string;
    referenced_models: string[];
    referenced_fields: string[];
  }>;
  grounded_models: Array<{
    name: string;
    fields: string[];
  }>;
};

function normalizeIdentifier(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/^[`"'\[]+/, "")
    .replace(/[`"'\]]+$/, "")
    .trim()
    .toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function extractModelReferences(queryHint: string) {
  const references: string[] = [];
  const pattern =
    /\b(?:from|join|update|into|delete\s+from)\s+([`"\[]?[A-Za-z_][A-Za-z0-9_]*[`"\]]?)/gi;

  for (const match of queryHint.matchAll(pattern)) {
    const normalized = normalizeIdentifier(match[1]);

    if (normalized) {
      references.push(normalized);
    }
  }

  return uniqueSorted(references);
}

function extractFieldsFromSelect(queryHint: string) {
  const match = queryHint.match(/\bselect\b([\s\S]+?)\bfrom\b/i);

  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(",")
    .map((segment) => {
      const expression = segment.trim();

      if (!expression || expression === "*") {
        return null;
      }

      const aliasSplit = expression.split(/\bas\b/i, 1)[0] ?? expression;
      const identifierMatch = aliasSplit.match(
        /(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)$/,
      );

      return normalizeIdentifier(identifierMatch?.[1]);
    })
    .filter((value): value is string => Boolean(value));
}

function extractFieldsFromComparisons(queryHint: string) {
  const references: string[] = [];
  const pattern =
    /(?:\b[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)\b\s*(?:=|!=|<>|>=|<=|>|<|\blike\b|\bin\b|\bis\b)/gi;

  for (const match of queryHint.matchAll(pattern)) {
    const normalized = normalizeIdentifier(match[1]);

    if (normalized) {
      references.push(normalized);
    }
  }

  return references;
}

function extractFieldsFromAssignments(queryHint: string) {
  const match = queryHint.match(/\bset\b([\s\S]+?)(?:\bwhere\b|\breturning\b|$)/i);

  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(",")
    .map((segment) => {
      const assignmentMatch = segment.match(
        /(?:\b[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)\b\s*=/i,
      );

      return normalizeIdentifier(assignmentMatch?.[1]);
    })
    .filter((value): value is string => Boolean(value));
}

function extractFieldsFromInsert(queryHint: string) {
  const match = queryHint.match(
    /\binto\b\s+[`"\[]?[A-Za-z_][A-Za-z0-9_]*[`"\]]?\s*\(([^)]+)\)/i,
  );

  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(",")
    .map((segment) => normalizeIdentifier(segment))
    .filter((value): value is string => Boolean(value));
}

function extractFieldsFromReturning(queryHint: string) {
  const match = queryHint.match(/\breturning\b([\s\S]+)$/i);

  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(",")
    .map((segment) => {
      const identifierMatch = segment.match(
        /(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)/,
      );

      return normalizeIdentifier(identifierMatch?.[1]);
    })
    .filter((value): value is string => Boolean(value));
}

function extractSqlReferences(queryHint: string) {
  return {
    models: extractModelReferences(queryHint),
    fields: uniqueSorted([
      ...extractFieldsFromSelect(queryHint),
      ...extractFieldsFromComparisons(queryHint),
      ...extractFieldsFromAssignments(queryHint),
      ...extractFieldsFromInsert(queryHint),
      ...extractFieldsFromReturning(queryHint),
    ]),
  };
}

function buildGroundedModels(
  grounding: PrismaGroundingSummary,
): PrismaGroundingReport["grounded_models"] {
  return grounding.models
    .map((model) => ({
      name: model.name,
      fields: uniqueSorted(model.fields.map((field) => field.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildSemanticFallbackTitle(title: string) {
  return `${title.replace(/\s*\(needs schema mapping\)$/i, "").trim()} (needs schema mapping)`;
}

export function downgradeSqlChecksToSemantic(
  packContent: CanonicalPackContent,
  report: PrismaGroundingReport,
): CanonicalPackContent {
  if (report.mismatches.length === 0) {
    return structuredClone(packContent);
  }

  const mismatchIds = new Set(report.mismatches.map((mismatch) => mismatch.check_id));
  const next = structuredClone(packContent);

  next.checks.sql = next.checks.sql.map((check) => {
    if (!mismatchIds.has(check.id)) {
      return check;
    }

    return {
      ...check,
      title: buildSemanticFallbackTitle(check.title),
      query_hint: undefined,
      validations: [
        "Map the affected Prisma model and fields before converting this into a concrete SQL assertion.",
        "Confirm the required database outcome for this scenario after schema mapping is defined.",
      ],
    };
  });

  return next;
}

export function validatePrismaGrounding(
  packContent: CanonicalPackContent,
  grounding: PrismaGroundingSummary | null,
): PrismaGroundingReport {
  const sqlChecks = packContent.checks.sql ?? [];
  const semanticCount = sqlChecks.filter((check) => !check.query_hint?.trim()).length;

  if (!grounding) {
    return {
      status: "skipped",
      artifact_id: null,
      models_available: 0,
      sql_checks_total: sqlChecks.length,
      sql_checks_grounded: 0,
      sql_checks_semantic: semanticCount,
      mismatches: [],
      grounded_models: [],
    };
  }

  const groundedModels = buildGroundedModels(grounding);
  const modelFieldMap = new Map(
    groundedModels.map((model) => [
      normalizeIdentifier(model.name) ?? model.name.toLowerCase(),
      new Set(model.fields.map((field) => normalizeIdentifier(field) ?? field)),
    ]),
  );
  const mismatches: PrismaGroundingReport["mismatches"] = [];
  let sqlChecksGrounded = 0;
  let sqlChecksSemantic = 0;

  for (const check of sqlChecks) {
    const queryHint = check.query_hint?.trim();

    if (!queryHint) {
      sqlChecksSemantic += 1;
      continue;
    }

    const references = extractSqlReferences(queryHint);

    if (references.models.length === 0) {
      mismatches.push({
        check_id: check.id,
        reason:
          "Concrete SQL check does not contain a grounded Prisma model reference in query_hint.",
        referenced_models: [],
        referenced_fields: references.fields,
      });
      continue;
    }

    const unsupportedModels = references.models.filter(
      (model) => !modelFieldMap.has(model),
    );

    if (unsupportedModels.length > 0) {
      mismatches.push({
        check_id: check.id,
        reason: `Concrete SQL check references unsupported Prisma model(s): ${unsupportedModels.join(", ")}.`,
        referenced_models: references.models,
        referenced_fields: references.fields,
      });
      continue;
    }

    const allowedFields = new Set<string>();

    references.models.forEach((model) => {
      modelFieldMap.get(model)?.forEach((field) => allowedFields.add(field));
    });

    const unsupportedFields = references.fields.filter(
      (field) => !allowedFields.has(field),
    );

    if (unsupportedFields.length > 0) {
      mismatches.push({
        check_id: check.id,
        reason: `Concrete SQL check references unsupported Prisma field(s): ${unsupportedFields.join(", ")}.`,
        referenced_models: references.models,
        referenced_fields: references.fields,
      });
      continue;
    }

    sqlChecksGrounded += 1;
  }

  return {
    status: mismatches.length > 0 ? "needs_repair" : "grounded",
    artifact_id: grounding.artifact_id,
    models_available: groundedModels.length,
    sql_checks_total: sqlChecks.length,
    sql_checks_grounded: sqlChecksGrounded,
    sql_checks_semantic: sqlChecksSemantic,
    mismatches,
    grounded_models: groundedModels,
  };
}
