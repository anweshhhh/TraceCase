import "server-only";
import { Role, type Membership, type Workspace } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getOrCreatePersonalWorkspace } from "@/lib/workspaces";

export type Permission =
  | "workspace:manage_members"
  | "pack:approve"
  | "pack:edit"
  | "requirement:edit"
  | "export:download"
  | "audit:view";

type WorkspaceContext = {
  workspace: Workspace;
  membership: Membership;
};

type AuthContext = {
  clerkUserId: string;
};

const ROLE_RANK: Record<Role, number> = {
  REVIEWER: 1,
  EDITOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

const PERMISSIONS: Record<Permission, Role[]> = {
  "workspace:manage_members": [Role.OWNER, Role.ADMIN],
  "pack:approve": [Role.OWNER, Role.ADMIN, Role.REVIEWER],
  "pack:edit": [Role.OWNER, Role.ADMIN, Role.EDITOR],
  "requirement:edit": [Role.OWNER, Role.ADMIN, Role.EDITOR],
  "export:download": [Role.OWNER, Role.ADMIN, Role.EDITOR, Role.REVIEWER],
  "audit:view": [Role.OWNER, Role.ADMIN, Role.REVIEWER],
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS[permission].includes(role);
}

export async function getAuthContext(): Promise<AuthContext> {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return { clerkUserId: userId };
}

export async function getActiveWorkspaceContext(
  clerkUserId: string,
): Promise<WorkspaceContext> {
  return getOrCreatePersonalWorkspace(clerkUserId);
}

export async function requireRoleAny(
  allowedRoles: Role[],
): Promise<AuthContext & WorkspaceContext> {
  const { clerkUserId } = await getAuthContext();
  const workspaceContext = await getActiveWorkspaceContext(clerkUserId);

  if (!allowedRoles.includes(workspaceContext.membership.role)) {
    redirect("/forbidden");
  }

  return { clerkUserId, ...workspaceContext };
}

export async function requireRoleMin(
  minRole: Role,
): Promise<AuthContext & WorkspaceContext> {
  const { clerkUserId } = await getAuthContext();
  const workspaceContext = await getActiveWorkspaceContext(clerkUserId);

  if (ROLE_RANK[workspaceContext.membership.role] < ROLE_RANK[minRole]) {
    redirect("/forbidden");
  }

  return { clerkUserId, ...workspaceContext };
}
