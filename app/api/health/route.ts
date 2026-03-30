import packageJson from "@/package.json";
import { buildHealthResult } from "@/server/health";

export const runtime = "nodejs";

function getCommitSha() {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null;
}

export async function GET() {
  const result = await buildHealthResult({
    version: packageJson.version,
    commitSha: getCommitSha(),
  });

  return Response.json(result.body, {
    status: result.statusCode,
  });
}
