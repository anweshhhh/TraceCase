import "server-only";
import { type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/server/audit";
import type { PackContentInput } from "@/server/packs/packSchema";
import {
  assertPackEditable,
  buildApproveTransitionUpdate,
  buildRejectTransitionUpdate,
  PackLockedError,
  PackTransitionError,
  sanitizeRejectionReason,
} from "@/server/packs/transitions";
import { validatePackContent } from "@/server/packs/validatePack";

export class PackNotFoundError extends Error {
  constructor() {
    super("Pack not found.");
    this.name = "PackNotFoundError";
  }
}

export { PackLockedError, PackTransitionError };

export async function getPack(workspaceId: string, packId: string) {
  return db.pack.findFirst({
    where: {
      id: packId,
      workspace_id: workspaceId,
    },
    include: {
      requirement_snapshot: {
        select: {
          id: true,
          version: true,
          source_hash: true,
          source_text: true,
          created_at: true,
        },
      },
    },
  });
}

export async function updatePackContent(
  workspaceId: string,
  actorId: string,
  packId: string,
  newContentJson: unknown,
) {
  const canonical = validatePackContent(newContentJson as PackContentInput).value;
  const canonicalJson = JSON.parse(
    JSON.stringify(canonical),
  ) as Prisma.InputJsonValue;

  return db.$transaction(async (tx) => {
    const existing = await tx.pack.findFirst({
      where: {
        id: packId,
        workspace_id: workspaceId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existing) {
      throw new PackNotFoundError();
    }

    assertPackEditable(existing.status);

    const updateResult = await tx.pack.updateMany({
      where: {
        id: packId,
        workspace_id: workspaceId,
      },
      data: {
        content_json: canonicalJson,
        schema_version: canonical.schema_version,
      },
    });

    if (updateResult.count !== 1) {
      throw new PackNotFoundError();
    }

    await logAuditEvent({
      workspaceId,
      actorClerkUserId: actorId,
      action: "pack.edited",
      entityType: "Pack",
      entityId: packId,
      metadata: {
        schema_version: canonical.schema_version,
      },
      client: tx,
    });

    return tx.pack.findFirst({
      where: {
        id: packId,
        workspace_id: workspaceId,
      },
      include: {
        requirement_snapshot: {
          select: {
            id: true,
            version: true,
            source_hash: true,
            source_text: true,
            created_at: true,
          },
        },
      },
    });
  });
}

export async function approvePack(
  workspaceId: string,
  actorId: string,
  packId: string,
) {
  const now = new Date();

  return db.$transaction(async (tx) => {
    const existing = await tx.pack.findFirst({
      where: {
        id: packId,
        workspace_id: workspaceId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existing) {
      throw new PackNotFoundError();
    }

    const approveUpdate = buildApproveTransitionUpdate(existing.status, actorId, now);

    const updateResult = await tx.pack.updateMany({
      where: {
        id: packId,
        workspace_id: workspaceId,
      },
      data: approveUpdate,
    });

    if (updateResult.count !== 1) {
      throw new PackTransitionError("Failed to approve pack.");
    }

    await logAuditEvent({
      workspaceId,
      actorClerkUserId: actorId,
      action: "pack.approved",
      entityType: "Pack",
      entityId: packId,
      metadata: {
        from_status: existing.status,
        to_status: approveUpdate.status,
      },
      client: tx,
    });

    return tx.pack.findFirst({
      where: {
        id: packId,
        workspace_id: workspaceId,
      },
      include: {
        requirement_snapshot: {
          select: {
            id: true,
            version: true,
            source_hash: true,
            source_text: true,
            created_at: true,
          },
        },
      },
    });
  });
}

export async function rejectPack(
  workspaceId: string,
  actorId: string,
  packId: string,
  reason?: string | null,
) {
  const safeReason = sanitizeRejectionReason(reason);

  return db.$transaction(async (tx) => {
    const existing = await tx.pack.findFirst({
      where: {
        id: packId,
        workspace_id: workspaceId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existing) {
      throw new PackNotFoundError();
    }

    const rejectUpdate = buildRejectTransitionUpdate(existing.status);

    if (rejectUpdate.noOp) {
      return tx.pack.findFirst({
        where: {
          id: packId,
          workspace_id: workspaceId,
        },
        include: {
          requirement_snapshot: {
            select: {
              id: true,
              version: true,
              source_hash: true,
              source_text: true,
              created_at: true,
            },
          },
        },
      });
    }

    const updateResult = await tx.pack.updateMany({
      where: {
        id: packId,
        workspace_id: workspaceId,
      },
      data: rejectUpdate.update,
    });

    if (updateResult.count !== 1) {
      throw new PackTransitionError("Failed to reject pack.");
    }

    await logAuditEvent({
      workspaceId,
      actorClerkUserId: actorId,
      action: "pack.rejected",
      entityType: "Pack",
      entityId: packId,
      metadata: {
        from_status: existing.status,
        to_status: rejectUpdate.update.status,
        ...(safeReason ? { reason: safeReason } : {}),
      },
      client: tx,
    });

    return tx.pack.findFirst({
      where: {
        id: packId,
        workspace_id: workspaceId,
      },
      include: {
        requirement_snapshot: {
          select: {
            id: true,
            version: true,
            source_hash: true,
            source_text: true,
            created_at: true,
          },
        },
      },
    });
  });
}
