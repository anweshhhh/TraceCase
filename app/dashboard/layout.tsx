import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import {
  can,
  getActiveWorkspaceContext,
  getAuthContext,
} from "@/server/authz";

type DashboardLayoutProps = {
  children: ReactNode;
};

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const { clerkUserId } = await getAuthContext();
  const { workspace, membership } = await getActiveWorkspaceContext(clerkUserId);

  return (
    <AppShell
      showAdmin={can(membership.role, "workspace:manage_members")}
      showAudit={can(membership.role, "audit:view")}
      workspaceId={workspace.id}
    >
      {children}
    </AppShell>
  );
}
