import Link from "next/link";
import { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirementStatusSchema } from "@/lib/validators/requirements";
import { can, requireRoleMin } from "@/server/authz";
import { listRequirements } from "@/server/requirements";

type RequirementsPageProps = {
  searchParams: Promise<{
    status?: string;
  }>;
};

export default async function RequirementsPage({
  searchParams,
}: RequirementsPageProps) {
  const resolvedSearchParams = await searchParams;
  const { workspace, membership } = await requireRoleMin(Role.REVIEWER);
  const canEdit = can(membership.role, "requirement:edit");
  const parsedStatus = requirementStatusSchema.safeParse(
    resolvedSearchParams?.status,
  );
  const statusFilter = parsedStatus.success ? parsedStatus.data : "ACTIVE";

  const requirements = await listRequirements(workspace.id, {
    status: statusFilter,
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requirements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Workspace-scoped requirement records for test case generation.
          </p>
        </div>
        {canEdit ? (
          <Button asChild>
            <Link href="/dashboard/requirements/new">New Requirement</Link>
          </Button>
        ) : (
          <Button disabled>New Requirement</Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant={statusFilter === "ACTIVE" ? "default" : "outline"}>
          <Link href="/dashboard/requirements?status=ACTIVE">Active</Link>
        </Button>
        <Button asChild size="sm" variant={statusFilter === "ARCHIVED" ? "default" : "outline"}>
          <Link href="/dashboard/requirements?status=ARCHIVED">Archived</Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Module</th>
              <th className="px-4 py-3 font-medium">Updated</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {requirements.length > 0 ? (
              requirements.map((requirement) => (
                <tr className="border-t" key={requirement.id}>
                  <td className="px-4 py-3">
                    <Link className="font-medium hover:underline" href={`/dashboard/requirements/${requirement.id}`}>
                      {requirement.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {requirement.module_type}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {requirement.updated_at.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={requirement.status === "ACTIVE" ? "default" : "secondary"}>
                      {requirement.status}
                    </Badge>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-8 text-muted-foreground" colSpan={4}>
                  No requirements found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
