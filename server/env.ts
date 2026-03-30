import { z } from "zod";

const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(["local", "staging", "prod"]).default("local"),
    DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL."),
    AI_PROVIDER: z.enum(["placeholder", "openai"]).default("placeholder"),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().trim().min(1).default("gpt-5-mini"),
    OPENAI_GENERATION_MODEL: z.string().trim().min(1).optional(),
    OPENAI_STORE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
      .string()
      .min(1, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required."),
    CLERK_SECRET_KEY: z.string().min(1, "CLERK_SECRET_KEY is required."),
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: z
      .string()
      .min(1, "NEXT_PUBLIC_CLERK_SIGN_IN_URL is required."),
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: z
      .string()
      .min(1, "NEXT_PUBLIC_CLERK_SIGN_UP_URL is required."),
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: z
      .string()
      .min(1, "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL is required."),
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: z
      .string()
      .min(1, "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL is required."),
    INNGEST_DEV: z.enum(["0", "1"]).default("0"),
    INNGEST_BASE_URL: z
      .string()
      .url("INNGEST_BASE_URL must be a valid URL.")
      .optional()
      .or(z.literal("")),
    INNGEST_EVENT_KEY: z.string().optional(),
    APP_VERSION: z.string().optional(),
    RATE_LIMIT_STORE: z.enum(["memory", "redis"]).default("memory"),
    UPSTASH_REDIS_REST_URL: z
      .string()
      .url("UPSTASH_REDIS_REST_URL must be a valid URL.")
      .optional()
      .or(z.literal("")),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.AI_PROVIDER === "openai" && !value.OPENAI_API_KEY?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message:
          "OPENAI_API_KEY is required when AI_PROVIDER is \"openai\".",
      });
    }

    if (value.INNGEST_DEV !== "1" && !value.INNGEST_EVENT_KEY?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INNGEST_EVENT_KEY"],
        message: "INNGEST_EVENT_KEY is required when INNGEST_DEV is not \"1\".",
      });
    }

    if (value.RATE_LIMIT_STORE === "redis") {
      if (!value.UPSTASH_REDIS_REST_URL?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["UPSTASH_REDIS_REST_URL"],
          message:
            "UPSTASH_REDIS_REST_URL is required when RATE_LIMIT_STORE is \"redis\".",
        });
      }

      if (!value.UPSTASH_REDIS_REST_TOKEN?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["UPSTASH_REDIS_REST_TOKEN"],
          message:
            "UPSTASH_REDIS_REST_TOKEN is required when RATE_LIMIT_STORE is \"redis\".",
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Environment validation failed.\n${issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

function normalizeInngestBaseUrl(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function parseServerEnv(
  source: NodeJS.ProcessEnv = process.env,
): ServerEnv {
  const parsed = serverEnvSchema.safeParse({
    ...source,
    INNGEST_BASE_URL: normalizeInngestBaseUrl(source.INNGEST_BASE_URL),
  });

  if (!parsed.success) {
    throw new EnvValidationError(formatIssues(parsed.error));
  }

  return parsed.data;
}

let cachedServerEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) {
    return cachedServerEnv;
  }

  cachedServerEnv = parseServerEnv(process.env);
  return cachedServerEnv;
}
