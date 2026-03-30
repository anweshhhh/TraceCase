import { ModuleType, PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { hashSourceText, normalizeSourceText } from "@/lib/sourceText";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });
loadEnv({ path: ".env.staging.local", override: true, quiet: true });

const db = new PrismaClient();

const SEED_WORKSPACE_NAME = "Demo Workspace";
const DEMO_ACTOR_ID = "seed-script";

const DEMO_REQUIREMENTS: {
  title: string;
  module_type: ModuleType;
  test_focus: string[];
  source_text: string;
}[] = [
  {
    title: "Valid login redirects to dashboard",
    module_type: ModuleType.LOGIN,
    test_focus: ["UI", "REGRESSION"],
    source_text:
      "When a user enters valid credentials on the login screen,\n" +
      "the app should authenticate and redirect to /dashboard.",
  },
  {
    title: "Signup flow stores user profile",
    module_type: ModuleType.SIGNUP,
    test_focus: ["API", "SQL"],
    source_text:
      "After signup, the API should create a user profile and return\n" +
      "the profile identifier for follow-up onboarding steps.",
  },
] as const;

async function ensureDemoWorkspace() {
  const existingWorkspace = await db.workspace.findFirst({
    where: {
      name: SEED_WORKSPACE_NAME,
      owner_clerk_user_id: null,
    },
  });

  if (existingWorkspace) {
    return existingWorkspace;
  }

  return db.workspace.create({
    data: {
      name: SEED_WORKSPACE_NAME,
      owner_clerk_user_id: null,
      clerk_org_id: null,
    },
  });
}

async function ensureDemoRequirement(
  workspaceId: string,
  input: (typeof DEMO_REQUIREMENTS)[number],
) {
  const existingRequirement = await db.requirement.findFirst({
    where: {
      workspace_id: workspaceId,
      title: input.title,
    },
  });

  if (existingRequirement) {
    return;
  }

  const normalizedSourceText = normalizeSourceText(input.source_text);
  const sourceHash = hashSourceText(normalizedSourceText);

  await db.$transaction(async (tx) => {
    const requirement = await tx.requirement.create({
      data: {
        workspace_id: workspaceId,
        title: input.title,
        module_type: input.module_type,
        test_focus: input.test_focus,
        source_text: normalizedSourceText,
        created_by_clerk_user_id: DEMO_ACTOR_ID,
      },
    });

    await tx.requirementSnapshot.create({
      data: {
        workspace_id: workspaceId,
        requirement_id: requirement.id,
        version: 1,
        source_text: normalizedSourceText,
        source_hash: sourceHash,
        created_by_clerk_user_id: DEMO_ACTOR_ID,
      },
    });
  });
}

async function main() {
  const workspace = await ensureDemoWorkspace();

  for (const requirement of DEMO_REQUIREMENTS) {
    await ensureDemoRequirement(workspace.id, requirement);
  }

  console.log(`Seed complete. workspace=${workspace.id}`);
}

main()
  .catch((error) => {
    console.error("Seed failed.", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
