"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type AppShellProps = {
  children: ReactNode;
  showAdmin: boolean;
  showAudit: boolean;
  workspaceId: string;
};

export function AppShell({
  children,
  showAdmin,
  showAudit,
  workspaceId,
}: AppShellProps) {
  const pathname = usePathname();
  const navItems = [
    {
      href: "/dashboard",
      label: "Dashboard",
      active:
        pathname === "/dashboard" || pathname.startsWith("/dashboard?"),
    },
    {
      href: "/dashboard/requirements",
      label: "Requirements",
      active: pathname.startsWith("/dashboard/requirements"),
    },
    ...(showAudit
      ? [
          {
            href: "/dashboard/audit",
            label: "Audit Log",
            active: pathname.startsWith("/dashboard/audit"),
          },
        ]
      : []),
    ...(showAdmin
      ? [
          {
            href: "/dashboard/admin",
            label: "RBAC Demo",
            active: pathname.startsWith("/dashboard/admin"),
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fcfaf5_0%,#f4ede1_100%)]">
      <header className="sticky top-0 z-30 border-b border-black/6 bg-[rgba(255,253,248,0.82)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 text-sm font-semibold tracking-[0.02em] text-foreground"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-black/8 bg-[linear-gradient(180deg,#ffffff_0%,#eef2ff_100%)] shadow-sm">
                <span className="h-3.5 w-3.5 rounded-full bg-[linear-gradient(135deg,#3268ff,#149b87)]" />
              </span>
              <span>TraceCase</span>
            </Link>
            <div className="hidden items-center gap-2 rounded-full border border-black/8 bg-white/72 px-3.5 py-1.5 text-xs text-muted-foreground sm:inline-flex">
              <span className="h-2 w-2 rounded-full bg-[linear-gradient(135deg,#3268ff,#149b87)]" />
              <span>Workspace · {workspaceId.slice(-6)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-full border border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.9)_0%,rgba(255,251,245,0.74)_100%)] p-1.5 shadow-sm">
            {navItems.map((item) => (
              <Link
                className={
                  item.active
                    ? "rounded-full bg-[linear-gradient(180deg,#1d2330_0%,#151922_100%)] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors"
                    : "rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-black/4 hover:text-slate-950"
                }
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-8 sm:py-10">
        {children}
      </main>
    </div>
  );
}
