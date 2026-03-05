import assert from "node:assert/strict";
import test from "node:test";
import { PackStatus } from "@prisma/client";
import {
  assertPackEditable,
  buildApproveTransitionUpdate,
  PackLockedError,
} from "@/server/packs/transitions";

test("assertPackEditable rejects APPROVED packs", () => {
  assert.throws(
    () => assertPackEditable(PackStatus.APPROVED),
    (error) => error instanceof PackLockedError,
  );
});

test("buildApproveTransitionUpdate produces APPROVED metadata", () => {
  const now = new Date("2026-03-05T12:00:00.000Z");
  const update = buildApproveTransitionUpdate(
    PackStatus.NEEDS_REVIEW,
    "user_123",
    now,
  );

  assert.equal(update.status, PackStatus.APPROVED);
  assert.equal(update.approved_by_clerk_user_id, "user_123");
  assert.equal(update.approved_at.toISOString(), now.toISOString());
});
