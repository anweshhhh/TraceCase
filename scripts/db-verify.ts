import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import process from "node:process";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });
loadEnv({ path: ".env.staging.local", override: true, quiet: true });

const db = new PrismaClient();

async function main() {
  const workspaceCount = await db.workspace.count();
  const requirementCount = await db.requirement.count();
  const snapshotCount = await db.requirementSnapshot.count();
  const packCount = await db.pack.count();
  const exportCount = await db.export.count();
  const jobCount = await db.job.count();

  console.log("DB verification passed.");
  console.log(`workspace_count=${workspaceCount}`);
  console.log(`requirement_count=${requirementCount}`);
  console.log(`snapshot_count=${snapshotCount}`);
  console.log(`pack_count=${packCount}`);
  console.log(`export_count=${exportCount}`);
  console.log(`job_count=${jobCount}`);
}

main()
  .catch((error) => {
    console.error("DB verification failed.");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
