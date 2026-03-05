import Link from "next/link";
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { RequirementForm } from "@/components/requirements/requirement-form";
import { Button } from "@/components/ui/button";
import { can, requireRoleMin } from "@/server/authz";

export default async function NewRequirementPage() {
  const { membership } = await requireRoleMin(Role.REVIEWER);

  if (!can(membership.role, "requirement:edit")) {
    redirect("/forbidden");
  }

  return (
    <section className="rounded-lg border bg-background p-6 shadow-sm">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            New Requirement
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a requirement scoped to your active workspace.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/requirements">Back</Link>
        </Button>
      </div>
      <RequirementForm mode="create" />
    </section>
  );
}
