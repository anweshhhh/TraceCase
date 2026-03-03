import { Role } from "@prisma/client";
import { requireRoleAny } from "@/server/authz";

export default async function ReviewerOnlyPage() {
  const { workspace, membership } = await requireRoleAny([Role.REVIEWER]);

  return (
    <section className="rounded-lg border bg-background p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">
        Reviewer Only Area
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This route permits only the REVIEWER role.
      </p>
      <dl className="mt-6 grid gap-4 rounded-md border bg-muted/30 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Workspace ID</dt>
          <dd className="font-mono text-xs sm:text-sm">{workspace.id}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Role</dt>
          <dd className="font-medium">{membership.role}</dd>
        </div>
      </dl>
    </section>
  );
}
