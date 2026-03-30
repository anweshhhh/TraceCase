import "server-only";
import { RequirementStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { hashSourceText, normalizeSourceText } from "@/lib/sourceText";
import {
  requirementListFilterSchema,
  requirementPayloadSchema,
  requirementStatusSchema,
  type RequirementPayload,
  type RequirementStatusInput,
} from "@/lib/validators/requirements";
import { can, getActiveWorkspaceContext } from "@/server/authz";
import { logAuditEvent } from "@/server/audit";
import { logger } from "@/server/log";
import { RateLimitError, rateLimit } from "@/server/rateLimit";
import { getRequestIdFromHeaders } from "@/server/requestId";

export class RequirementNotFoundError extends Error {
  constructor() {
    super("Requirement not found.");
    this.name = "RequirementNotFoundError";
  }
}

export class RequirementPermissionError extends Error {
  constructor() {
    super("You do not have permission to modify requirements.");
    this.name = "RequirementPermissionError";
  }
}

async function assertRequirementEditPermission(
  workspaceId: string,
  actorId: string,
) {
  const { workspace, membership } = await getActiveWorkspaceContext(actorId);

  if (workspace.id !== workspaceId) {
    throw new RequirementPermissionError();
  }

  if (!can(membership.role, "requirement:edit")) {
    throw new RequirementPermissionError();
  }
}

async function enforceRequirementWriteRateLimit(
  workspaceId: string,
  actorId: string,
  operation: "create" | "update" | "archive",
) {
  const requestId = await getRequestIdFromHeaders();

  try {
    await rateLimit({
      key: `rl:req_write:${workspaceId}:${actorId}:${operation}`,
      limit: 30,
      windowSeconds: 60,
      requestId,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      logger.warn("rate_limited", {
        request_id: requestId,
        workspace_id: workspaceId,
        actor_clerk_user_id: actorId,
        action: "rate_limited",
        metadata: {
          key: `rl:req_write:${workspaceId}:${actorId}:${operation}`,
          limit: 30,
          window_seconds: 60,
          retry_after_seconds: error.retryAfterSeconds,
        },
      });
    }

    throw error;
  }
}

export async function listRequirements(
  workspaceId: string,
  filters?: { status?: RequirementStatus },
) {
  const parsedFilters = requirementListFilterSchema.parse(filters ?? {});

  return db.requirement.findMany({
    where: {
      workspace_id: workspaceId,
      ...(parsedFilters.status ? { status: parsedFilters.status } : {}),
    },
    orderBy: {
      updated_at: "desc",
    },
  });
}

export async function createRequirement(
  workspaceId: string,
  actorId: string,
  payload: RequirementPayload,
) {
  await enforceRequirementWriteRateLimit(workspaceId, actorId, "create");
  await assertRequirementEditPermission(workspaceId, actorId);
  const parsedPayload = requirementPayloadSchema.parse(payload);
  const normalizedSourceText = normalizeSourceText(parsedPayload.source_text);
  const sourceHash = hashSourceText(normalizedSourceText);

  const requirement = await db.$transaction(async (tx) => {
    const createdRequirement = await tx.requirement.create({
      data: {
        workspace_id: workspaceId,
        title: parsedPayload.title,
        module_type: parsedPayload.module_type,
        test_focus: parsedPayload.test_focus,
        source_text: normalizedSourceText,
        created_by_clerk_user_id: actorId,
      },
    });

    await tx.requirementSnapshot.create({
      data: {
        workspace_id: workspaceId,
        requirement_id: createdRequirement.id,
        version: 1,
        source_text: normalizedSourceText,
        source_hash: sourceHash,
        created_by_clerk_user_id: actorId,
      },
    });

    await logAuditEvent({
      workspaceId,
      actorClerkUserId: actorId,
      action: "requirement.created",
      entityType: "requirement",
      entityId: createdRequirement.id,
      metadata: {
        title: createdRequirement.title,
        module_type: createdRequirement.module_type,
        status: createdRequirement.status,
      },
      client: tx,
    });

    await logAuditEvent({
      workspaceId,
      actorClerkUserId: actorId,
      action: "requirement.snapshot_created",
      entityType: "requirement",
      entityId: createdRequirement.id,
      metadata: {
        requirement_id: createdRequirement.id,
        version: 1,
        source_hash: sourceHash,
      },
      client: tx,
    });

    return createdRequirement;
  });

  return requirement;
}

export async function getRequirement(workspaceId: string, requirementId: string) {
  return db.requirement.findFirst({
    where: {
      id: requirementId,
      workspace_id: workspaceId,
    },
  });
}

export async function updateRequirement(
  workspaceId: string,
  actorId: string,
  requirementId: string,
  payload: RequirementPayload,
) {
  await enforceRequirementWriteRateLimit(workspaceId, actorId, "update");
  await assertRequirementEditPermission(workspaceId, actorId);
  const parsedPayload = requirementPayloadSchema.parse(payload);
  const normalizedSourceText = normalizeSourceText(parsedPayload.source_text);

  const requirement = await db.$transaction(async (tx) => {
    const existing = await tx.requirement.findFirst({
      where: {
        id: requirementId,
        workspace_id: workspaceId,
      },
    });

    if (!existing) {
      throw new RequirementNotFoundError();
    }

    const latestSnapshot = await tx.requirementSnapshot.findFirst({
      where: {
        workspace_id: workspaceId,
        requirement_id: requirementId,
      },
      orderBy: {
        version: "desc",
      },
    });

    const updated = await tx.requirement.update({
      where: { id: requirementId },
      data: {
        title: parsedPayload.title,
        module_type: parsedPayload.module_type,
        test_focus: parsedPayload.test_focus,
        source_text: normalizedSourceText,
      },
    });

    const changedFields = {
      title: existing.title !== updated.title,
      module_type: existing.module_type !== updated.module_type,
      test_focus:
        JSON.stringify(existing.test_focus) !== JSON.stringify(updated.test_focus),
      source_text: existing.source_text !== updated.source_text,
    };

    if (changedFields.source_text) {
      const sourceHash = hashSourceText(normalizedSourceText);
      const shouldCreateSnapshot = !latestSnapshot || latestSnapshot.source_hash !== sourceHash;

      if (shouldCreateSnapshot) {
        const nextVersion = latestSnapshot ? latestSnapshot.version + 1 : 1;

        await tx.requirementSnapshot.create({
          data: {
            workspace_id: workspaceId,
            requirement_id: requirementId,
            version: nextVersion,
            source_text: normalizedSourceText,
            source_hash: sourceHash,
            created_by_clerk_user_id: actorId,
          },
        });

        await logAuditEvent({
          workspaceId,
          actorClerkUserId: actorId,
          action: "requirement.snapshot_created",
          entityType: "requirement",
          entityId: requirementId,
          metadata: {
            requirement_id: requirementId,
            version: nextVersion,
            source_hash: sourceHash,
          },
          client: tx,
        });
      }
    }

    await logAuditEvent({
      workspaceId,
      actorClerkUserId: actorId,
      action: "requirement.updated",
      entityType: "requirement",
      entityId: updated.id,
      metadata: {
        changed_fields: Object.entries(changedFields)
          .filter(([, isChanged]) => isChanged)
          .map(([field]) => field),
      },
      client: tx,
    });

    return updated;
  });

  return requirement;
}

export async function setRequirementStatus(
  workspaceId: string,
  actorId: string,
  requirementId: string,
  status: RequirementStatusInput,
) {
  await enforceRequirementWriteRateLimit(workspaceId, actorId, "archive");
  await assertRequirementEditPermission(workspaceId, actorId);
  const parsedStatus = requirementStatusSchema.parse(status);

  const requirement = await db.$transaction(async (tx) => {
    const existing = await tx.requirement.findFirst({
      where: {
        id: requirementId,
        workspace_id: workspaceId,
      },
    });

    if (!existing) {
      throw new RequirementNotFoundError();
    }

    const updated = await tx.requirement.update({
      where: { id: requirementId },
      data: {
        status: parsedStatus,
      },
    });

    await logAuditEvent({
      workspaceId,
      actorClerkUserId: actorId,
      action:
        parsedStatus === RequirementStatus.ARCHIVED
          ? "requirement.archived"
          : "requirement.unarchived",
      entityType: "requirement",
      entityId: updated.id,
      metadata: {
        from: existing.status,
        to: updated.status,
      },
      client: tx,
    });

    return updated;
  });

  return requirement;
}

export async function listRequirementSnapshots(
  workspaceId: string,
  requirementId: string,
) {
  return db.requirementSnapshot.findMany({
    where: {
      workspace_id: workspaceId,
      requirement_id: requirementId,
    },
    orderBy: {
      version: "desc",
    },
  });
}
