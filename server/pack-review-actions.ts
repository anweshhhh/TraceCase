"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  SavePackReviewState,
  ValidatePackJsonResult,
} from "@/lib/packs/pack-review-state";
import { can, getActiveWorkspaceContext, getAuthContext } from "@/server/authz";
import {
  approvePack,
  PackLockedError,
  PackNotFoundError,
  PackTransitionError,
  rejectPack,
  updatePackContent,
} from "@/server/packs/packsRepo";
import type { PackContentInput } from "@/server/packs/packSchema";
import { PackValidationError, validatePackContent } from "@/server/packs/validatePack";

const MAX_SAFE_ERROR_LENGTH = 800;

function getSaveErrorState(
  error: string,
  issues: string[] = [],
): SavePackReviewState {
  return {
    ok: false,
    error,
    issues,
  };
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const cause =
      typeof error.cause === "string"
        ? error.cause
        : error.cause instanceof Error
          ? error.cause.message
          : null;
    const message = [error.message, cause].filter(Boolean).join(" | ");

    return message.slice(0, MAX_SAFE_ERROR_LENGTH);
  }

  return "Unknown error".slice(0, MAX_SAFE_ERROR_LENGTH);
}

function toSafeActionError(error: unknown) {
  return toSafeErrorMessage(error).slice(0, 140);
}

async function requirePackEditor() {
  const { clerkUserId } = await getAuthContext();
  const workspaceContext = await getActiveWorkspaceContext(clerkUserId);

  if (!can(workspaceContext.membership.role, "pack:edit")) {
    redirect("/forbidden");
  }

  return { clerkUserId, ...workspaceContext };
}

async function requirePackApprover() {
  const { clerkUserId } = await getAuthContext();
  const workspaceContext = await getActiveWorkspaceContext(clerkUserId);

  if (!can(workspaceContext.membership.role, "pack:approve")) {
    redirect("/forbidden");
  }

  return { clerkUserId, ...workspaceContext };
}

function parsePackJson(rawJson: string) {
  try {
    return {
      ok: true as const,
      value: JSON.parse(rawJson) as unknown,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: `Invalid JSON: ${toSafeErrorMessage(error)}`,
    };
  }
}

export async function validatePackJsonAction(
  _packId: string,
  rawJson: string,
): Promise<ValidatePackJsonResult> {
  await requirePackEditor();

  const parsedJson = parsePackJson(rawJson);
  if (!parsedJson.ok) {
    return {
      ok: false,
      error: parsedJson.error,
      issues: [],
    };
  }

  try {
    const canonical = validatePackContent(
      parsedJson.value as PackContentInput,
    ).value;

    return {
      ok: true,
      canonicalJson: JSON.stringify(canonical, null, 2),
      message: "Pack JSON is valid.",
    };
  } catch (error) {
    if (error instanceof PackValidationError) {
      return {
        ok: false,
        error: "Pack validation failed.",
        issues: error.issues,
      };
    }

    return {
      ok: false,
      error: toSafeErrorMessage(error),
      issues: [],
    };
  }
}

export async function savePackReviewAction(
  packId: string,
  _prevState: SavePackReviewState,
  formData: FormData,
): Promise<SavePackReviewState> {
  const rawJsonValue = formData.get("content_json");
  if (typeof rawJsonValue !== "string" || rawJsonValue.trim().length === 0) {
    return getSaveErrorState("Pack JSON is required.");
  }

  const { clerkUserId, workspace } = await requirePackEditor();
  const parsedJson = parsePackJson(rawJsonValue);

  if (!parsedJson.ok) {
    return getSaveErrorState(parsedJson.error);
  }

  try {
    await updatePackContent(workspace.id, clerkUserId, packId, parsedJson.value);
  } catch (error) {
    if (error instanceof PackValidationError) {
      return getSaveErrorState("Pack validation failed.", error.issues);
    }

    if (error instanceof PackNotFoundError) {
      return getSaveErrorState("Pack not found in the active workspace.");
    }

    if (error instanceof PackLockedError) {
      return getSaveErrorState("Pack is approved and locked. Editing is disabled.");
    }

    return getSaveErrorState(toSafeErrorMessage(error));
  }

  revalidatePath(`/dashboard/packs/${packId}`);
  revalidatePath(`/dashboard/packs/${packId}/review`);
  redirect(`/dashboard/packs/${packId}/review?saved=1`);

  return {
    ok: true,
    error: null,
    issues: [],
  };
}

export async function approvePackAction(packId: string) {
  const { clerkUserId, workspace } = await requirePackApprover();

  try {
    await approvePack(workspace.id, clerkUserId, packId);
  } catch (error) {
    if (error instanceof PackNotFoundError) {
      redirect(`/dashboard/packs/${packId}/review?action_error=pack-not-found`);
    }

    if (error instanceof PackTransitionError) {
      redirect(
        `/dashboard/packs/${packId}/review?action_error=${encodeURIComponent(
          toSafeActionError(error),
        )}`,
      );
    }

    redirect(
      `/dashboard/packs/${packId}/review?action_error=${encodeURIComponent(
        toSafeActionError(error),
      )}`,
    );
  }

  revalidatePath(`/dashboard/packs/${packId}`);
  revalidatePath(`/dashboard/packs/${packId}/review`);
  redirect(`/dashboard/packs/${packId}/review?approved=1`);
}

export async function rejectPackAction(packId: string, formData: FormData) {
  const { clerkUserId, workspace } = await requirePackApprover();
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue : undefined;

  try {
    await rejectPack(workspace.id, clerkUserId, packId, reason);
  } catch (error) {
    if (error instanceof PackNotFoundError) {
      redirect(`/dashboard/packs/${packId}/review?action_error=pack-not-found`);
    }

    if (error instanceof PackTransitionError) {
      redirect(
        `/dashboard/packs/${packId}/review?action_error=${encodeURIComponent(
          toSafeActionError(error),
        )}`,
      );
    }

    redirect(
      `/dashboard/packs/${packId}/review?action_error=${encodeURIComponent(
        toSafeActionError(error),
      )}`,
    );
  }

  revalidatePath(`/dashboard/packs/${packId}`);
  revalidatePath(`/dashboard/packs/${packId}/review`);
  redirect(`/dashboard/packs/${packId}/review?rejected=1`);
}
