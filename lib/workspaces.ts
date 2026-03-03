import "server-only";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";

export async function getOrCreatePersonalWorkspace(clerkUserId: string) {
  return db.$transaction(async (tx) => {
    const workspace = await tx.workspace.upsert({
      where: {
        owner_clerk_user_id: clerkUserId,
      },
      update: {},
      create: {
        name: "Personal Workspace",
        owner_clerk_user_id: clerkUserId,
        memberships: {
          create: {
            clerk_user_id: clerkUserId,
            role: Role.OWNER,
          },
        },
      },
    });

    const membership = await tx.membership.upsert({
      where: {
        workspace_id_clerk_user_id: {
          workspace_id: workspace.id,
          clerk_user_id: clerkUserId,
        },
      },
      update: {
        role: Role.OWNER,
      },
      create: {
        workspace_id: workspace.id,
        clerk_user_id: clerkUserId,
        role: Role.OWNER,
      },
    });

    return { workspace, membership };
  });
}
