import "server-only";
import { db } from "@/lib/db";

export type ListAuditEventsFilters = {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorClerkUserId?: string;
  limit?: number;
};

function normalizeString(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toSafeLimit(limit?: number) {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Number(limit), 1), 200);
}

export async function listAuditEvents(
  workspaceId: string,
  filters: ListAuditEventsFilters = {},
) {
  const action = normalizeString(filters.action);
  const entityType = normalizeString(filters.entityType);
  const entityId = normalizeString(filters.entityId);
  const actorClerkUserId = normalizeString(filters.actorClerkUserId);
  const limit = toSafeLimit(filters.limit);

  return db.auditEvent.findMany({
    where: {
      workspace_id: workspaceId,
      ...(action ? { action } : {}),
      ...(entityType ? { entity_type: entityType } : {}),
      ...(entityId ? { entity_id: entityId } : {}),
      ...(actorClerkUserId ? { actor_clerk_user_id: actorClerkUserId } : {}),
    },
    select: {
      id: true,
      created_at: true,
      actor_clerk_user_id: true,
      action: true,
      entity_type: true,
      entity_id: true,
      metadata_json: true,
    },
    orderBy: {
      created_at: "desc",
    },
    take: limit,
  });
}
