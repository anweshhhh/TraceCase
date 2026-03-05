import Link from "next/link";
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { can, requireRoleMin } from "@/server/authz";
import { listAuditEvents } from "@/server/auditRepo";

export const dynamic = "force-dynamic";

type AuditLogPageProps = {
  searchParams: Promise<{
    action?: string;
    entityType?: string;
    entityId?: string;
    actorClerkUserId?: string;
    limit?: string;
  }>;
};

function parseLimit(rawLimit?: string) {
  const parsed = Number.parseInt(rawLimit ?? "", 10);
  const allowed = new Set([25, 50, 100]);

  if (!Number.isNaN(parsed) && allowed.has(parsed)) {
    return parsed;
  }

  return 50;
}

function compactMetadata(metadata: unknown) {
  if (metadata == null) {
    return "-";
  }

  try {
    const text = JSON.stringify(metadata);
    if (!text) {
      return "-";
    }

    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
  } catch {
    return "[unserializable metadata]";
  }
}

export default async function AuditLogPage({ searchParams }: AuditLogPageProps) {
  const resolvedSearchParams = await searchParams;
  const { workspace, membership } = await requireRoleMin(Role.REVIEWER);

  if (!can(membership.role, "audit:view")) {
    redirect("/forbidden");
  }

  const limit = parseLimit(resolvedSearchParams.limit);
  const events = await listAuditEvents(workspace.id, {
    action: resolvedSearchParams.action,
    entityType: resolvedSearchParams.entityType,
    entityId: resolvedSearchParams.entityId,
    actorClerkUserId: resolvedSearchParams.actorClerkUserId,
    limit,
  });

  return (
    <section className="space-y-4">
      <div className="rounded-lg border bg-background p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Workspace-scoped activity trail with simple filters.
            </p>
          </div>
          <Badge variant="outline">Workspace {workspace.id}</Badge>
        </div>
      </div>

      <div className="rounded-lg border bg-background p-4 shadow-sm">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" method="get">
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="action">
              Action
            </label>
            <Input
              defaultValue={resolvedSearchParams.action ?? ""}
              id="action"
              name="action"
              placeholder="pack.approved"
            />
          </div>
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="entityType">
              Entity Type
            </label>
            <Input
              defaultValue={resolvedSearchParams.entityType ?? ""}
              id="entityType"
              name="entityType"
              placeholder="Pack"
            />
          </div>
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="entityId">
              Entity ID
            </label>
            <Input
              defaultValue={resolvedSearchParams.entityId ?? ""}
              id="entityId"
              name="entityId"
              placeholder="cuid..."
            />
          </div>
          <div className="lg:col-span-2">
            <label
              className="mb-1 block text-xs text-muted-foreground"
              htmlFor="actorClerkUserId"
            >
              Actor Clerk User ID
            </label>
            <Input
              defaultValue={resolvedSearchParams.actorClerkUserId ?? ""}
              id="actorClerkUserId"
              name="actorClerkUserId"
              placeholder="user_..."
            />
          </div>
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="limit">
              Limit
            </label>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              defaultValue={String(limit)}
              id="limit"
              name="limit"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
            <Button type="submit">Apply Filters</Button>
            <Button asChild type="button" variant="outline">
              <Link href="/dashboard/audit">Clear</Link>
            </Button>
          </div>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {events.length > 0 ? (
              events.map((event) => (
                <tr className="border-t" key={event.id}>
                  <td className="px-4 py-3 text-muted-foreground">
                    {event.created_at.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium">{event.action}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {event.actor_clerk_user_id}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {event.entity_type ?? "-"}
                    {event.entity_id ? ` / ${event.entity_id}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <code className="line-clamp-2 block max-w-[420px] whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {compactMetadata(event.metadata_json)}
                    </code>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-8 text-muted-foreground" colSpan={5}>
                  No audit events found for the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
