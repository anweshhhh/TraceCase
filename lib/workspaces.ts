import "server-only";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";

function isOwnerWorkspaceUniqueConstraint(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function getOrCreatePersonalWorkspace(clerkUserId: string) {
  let workspace = await db.workspace.findUnique({
    where: {
      owner_clerk_user_id: clerkUserId,
    },
  });

  if (!workspace) {
    try {
      workspace = await db.workspace.create({
        data: {
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
    } catch (error) {
      if (!isOwnerWorkspaceUniqueConstraint(error)) {
        throw error;
      }

      workspace = await db.workspace.findUnique({
        where: {
          owner_clerk_user_id: clerkUserId,
        },
      });
    }
  }

  if (!workspace) {
    throw new Error("Unable to load personal workspace after creation race.");
  }

  const membership = await db.membership.upsert({
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
}
