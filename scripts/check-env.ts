import { config as loadEnv } from "dotenv";
import { accessSync } from "node:fs";
import { EnvValidationError, getServerEnv } from "@/server/env";

loadEnv({ path: ".env", quiet: true });

const appEnv = process.env.APP_ENV?.trim() || "local";
const secondaryEnvFile =
  appEnv === "staging"
    ? process.env.STAGING_ENV_FILE || ".env.staging.local"
    : process.env.LOCAL_ENV_FILE || ".env.local";

function ensureEnvFileExists(filePath: string) {
  try {
    accessSync(filePath);
  } catch {
    throw new EnvValidationError([
      `Staging environment file ${filePath} is missing. Run: cp .env.staging.example .env.staging.local`,
    ]);
  }
}

function validateStagingValues() {
  const env = process.env;
  const issues: string[] = [];
  const stagingPlaceholderPatterns = [/your_/i, /placeholder/i, /change[_-]?me/i];
  const valueHasPlaceholder = (value: string) =>
    stagingPlaceholderPatterns.some((pattern) => pattern.test(value));

  if (appEnv === "staging") {
    const dbUrl = env.DATABASE_URL;
    const clerkPublishable = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const clerkSecret = env.CLERK_SECRET_KEY;
    const eventKey = env.INNGEST_EVENT_KEY;
    const aiProvider = env.AI_PROVIDER?.trim() || "placeholder";
    const openAiApiKey = env.OPENAI_API_KEY;

    if (!dbUrl) {
      issues.push("DATABASE_URL is required for staging.");
    } else {
      try {
        const parsed = new URL(dbUrl);
        const username = parsed.username || "";
        const password = parsed.password || "";
        const hostname = parsed.hostname || "";
        if (
          username.toUpperCase() === "USER" ||
          password.toUpperCase() === "PASSWORD" ||
          hostname.toUpperCase() === "HOST" ||
          parsed.pathname.includes("TRACECASE_STAGING_DB")
        ) {
          issues.push(
            "DATABASE_URL looks like an unconfigured staging placeholder. Replace USER/PASSWORD/HOST/DB placeholder tokens with real values.",
          );
        }
      } catch {
        issues.push("DATABASE_URL is not a valid URL.");
      }
    }

    if (!clerkPublishable || valueHasPlaceholder(clerkPublishable)) {
      issues.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY appears to be a placeholder.");
    }

    if (!clerkSecret || valueHasPlaceholder(clerkSecret)) {
      issues.push("CLERK_SECRET_KEY appears to be a placeholder.");
    }

    if (
      env.INNGEST_DEV !== "1" &&
      (!eventKey || valueHasPlaceholder(eventKey))
    ) {
      issues.push(
        "INNGEST_EVENT_KEY appears to be a placeholder. Set a real staging event key or run with INNGEST_DEV=1.",
      );
    }

    if (aiProvider === "openai" && (!openAiApiKey || valueHasPlaceholder(openAiApiKey))) {
      issues.push(
        "OPENAI_API_KEY appears to be a placeholder when AI_PROVIDER=openai.",
      );
    }

    if (issues.length > 0) {
      throw new EnvValidationError(issues);
    }
  }
}

if (appEnv === "staging") {
  ensureEnvFileExists(secondaryEnvFile);
}

loadEnv({ path: secondaryEnvFile, override: true, quiet: true });

try {
  getServerEnv();
  validateStagingValues();
  console.log("Environment validation passed.");
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(1);
  }

  console.error("Unexpected error while validating environment variables.");
  process.exit(1);
}
