import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getActiveWorkspaceContext, getAuthContext } from "@/server/authz";

type DashboardLayoutProps = {
  children: ReactNode;
};

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const { clerkUserId } = await getAuthContext();
  const { workspace, membership } = await getActiveWorkspaceContext(clerkUserId);

  return (
    <AppShell role={membership.role} workspaceId={workspace.id}>
      {children}
    </AppShell>
  );
}
