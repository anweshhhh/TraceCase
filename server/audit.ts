import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

type AuditClient = Prisma.TransactionClient | PrismaClient;

type LogAuditEventParams = {
  workspaceId: string;
  actorClerkUserId: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  client?: AuditClient;
};

export async function logAuditEvent({
  workspaceId,
  actorClerkUserId,
  action,
  entityType,
  entityId,
  metadata,
  client,
}: LogAuditEventParams) {
  const prisma = client ?? db;

  return prisma.auditEvent.create({
    data: {
      workspace_id: workspaceId,
      actor_clerk_user_id: actorClerkUserId,
      action,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      metadata_json: metadata ?? undefined,
    },
  });
}
