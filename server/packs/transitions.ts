import { PackStatus } from "@prisma/client";

export class PackLockedError extends Error {
  constructor(message = "Approved packs are locked and cannot be edited.") {
    super(message);
    this.name = "PackLockedError";
  }
}

export class PackTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackTransitionError";
  }
}

export function assertPackEditable(status: PackStatus) {
  if (status === PackStatus.APPROVED) {
    throw new PackLockedError();
  }
}

export function buildApproveTransitionUpdate(
  status: PackStatus,
  actorClerkUserId: string,
  now: Date,
) {
  if (status !== PackStatus.NEEDS_REVIEW && status !== PackStatus.REJECTED) {
    if (status === PackStatus.APPROVED) {
      throw new PackTransitionError("Pack is already approved.");
    }

    throw new PackTransitionError("Pack cannot be approved from its current status.");
  }

  return {
    status: PackStatus.APPROVED,
    approved_by_clerk_user_id: actorClerkUserId,
    approved_at: now,
  };
}

export function buildRejectTransitionUpdate(status: PackStatus) {
  if (status === PackStatus.REJECTED) {
    return {
      noOp: true as const,
    };
  }

  if (status === PackStatus.APPROVED) {
    throw new PackTransitionError("Approved packs are locked and cannot be rejected.");
  }

  if (status !== PackStatus.NEEDS_REVIEW) {
    throw new PackTransitionError("Pack cannot be rejected from its current status.");
  }

  return {
    noOp: false as const,
    update: {
      status: PackStatus.REJECTED,
      approved_by_clerk_user_id: null,
      approved_at: null,
    },
  };
}

export function sanitizeRejectionReason(reason?: string | null) {
  if (!reason) {
    return null;
  }

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, 500);
}
