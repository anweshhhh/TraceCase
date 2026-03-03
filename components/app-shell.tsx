import type { ReactNode } from "react";
import { Role } from "@prisma/client";
import Link from "next/link";
import { can } from "@/server/authz";
import { Button } from "@/components/ui/button";

type AppShellProps = {
  children: ReactNode;
  role: Role;
  workspaceId: string;
};

export function AppShell({ children, role, workspaceId }: AppShellProps) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm font-semibold tracking-wide">
              TraceCase
            </Link>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Workspace: {workspaceId}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            {can(role, "workspace:manage_members") ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/admin">Admin Area</Link>
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/reviewer-only">Reviewer Only</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
