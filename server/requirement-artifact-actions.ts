"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, getActiveWorkspaceContext, getAuthContext } from "@/server/authz";
import { logger } from "@/server/log";
import { getRequestIdFromHeaders } from "@/server/requestId";
import type { RequirementArtifactPayload } from "@/lib/validators/requirementArtifacts";
import {
  createRequirementArtifact,
  deleteRequirementArtifact,
  RequirementArtifactNotFoundError,
  RequirementArtifactPermissionError,
  RequirementArtifactSnapshotNotFoundError,
  updateRequirementArtifact,
} from "@/server/requirementArtifacts";

async function requireRequirementArtifactEditor() {
  const { clerkUserId } = await getAuthContext();
  const workspaceContext = await getActiveWorkspaceContext(clerkUserId);

  if (!can(workspaceContext.membership.role, "requirement:edit")) {
    redirect("/forbidden");
  }

  return { clerkUserId, ...workspaceContext };
}

function getRequestScopedMessage(message: string, requestId: string) {
  return `${message} (request_id: ${requestId})`;
}

export async function createRequirementArtifactAction(
  snapshotId: string,
  payload: RequirementArtifactPayload,
) {
  const requestId = await getRequestIdFromHeaders();
  const { clerkUserId, workspace } = await requireRequirementArtifactEditor();

  try {
    const result = await createRequirementArtifact(
      workspace.id,
      clerkUserId,
      snapshotId,
      payload,
    );

    revalidatePath(`/dashboard/requirements/${result.requirementId}`);

    return { id: result.artifact.id };
  } catch (error) {
    if (error instanceof RequirementArtifactPermissionError) {
      redirect("/forbidden");
    }

    if (error instanceof RequirementArtifactSnapshotNotFoundError) {
      throw new Error(getRequestScopedMessage("Requirement snapshot not found.", requestId));
    }

    logger.error("requirement_artifact.create_failed", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "RequirementSnapshot",
      entity_id: snapshotId,
      action: "requirement_artifact.create_failed",
    });

    throw new Error(getRequestScopedMessage("Unable to create artifact.", requestId));
  }
}

export async function updateRequirementArtifactAction(
  artifactId: string,
  payload: RequirementArtifactPayload,
) {
  const requestId = await getRequestIdFromHeaders();
  const { clerkUserId, workspace } = await requireRequirementArtifactEditor();

  try {
    const result = await updateRequirementArtifact(
      workspace.id,
      clerkUserId,
      artifactId,
      payload,
    );

    revalidatePath(`/dashboard/requirements/${result.requirementId}`);

    return { id: result.artifact.id };
  } catch (error) {
    if (error instanceof RequirementArtifactPermissionError) {
      redirect("/forbidden");
    }

    if (error instanceof RequirementArtifactNotFoundError) {
      throw new Error(getRequestScopedMessage("Requirement artifact not found.", requestId));
    }

    logger.error("requirement_artifact.update_failed", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "RequirementArtifact",
      entity_id: artifactId,
      action: "requirement_artifact.update_failed",
    });

    throw new Error(getRequestScopedMessage("Unable to update artifact.", requestId));
  }
}

export async function deleteRequirementArtifactAction(artifactId: string) {
  const requestId = await getRequestIdFromHeaders();
  const { clerkUserId, workspace } = await requireRequirementArtifactEditor();

  try {
    const result = await deleteRequirementArtifact(
      workspace.id,
      clerkUserId,
      artifactId,
    );

    revalidatePath(`/dashboard/requirements/${result.requirementId}`);

    return { ok: true as const };
  } catch (error) {
    if (error instanceof RequirementArtifactPermissionError) {
      redirect("/forbidden");
    }

    if (error instanceof RequirementArtifactNotFoundError) {
      throw new Error(getRequestScopedMessage("Requirement artifact not found.", requestId));
    }

    logger.error("requirement_artifact.delete_failed", {
      request_id: requestId,
      workspace_id: workspace.id,
      actor_clerk_user_id: clerkUserId,
      entity_type: "RequirementArtifact",
      entity_id: artifactId,
      action: "requirement_artifact.delete_failed",
    });

    throw new Error(getRequestScopedMessage("Unable to delete artifact.", requestId));
  }
}
