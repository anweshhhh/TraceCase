import path from "node:path";
import { spawnSync } from "node:child_process";
import * as SwaggerParser from "@apidevtools/swagger-parser";
import * as YAML from "yaml";
import type { RequirementArtifactTypeValue } from "@/lib/validators/requirementArtifacts";
import type {
  ArtifactParseSummary,
  OpenApiArtifactParseSummary,
  PrismaSchemaArtifactParseSummary,
} from "@/lib/requirementArtifacts";

const HTTP_METHODS = [
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
] as const;

type SwaggerParserValidateModule = {
  validate: (document: Record<string, unknown>) => Promise<unknown>;
};

function getPrismaSchemaAst(contentText: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "server/prismaAstWorker.cjs")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: contentText,
      maxBuffer: 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Invalid Prisma schema.");
  }

  return JSON.parse(result.stdout) as {
    list?: Array<{
      type?: string;
      name?: string;
      properties?: Array<{
        type?: string;
        name?: string;
        fieldType?: string;
        optional?: boolean;
        array?: boolean;
      }>;
    }>;
  };
}

function toParsedAt(parsedAt: Date) {
  return parsedAt.toISOString();
}

function sanitizeErrorMessage(error: unknown, fallback: string) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : fallback;

  const firstLine = rawMessage
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return (firstLine ?? fallback).slice(0, 240);
}

function detectOpenApiFormat(contentText: string): "json" | "yaml" {
  const trimmed = contentText.trimStart();

  return trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "yaml";
}

function extractOpenApiVersion(document: unknown) {
  if (!document || typeof document !== "object") {
    return null;
  }

  const record = document as Record<string, unknown>;

  if (typeof record.openapi === "string") {
    return record.openapi;
  }

  if (typeof record.swagger === "string") {
    return record.swagger;
  }

  return null;
}

function extractOpenApiOperations(
  document: Record<string, unknown>,
): OpenApiArtifactParseSummary["operations"] {
  const paths = document.paths;

  if (!paths || typeof paths !== "object") {
    return [];
  }

  const operations = new Map<string, { method: string; path: string }>();

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") {
      continue;
    }

    const record = pathItem as Record<string, unknown>;

    for (const method of HTTP_METHODS) {
      if (!record[method]) {
        continue;
      }

      operations.set(`${path}:${method}`, {
        method,
        path,
      });
    }
  }

  return [...operations.values()].sort((left, right) => {
    const pathComparison = left.path.localeCompare(right.path);

    return pathComparison !== 0
      ? pathComparison
      : left.method.localeCompare(right.method);
  });
}

async function parseOpenApiArtifact({
  contentText,
  parsedAt,
}: {
  contentText: string;
  parsedAt: Date;
}): Promise<OpenApiArtifactParseSummary> {
  const format = detectOpenApiFormat(contentText);
  let document: unknown;

  try {
    document =
      format === "json" ? JSON.parse(contentText) : YAML.parse(contentText);
  } catch (error) {
    return {
      status: "invalid",
      artifact_type: "OPENAPI",
      format,
      openapi_version: null,
      operations_count: 0,
      operations: [],
      errors: [sanitizeErrorMessage(error, "Unable to parse OpenAPI content.")],
      parsed_at: toParsedAt(parsedAt),
    };
  }

  try {
    const parser = SwaggerParser as unknown as SwaggerParserValidateModule;
    const validatedDocument = (await parser.validate(
      document as Record<string, unknown>,
    )) as Record<string, unknown>;
    const operations = extractOpenApiOperations(validatedDocument);

    return {
      status: "valid",
      artifact_type: "OPENAPI",
      format,
      openapi_version: extractOpenApiVersion(validatedDocument),
      operations_count: operations.length,
      operations,
      errors: [],
      parsed_at: toParsedAt(parsedAt),
    };
  } catch (error) {
    return {
      status: "invalid",
      artifact_type: "OPENAPI",
      format,
      openapi_version: extractOpenApiVersion(document),
      operations_count: 0,
      operations: [],
      errors: [sanitizeErrorMessage(error, "Invalid OpenAPI specification.")],
      parsed_at: toParsedAt(parsedAt),
    };
  }
}

async function parsePrismaSchemaArtifact({
  contentText,
  parsedAt,
}: {
  contentText: string;
  parsedAt: Date;
}): Promise<PrismaSchemaArtifactParseSummary> {
  try {
    const parsedSchema = getPrismaSchemaAst(contentText);

    const models = (parsedSchema.list ?? [])
      .filter((item) => item.type === "model" && typeof item.name === "string")
      .map((model) => ({
        name: model.name as string,
        fields: (model.properties ?? [])
          .filter(
            (property) =>
              property.type === "field" &&
              typeof property.name === "string" &&
              typeof property.fieldType === "string",
          )
          .map((field) => ({
            name: field.name as string,
            type: `${field.fieldType}${field.array ? "[]" : ""}${field.optional ? "?" : ""}`,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      status: "valid",
      artifact_type: "PRISMA_SCHEMA",
      model_count: models.length,
      models,
      errors: [],
      parsed_at: toParsedAt(parsedAt),
    };
  } catch (error) {
    return {
      status: "invalid",
      artifact_type: "PRISMA_SCHEMA",
      model_count: 0,
      models: [],
      errors: [sanitizeErrorMessage(error, "Invalid Prisma schema.")],
      parsed_at: toParsedAt(parsedAt),
    };
  }
}

export async function parseRequirementArtifactContent({
  artifactType,
  contentText,
  parsedAt = new Date(),
}: {
  artifactType: RequirementArtifactTypeValue;
  contentText: string;
  parsedAt?: Date;
}): Promise<ArtifactParseSummary> {
  if (artifactType === "OPENAPI") {
    return parseOpenApiArtifact({
      contentText,
      parsedAt,
    });
  }

  return parsePrismaSchemaArtifact({
    contentText,
    parsedAt,
  });
}
