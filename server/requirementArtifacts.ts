import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { RequirementArtifactPayload } from "@/lib/validators/requirementArtifacts";
import { can, getActiveWorkspaceContext } from "@/server/authz";
import { logAuditEvent } from "@/server/audit";
import { parseRequirementArtifactContent } from "@/server/artifactParsers";
import {
  RequirementArtifactPermissionError,
  createRequirementArtifactWithDeps,
  deleteRequirementArtifactWithDeps,
  listRequirementArtifactsWithDeps,
  type RequirementArtifactServiceDeps,
  updateRequirementArtifactWithDeps,
} from "@/server/requirementArtifactsCore";

export { prepareRequirementArtifactForWrite } from "@/lib/requirementArtifacts";
export {
  RequirementArtifactNotFoundError,
  RequirementArtifactPermissionError,
  RequirementArtifactSnapshotNotFoundError,
} from "@/server/requirementArtifactsCore";

async function assertRequirementArtifactEditPermission(
  workspaceId: string,
  actorId: string,
) {
  const { workspace, membership } = await getActiveWorkspaceContext(actorId);

  if (workspace.id !== workspaceId) {
    throw new RequirementArtifactPermissionError();
  }

  if (!can(membership.role, "requirement:edit")) {
    throw new RequirementArtifactPermissionError();
  }
}

type RequirementArtifactClient = typeof db | Prisma.TransactionClient;

function buildRequirementArtifactDeps(
  client: RequirementArtifactClient,
): RequirementArtifactServiceDeps {
  return {
    assertCanEdit: assertRequirementArtifactEditPermission,
    parseArtifact: ({ type, contentText }) =>
      parseRequirementArtifactContent({
        artifactType: type,
        contentText,
      }),
    listArtifacts: (workspaceId, snapshotId) =>
      client.requirementArtifact.findMany({
        where: {
          workspace_id: workspaceId,
          requirement_snapshot_id: snapshotId,
        },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      }),
    findSnapshot: (workspaceId, snapshotId) =>
      client.requirementSnapshot.findFirst({
        where: {
          id: snapshotId,
          workspace_id: workspaceId,
        },
        select: {
          id: true,
          requirement_id: true,
        },
      }),
    createArtifact: (data) =>
      client.requirementArtifact.create({
        data,
      }),
    findArtifact: (workspaceId, artifactId) =>
      client.requirementArtifact.findFirst({
        where: {
          id: artifactId,
          workspace_id: workspaceId,
        },
        select: {
          id: true,
          requirement_snapshot_id: true,
          type: true,
          title: true,
          content_hash: true,
          requirement_snapshot: {
            select: {
              requirement_id: true,
            },
          },
        },
      }),
    updateArtifact: (artifactId, data) =>
      client.requirementArtifact.update({
        where: {
          id: artifactId,
        },
        data,
      }),
    deleteArtifact: async (artifactId) => {
      await client.requirementArtifact.delete({
        where: {
          id: artifactId,
        },
      });
    },
    logAuditEvent: async (event) => {
      await logAuditEvent({
        workspaceId: event.workspaceId,
        actorClerkUserId: event.actorClerkUserId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: event.metadata,
        client,
      });
    },
  };
}

export async function listRequirementArtifacts(
  workspaceId: string,
  snapshotId: string,
) {
  return listRequirementArtifactsWithDeps(
    buildRequirementArtifactDeps(db),
    workspaceId,
    snapshotId,
  );
}

export async function createRequirementArtifact(
  workspaceId: string,
  actorId: string,
  snapshotId: string,
  payload: RequirementArtifactPayload,
) {
  return db.$transaction((tx) =>
    createRequirementArtifactWithDeps(
      buildRequirementArtifactDeps(tx),
      workspaceId,
      actorId,
      snapshotId,
      payload,
    ),
  );
}

export async function updateRequirementArtifact(
  workspaceId: string,
  actorId: string,
  artifactId: string,
  payload: RequirementArtifactPayload,
) {
  return db.$transaction((tx) =>
    updateRequirementArtifactWithDeps(
      buildRequirementArtifactDeps(tx),
      workspaceId,
      actorId,
      artifactId,
      payload,
    ),
  );
}

export async function deleteRequirementArtifact(
  workspaceId: string,
  actorId: string,
  artifactId: string,
) {
  return db.$transaction((tx) =>
    deleteRequirementArtifactWithDeps(
      buildRequirementArtifactDeps(tx),
      workspaceId,
      actorId,
      artifactId,
    ),
  );
}
