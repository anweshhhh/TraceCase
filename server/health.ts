import { db } from "@/lib/db";
import { EnvValidationError, parseServerEnv, type ServerEnv } from "@/server/env";

type DbCheck = {
  status: "ok" | "fail";
  latency_ms?: number;
  error?: string;
};

type EnvCheck = {
  status: "ok" | "fail";
  error?: string;
};

type InngestCheck = {
  status: "ok" | "skip" | "fail";
  note?: string;
};

type ClerkCheck = {
  status: "ok" | "fail";
  note?: string;
};

type OpenAiCheck = {
  status: "ok" | "skip" | "fail";
  note?: string;
};

export type HealthBody = {
  status: "ok" | "degraded";
  timestamp: string;
  version: string;
  commit_sha: string | null;
  checks: {
    db: DbCheck;
    env: EnvCheck;
    inngest: InngestCheck;
    clerk: ClerkCheck;
    openai: OpenAiCheck;
  };
};

export type HealthResult = {
  statusCode: 200 | 503;
  body: HealthBody;
};

type BuildHealthOptions = {
  now?: Date;
  version: string;
  commitSha: string | null;
  envSource?: NodeJS.ProcessEnv;
  dbCheck?: () => Promise<DbCheck>;
};

function toSafeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.slice(0, 180);
}

function getInngestCheck(env: ServerEnv | null, source: NodeJS.ProcessEnv): InngestCheck {
  const isDev = (env?.INNGEST_DEV ?? source.INNGEST_DEV) === "1";
  const hasEventKey = Boolean((env?.INNGEST_EVENT_KEY ?? source.INNGEST_EVENT_KEY)?.trim());

  if (isDev) {
    return {
      status: "skip",
      note: "INNGEST_DEV=1, event key is not required for local development.",
    };
  }

  if (hasEventKey) {
    return {
      status: "ok",
      note: "Inngest event dispatch key is configured.",
    };
  }

  return {
    status: "fail",
    note: "INNGEST_EVENT_KEY is missing while INNGEST_DEV is not enabled.",
  };
}

function getClerkCheck(env: ServerEnv | null, source: NodeJS.ProcessEnv): ClerkCheck {
  const hasPublishable = Boolean(
    (env?.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
      source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)?.trim(),
  );
  const hasSecret = Boolean((env?.CLERK_SECRET_KEY ?? source.CLERK_SECRET_KEY)?.trim());

  if (hasPublishable && hasSecret) {
    return {
      status: "ok",
      note: "Clerk keys are configured.",
    };
  }

  return {
    status: "fail",
    note: "Missing Clerk publishable key and/or secret key.",
  };
}

function getOpenAiCheck(
  env: ServerEnv | null,
  source: NodeJS.ProcessEnv,
): OpenAiCheck {
  const provider = env?.AI_PROVIDER ?? source.AI_PROVIDER?.trim() ?? "placeholder";

  if (provider !== "openai") {
    return {
      status: "skip",
      note: "AI_PROVIDER is placeholder; OpenAI generation is disabled.",
    };
  }

  if (!env) {
    if (!(source.OPENAI_API_KEY ?? "").trim()) {
      return {
        status: "fail",
        note: "AI_PROVIDER=openai but OPENAI_API_KEY is missing.",
      };
    }

    return {
      status: "fail",
      note: "OpenAI is selected, but environment validation did not pass.",
    };
  }

  return {
    status: "ok",
    note: `OpenAI server-side generation is configured for ${env.OPENAI_MODEL}.`,
  };
}

export async function checkDatabaseHealth(): Promise<DbCheck> {
  const startedAt = Date.now();

  try {
    await db.$queryRaw`SELECT 1`;

    return {
      status: "ok",
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "fail",
      error: toSafeErrorMessage(error),
    };
  }
}

export async function buildHealthResult(
  options: BuildHealthOptions,
): Promise<HealthResult> {
  const now = options.now ?? new Date();
  const envSource = options.envSource ?? process.env;
  let parsedEnv: ServerEnv | null = null;

  const envCheck: EnvCheck = (() => {
    try {
      parsedEnv = parseServerEnv(envSource);
      return { status: "ok" };
    } catch (error) {
      if (error instanceof EnvValidationError) {
        return {
          status: "fail",
          error: error.issues.join("; ").slice(0, 300),
        };
      }

      return {
        status: "fail",
        error: "Unexpected environment validation error.",
      };
    }
  })();

  const dbCheck =
    envCheck.status === "ok"
      ? await (options.dbCheck ?? checkDatabaseHealth)()
      : {
          status: "fail" as const,
          error: "Skipped due invalid environment configuration.",
        };

  const inngestCheck = getInngestCheck(parsedEnv, envSource);
  const clerkCheck = getClerkCheck(parsedEnv, envSource);
  const openAiCheck = getOpenAiCheck(parsedEnv, envSource);
  const status =
    envCheck.status === "ok" && dbCheck.status === "ok" ? "ok" : "degraded";

  return {
    statusCode: status === "ok" ? 200 : 503,
    body: {
      status,
      timestamp: now.toISOString(),
      version: options.version,
      commit_sha: options.commitSha,
      checks: {
        db: dbCheck,
        env: envCheck,
        inngest: inngestCheck,
        clerk: clerkCheck,
        openai: openAiCheck,
      },
    },
  };
}
