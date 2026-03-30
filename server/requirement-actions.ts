"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RequirementStatus } from "@prisma/client";
import { can, getActiveWorkspaceContext, getAuthContext } from "@/server/authz";
import { toPublicError } from "@/server/errors";
import { logger } from "@/server/log";
import {
  createRequirement,
  RequirementNotFoundError,
  RequirementPermissionError,
  setRequirementStatus,
  updateRequirement,
} from "@/server/requirements";
import { RateLimitError } from "@/server/rateLimit";
import { getRequestIdFromHeaders } from "@/server/requestId";
import type { RequirementPayload } from "@/lib/validators/requirements";

async function requireRequirementEditor() {
  const { clerkUserId } = await getAuthContext();
  const workspaceContext = await getActiveWorkspaceContext(clerkUserId);

  if (!can(workspaceContext.membership.role, "requirement:edit")) {
    redirect("/forbidden");
  }

  return { clerkUserId, ...workspaceContext };
}

export async function createRequirementAction(payload: RequirementPayload) {
  const requestId = await getRequestIdFromHeaders();
  const { clerkUserId, workspace } = await requireRequirementEditor();
  let requirement;
  try {
    requirement = await createRequirement(workspace.id, clerkUserId, payload);
  } catch (error) {
    if (error instanceof RateLimitError) {
      const publicError = toPublicError(error, requestId);
      throw new Error(`${publicError.message} (request_id: ${publicError.request_id})`);
    }

    logger.error("requirement.create_failed", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      action: "requirement.create_failed",
    });
    throw new Error(`Unable to create requirement. (request_id: ${requestId})`);
  }

  revalidatePath("/dashboard/requirements");
  revalidatePath(`/dashboard/requirements/${requirement.id}`);

  return { id: requirement.id };
}

export async function updateRequirementAction(
  requirementId: string,
  payload: RequirementPayload,
) {
  const requestId = await getRequestIdFromHeaders();
  const { clerkUserId, workspace } = await requireRequirementEditor();

  try {
    const requirement = await updateRequirement(
      workspace.id,
      clerkUserId,
      requirementId,
      payload,
    );

    revalidatePath("/dashboard/requirements");
    revalidatePath(`/dashboard/requirements/${requirement.id}`);

    return { id: requirement.id, notFound: false as const };
  } catch (error) {
    if (error instanceof RequirementNotFoundError) {
      return { id: requirementId, notFound: true as const };
    }

    if (error instanceof RequirementPermissionError) {
      redirect("/forbidden");
    }

    if (error instanceof RateLimitError) {
      const publicError = toPublicError(error, requestId);
      throw new Error(`${publicError.message} (request_id: ${publicError.request_id})`);
    }

    logger.error("requirement.update_failed", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "Requirement",
      entity_id: requirementId,
      action: "requirement.update_failed",
    });
    throw new Error(`Unable to update requirement. (request_id: ${requestId})`);
  }
}

export async function setRequirementStatusAction(
  requirementId: string,
  status: RequirementStatus,
) {
  const requestId = await getRequestIdFromHeaders();
  const { clerkUserId, workspace } = await requireRequirementEditor();

  try {
    const requirement = await setRequirementStatus(
      workspace.id,
      clerkUserId,
      requirementId,
      status,
    );

    revalidatePath("/dashboard/requirements");
    revalidatePath(`/dashboard/requirements/${requirement.id}`);

    return { id: requirement.id, notFound: false as const };
  } catch (error) {
    if (error instanceof RequirementNotFoundError) {
      return { id: requirementId, notFound: true as const };
    }

    if (error instanceof RequirementPermissionError) {
      redirect("/forbidden");
    }

    if (error instanceof RateLimitError) {
      const publicError = toPublicError(error, requestId);
      throw new Error(`${publicError.message} (request_id: ${publicError.request_id})`);
    }

    logger.error("requirement.status_failed", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "Requirement",
      entity_id: requirementId,
      action: "requirement.status_failed",
    });
    throw new Error(`Unable to change requirement status. (request_id: ${requestId})`);
  }
}
