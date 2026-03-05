import "server-only";
import { db } from "@/lib/db";
import { GENERATE_PACK_JOB_TYPE } from "@/server/packs/constants";

export async function listRecentGeneratePackJobsForRequirement(
  workspaceId: string,
  requirementId: string,
  limit = 5,
) {
  const snapshots = await db.requirementSnapshot.findMany({
    where: {
      workspace_id: workspaceId,
      requirement_id: requirementId,
    },
    select: {
      id: true,
    },
  });

  const snapshotIds = snapshots.map((snapshot) => snapshot.id);

  if (snapshotIds.length === 0) {
    return [];
  }

  return db.job.findMany({
    where: {
      workspace_id: workspaceId,
      type: GENERATE_PACK_JOB_TYPE,
      input_requirement_snapshot_id: {
        in: snapshotIds,
      },
    },
    orderBy: {
      created_at: "desc",
    },
    take: limit,
  });
}

export async function getPackById(workspaceId: string, packId: string) {
  return db.pack.findFirst({
    where: {
      id: packId,
      workspace_id: workspaceId,
    },
  });
}
