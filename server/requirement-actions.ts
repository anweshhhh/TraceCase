"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RequirementStatus } from "@prisma/client";
import { can, getActiveWorkspaceContext, getAuthContext } from "@/server/authz";
import {
  createRequirement,
  RequirementNotFoundError,
  RequirementPermissionError,
  setRequirementStatus,
  updateRequirement,
} from "@/server/requirements";
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
  const { clerkUserId, workspace } = await requireRequirementEditor();

  const requirement = await createRequirement(workspace.id, clerkUserId, payload);

  revalidatePath("/dashboard/requirements");
  revalidatePath(`/dashboard/requirements/${requirement.id}`);

  return { id: requirement.id };
}

export async function updateRequirementAction(
  requirementId: string,
  payload: RequirementPayload,
) {
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

    throw error;
  }
}

export async function setRequirementStatusAction(
  requirementId: string,
  status: RequirementStatus,
) {
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

    throw error;
  }
}
