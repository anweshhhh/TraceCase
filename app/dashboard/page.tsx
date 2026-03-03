import { UserButton } from "@clerk/nextjs";
import { Role } from "@prisma/client";
import { requireRoleMin } from "@/server/authz";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { clerkUserId, workspace, membership } = await requireRoleMin(
    Role.REVIEWER,
  );

  return (
    <section className="rounded-lg border bg-background p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Personal workspace is auto-provisioned on first sign-in.
          </p>
        </div>
        <UserButton />
      </div>
      <dl className="mt-6 grid gap-4 rounded-md border bg-muted/30 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Workspace Name</dt>
          <dd className="font-medium">{workspace.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Workspace ID</dt>
          <dd className="font-mono text-xs sm:text-sm">{workspace.id}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Current User ID (Clerk)</dt>
          <dd className="font-mono text-xs sm:text-sm">{clerkUserId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Role</dt>
          <dd className="font-medium">{membership.role}</dd>
        </div>
      </dl>
    </section>
  );
}
