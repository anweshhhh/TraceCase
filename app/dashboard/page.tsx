import Link from "next/link";
import { JobStatus, PackStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { can, requireRoleMin } from "@/server/authz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientUserButton } from "@/components/clerk/user-button";
import {
  DashboardLayerSwitcher,
  DashboardRangeSelector,
  DashboardSideSheet,
} from "@/components/dashboard/dashboard-layer-switcher";
import { GENERATE_PACK_JOB_TYPE } from "@/server/packs/constants";
import { listRecentGeneratePackJobsForRequirement } from "@/server/packs/jobs";
import { listRequirements } from "@/server/requirements";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams?: Promise<{
    range?: string;
    view?: string;
  }>;
};

type GeneratePackJob = Awaited<
  ReturnType<typeof listRecentGeneratePackJobsForRequirement>
>[number];

type DashboardRangeKey = "7d" | "30d" | "quarter";
type DashboardViewKey = "overview" | "trends" | "evidence";

type DashboardRangeConfig = {
  key: DashboardRangeKey;
  label: string;
  days: number;
  bucketDays: number;
};

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function truncateCopy(value: string, max = 120) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getRangeConfig(input: string | undefined): DashboardRangeConfig {
  if (input === "30d") {
    return { key: "30d", label: "30d", days: 30, bucketDays: 5 };
  }

  if (input === "quarter") {
    return { key: "quarter", label: "Quarter", days: 91, bucketDays: 7 };
  }

  return { key: "7d", label: "7d", days: 7, bucketDays: 1 };
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function formatDelta(
  current: number | null,
  previous: number | null,
  options?: { suffix?: string; inverse?: boolean; decimals?: number; unitWord?: string },
) {
  if (current === null || previous === null) {
    return "First period";
  }

  const difference = current - previous;
  const decimals = options?.decimals ?? 0;
  const absolute = Math.abs(difference).toFixed(decimals);
  const suffix = options?.suffix ?? "";

  if (difference === 0) {
    return `Flat vs prev${suffix}`;
  }

  if (options?.unitWord) {
    if (options.inverse) {
      return difference < 0
        ? `${absolute}${options.unitWord} better`
        : `${absolute}${options.unitWord} slower`;
    }

    return difference > 0
      ? `+${absolute}${options.unitWord}`
      : `-${absolute}${options.unitWord}`;
  }

  if (options?.inverse) {
    return difference < 0
      ? `${absolute}${suffix} better`
      : `${absolute}${suffix} higher`;
  }

  return difference > 0
    ? `+${absolute}${suffix}`
    : `-${absolute}${suffix}`;
}

function formatDurationMinutes(value: number | null) {
  if (value === null) {
    return "—";
  }

  if (value >= 60) {
    return `${(value / 60).toFixed(1)}h`;
  }

  return `${Math.round(value)}m`;
}

function buildSparklinePoints(values: number[]) {
  if (values.length === 0) {
    return "";
  }

  const max = Math.max(...values, 1);

  return values
    .map((value, index) => {
      const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
      const y = 32 - (value / max) * 26;
      return `${x},${y}`;
    })
    .join(" ");
}

function getStateBRunPresentation(job: GeneratePackJob | null) {
  if (!job) {
    return {
      badge: "No draft yet",
      badgeClassName:
        "border border-slate-200/70 bg-white/85 text-slate-700",
      title: "No draft has been generated yet.",
      body: "Launch the first pack run from the latest requirement.",
      accentClassName:
        "bg-[linear-gradient(180deg,#1c2230_0%,#171b23_100%)] text-white",
      actionLabel: "Generate from requirement",
    };
  }

  if (job.status === JobStatus.RUNNING || job.status === JobStatus.QUEUED) {
    return {
      badge: job.status === JobStatus.RUNNING ? "Draft running" : "Draft queued",
      badgeClassName:
        "border border-sky-400/25 bg-sky-400/12 text-sky-100",
      title:
        job.status === JobStatus.RUNNING
          ? "A draft pack is being generated right now."
          : "A draft pack is queued and waiting to start.",
      body: "Open the requirement to track the run and review it when it lands.",
      accentClassName:
        "bg-[linear-gradient(180deg,#17334a_0%,#101b2b_100%)] text-white",
      actionLabel: "Watch latest run",
    };
  }

  if (job.status === JobStatus.FAILED) {
    return {
      badge: "Needs attention",
      badgeClassName:
        "border border-amber-400/25 bg-amber-400/12 text-amber-100",
      title: "The latest draft attempt did not make it through.",
      body: job.error
        ? truncateCopy(job.error)
        : "Open the requirement to inspect the latest run and launch another pass.",
      accentClassName:
        "bg-[linear-gradient(180deg,#2a2118_0%,#1f1712_100%)] text-white",
      actionLabel: "Review failure",
    };
  }

  return {
    badge: "Draft started",
    badgeClassName:
      "border border-emerald-400/25 bg-emerald-400/12 text-emerald-100",
    title: "Draft work has started, but your first successful pack is still ahead.",
    body: "Open the latest requirement and keep the workflow moving.",
    accentClassName:
      "bg-[linear-gradient(180deg,#17312a_0%,#121f1b_100%)] text-white",
    actionLabel: "Open requirement",
  };
}

function getCompactRunStatus(status: JobStatus | null | undefined) {
  if (!status) {
    return "Not started";
  }

  if (status === JobStatus.SUCCEEDED) {
    return "Succeeded";
  }

  if (status === JobStatus.RUNNING) {
    return "Running";
  }

  if (status === JobStatus.QUEUED) {
    return "Queued";
  }

  return "Needs attention";
}

function getRunStatusDotClassName(status: JobStatus | null | undefined) {
  if (status === JobStatus.SUCCEEDED) {
    return "bg-emerald-500";
  }

  if (status === JobStatus.RUNNING) {
    return "bg-sky-500";
  }

  if (status === JobStatus.QUEUED) {
    return "bg-indigo-400";
  }

  if (status === JobStatus.FAILED) {
    return "bg-amber-500";
  }

  return "bg-slate-300";
}

function getRunStatusChip(status: JobStatus | null | undefined) {
  if (status === JobStatus.SUCCEEDED) {
    return {
      label: "Success",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (status === JobStatus.RUNNING) {
    return {
      label: "Running",
      className: "border-sky-200 bg-sky-50 text-sky-700",
    };
  }

  if (status === JobStatus.QUEUED) {
    return {
      label: "Queued",
      className: "border-indigo-200 bg-indigo-50 text-indigo-700",
    };
  }

  if (status === JobStatus.FAILED) {
    return {
      label: "Failed",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  return {
    label: "Idle",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  };
}

function getRecentRunSummary(
  runs: Array<{ status: JobStatus | null | undefined }>,
) {
  return runs.reduce(
    (summary, run) => {
      if (run.status === JobStatus.SUCCEEDED) {
        summary.succeeded += 1;
      } else if (run.status === JobStatus.FAILED) {
        summary.failed += 1;
      } else if (
        run.status === JobStatus.RUNNING ||
        run.status === JobStatus.QUEUED
      ) {
        summary.active += 1;
      }

      return summary;
    },
    { succeeded: 0, failed: 0, active: 0 },
  );
}

function formatRelativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return "Just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return formatShortDate(date);
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const resolvedSearchParams = await searchParams;
  const { workspace, membership } = await requireRoleMin(Role.REVIEWER);
  const selectedRange = getRangeConfig(resolvedSearchParams?.range);
  const selectedView: DashboardViewKey =
    resolvedSearchParams?.view === "trends" ||
    resolvedSearchParams?.view === "evidence"
      ? resolvedSearchParams.view
      : "overview";
  const rangeEnd = new Date();
  const rangeStart = startOfDay(addDays(rangeEnd, -(selectedRange.days - 1)));
  const previousRangeStart = startOfDay(addDays(rangeStart, -selectedRange.days));
  const [
    activeRequirements,
    archivedRequirements,
    successfulGenerationJob,
    latestGenerationJob,
    successfulDraftCount,
    recentWorkspaceRuns,
    analyticsJobs,
    analyticsPacks,
  ] =
    await Promise.all([
      listRequirements(workspace.id, { status: "ACTIVE" }),
      listRequirements(workspace.id, { status: "ARCHIVED" }),
      db.job.findFirst({
        where: {
        workspace_id: workspace.id,
        type: GENERATE_PACK_JOB_TYPE,
        status: JobStatus.SUCCEEDED,
          output_pack_id: {
            not: null,
          },
        },
        orderBy: {
          created_at: "desc",
        },
        select: {
          id: true,
          status: true,
          error: true,
          created_at: true,
          finished_at: true,
          output_pack_id: true,
        },
      }),
      db.job.findFirst({
        where: {
          workspace_id: workspace.id,
          type: GENERATE_PACK_JOB_TYPE,
        },
        orderBy: {
          created_at: "desc",
        },
        select: {
          id: true,
          status: true,
          error: true,
          created_at: true,
          finished_at: true,
          output_pack_id: true,
        },
      }),
      db.job.count({
        where: {
          workspace_id: workspace.id,
          type: GENERATE_PACK_JOB_TYPE,
          status: JobStatus.SUCCEEDED,
          output_pack_id: {
            not: null,
          },
        },
      }),
      db.job.findMany({
        where: {
          workspace_id: workspace.id,
          type: GENERATE_PACK_JOB_TYPE,
        },
        orderBy: {
          created_at: "desc",
        },
        take: 7,
        select: {
          id: true,
          status: true,
          error: true,
          created_at: true,
          input_requirement_snapshot_id: true,
          output_pack_id: true,
        },
      }),
      db.job.findMany({
        where: {
          workspace_id: workspace.id,
          type: GENERATE_PACK_JOB_TYPE,
          created_at: {
            gte: previousRangeStart,
          },
        },
        select: {
          id: true,
          status: true,
          created_at: true,
          finished_at: true,
          output_pack_id: true,
        },
      }),
      db.pack.findMany({
        where: {
          workspace_id: workspace.id,
          created_at: {
            gte: previousRangeStart,
          },
        },
        select: {
          id: true,
          status: true,
          created_at: true,
        },
      }),
    ]);
  const isBrandNew =
    activeRequirements.length === 0 && archivedRequirements.length === 0;
  const isStateB = !isBrandNew && !successfulGenerationJob;

  if (isBrandNew) {
    return (
      <section className="space-y-6">
        <div className="flex items-center justify-end">
          <ClientUserButton />
        </div>

        <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
          <div className="w-full overflow-hidden rounded-[2.25rem] border bg-[linear-gradient(180deg,#fffdf8_0%,#f7f1e7_100%)] px-6 py-10 shadow-sm sm:px-8 sm:py-12">
            <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
              Welcome to TraceCase
            </p>
            <h1 className="mx-auto mt-4 max-w-3xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              Create your first requirement and get to draft fast.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
              Start with one requirement. TraceCase shapes the first draft fast,
              and you can layer API or schema context in later when it adds value.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/dashboard/requirements/new">
                  Create your first requirement
                </Link>
              </Button>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-full border border-black/8 bg-white/72 px-3 py-1">
                Requirement first
              </span>
              <span className="rounded-full border border-black/8 bg-white/72 px-3 py-1">
                Refine later
              </span>
              <span className="rounded-full border border-black/8 bg-white/72 px-3 py-1">
                Context optional
              </span>
            </div>

            <div className="mt-8 overflow-hidden rounded-[2rem] border bg-background/88 shadow-sm">
              <div className="grid gap-0 md:grid-cols-[1.02fr_120px_1.08fr]">
                <div className="bg-[linear-gradient(180deg,#fffefb_0%,#faf5ec_100%)] p-5 text-left sm:p-6">
                  <p className="text-xs font-medium text-muted-foreground">
                    Requirement
                  </p>
                  <div className="mt-4 rounded-[1.4rem] border bg-white p-4 shadow-sm">
                    <p className="text-sm font-medium text-foreground">
                      Email OTP login with resend and lockout
                    </p>
                    <div className="mt-4 space-y-2">
                      <div className="h-2 rounded-full bg-muted/40" />
                      <div className="h-2 w-5/6 rounded-full bg-muted/30" />
                      <div className="h-2 w-2/3 rounded-full bg-muted/25" />
                    </div>
                    <div className="mt-4 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                      18 criteria detected
                    </div>
                  </div>
                </div>

                <div className="hidden items-center justify-center bg-[radial-gradient(circle_at_center,#edf2ff_0%,#fffdf8_70%)] md:flex">
                  <div className="w-16">
                    <div className="h-px bg-slate-300" />
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="h-2 rounded-full bg-slate-900" />
                      <div className="h-2 rounded-full bg-slate-300" />
                      <div className="h-2 rounded-full bg-slate-300" />
                    </div>
                  </div>
                </div>

                <div className="bg-[linear-gradient(180deg,#1a1d26_0%,#14161b_100%)] p-5 text-left text-white shadow-[0_24px_60px_rgba(15,23,42,0.18)] sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-white/55">
                      Draft pack
                    </p>
                    <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-medium text-emerald-100">
                      Review ready
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2.5 text-sm text-white/78">
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      Scenario coverage
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      API checks
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      SQL checks
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs text-white/58">
                      <span>Coverage</span>
                      <span>18 / 18</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-white/10">
                      <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,#3268ff,#149b87)]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
              Save the requirement first. We&apos;ll shape the initial draft from
              there, and you can deepen it with API or schema context whenever
              you&apos;re ready.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (isStateB) {
    const leadRequirement = activeRequirements[0] ?? archivedRequirements[0] ?? null;
    const secondaryRequirements =
      activeRequirements.length > 1
        ? activeRequirements.slice(1, 4)
        : archivedRequirements.slice(0, 3);
    const latestLeadRun = leadRequirement
      ? (await listRecentGeneratePackJobsForRequirement(
          workspace.id,
          leadRequirement.id,
          1,
        ))[0] ?? null
      : null;
    const runPresentation = getStateBRunPresentation(latestLeadRun);

    return (
      <section className="space-y-6">
        <div className="flex items-center justify-end">
          <ClientUserButton />
        </div>

        <div className="mx-auto max-w-6xl">
          <div className="overflow-hidden rounded-[2.25rem] border bg-[linear-gradient(180deg,#fffdf8_0%,#f5efe3_100%)] px-6 py-8 shadow-sm sm:px-8 sm:py-10">
            <div className="mt-6 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
                  Dashboard
                </p>
                <h1 className="mt-4 max-w-3xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Land your first review-ready draft.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                  Keep the latest requirement moving. One successful draft unlocks
                  review-ready workflow and live workspace health from here on out.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link
                    href={
                      leadRequirement
                        ? `/dashboard/requirements/${leadRequirement.id}`
                        : "/dashboard/requirements/new"
                    }
                  >
                    {leadRequirement
                      ? "Continue latest requirement"
                      : "Create your first requirement"}
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/dashboard/requirements">View all requirements</Link>
                </Button>
              </div>
            </div>

            <div className="mt-8 rounded-[1.7rem] border bg-white/76 p-4 shadow-sm sm:p-5">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-[1.2rem] border bg-background px-4 py-3">
                  <p className="text-[11px] font-medium tracking-[0.22em] text-muted-foreground">
                    01
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    Requirement in place
                  </p>
                </div>
                <div className="rounded-[1.2rem] border bg-background px-4 py-3">
                  <p className="text-[11px] font-medium tracking-[0.22em] text-muted-foreground">
                    02
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {latestLeadRun ? "Run in motion" : "First run pending"}
                  </p>
                </div>
                <div className="rounded-[1.2rem] border border-dashed border-emerald-300/80 bg-emerald-50/70 px-4 py-3">
                  <p className="text-[11px] font-medium tracking-[0.22em] text-emerald-700">
                    03
                  </p>
                  <p className="mt-2 text-sm font-medium text-emerald-900">
                    Review-ready draft pending
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-4 xl:grid-cols-[1.25fr_0.82fr]">
              <div className="rounded-[1.85rem] border bg-background/88 p-5 shadow-sm sm:p-6">
                <p className="text-xs font-medium text-muted-foreground">
                  Working context
                </p>

                {leadRequirement ? (
                  <>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{leadRequirement.module_type}</Badge>
                      <Badge
                        className="border-black/10 bg-muted/40 text-foreground"
                        variant="outline"
                      >
                        {leadRequirement.status === "ACTIVE"
                          ? "Active requirement"
                          : "Archived requirement"}
                      </Badge>
                    </div>

                    <div className="mt-4">
                      <Link
                        className="text-2xl font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
                        href={`/dashboard/requirements/${leadRequirement.id}`}
                      >
                        {leadRequirement.title}
                      </Link>
                      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                        Updated {formatShortDate(leadRequirement.updated_at)}.
                        This is still the fastest path to a first draft with real
                        evidence behind it.
                      </p>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border bg-muted/10 px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Context
                        </p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          Requirement saved
                        </p>
                      </div>
                      <div className="rounded-2xl border bg-muted/10 px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Updated
                        </p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          {formatShortDate(leadRequirement.updated_at)}
                        </p>
                      </div>
                      <div className="rounded-2xl border bg-muted/10 px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Draft status
                        </p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          {getCompactRunStatus(latestLeadRun?.status)}
                        </p>
                      </div>
                    </div>

                    <Button asChild className="mt-6" size="lg">
                      <Link href={`/dashboard/requirements/${leadRequirement.id}`}>
                        {runPresentation.actionLabel}
                      </Link>
                    </Button>
                  </>
                ) : (
                  <div className="mt-4 rounded-[1.5rem] border bg-muted/10 p-5 text-sm text-muted-foreground">
                    You have requirement history here, but nothing active to keep
                    pushing. Start a fresh requirement to reach your first draft.
                  </div>
                )}
              </div>

              <div
                className={`rounded-[1.85rem] border p-5 shadow-[0_24px_60px_rgba(15,23,42,0.12)] sm:p-6 ${runPresentation.accentClassName}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-white/60">
                    Immediate next move
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${runPresentation.badgeClassName}`}
                  >
                    {runPresentation.badge}
                  </span>
                </div>

                <div className="mt-5 space-y-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-white">
                      {runPresentation.title}
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-white/70">
                      {runPresentation.body}
                    </p>
                  </div>

                  <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4">
                    <div className="grid gap-2 text-sm text-white/82">
                      <div className="flex items-center justify-between gap-3">
                        <span>Latest requirement</span>
                        <span>{leadRequirement ? "Ready" : "Missing"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Latest run</span>
                        <span>{getCompactRunStatus(latestLeadRun?.status)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Priority</span>
                        <span>Land one successful draft</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    asChild
                    className="w-full bg-white text-slate-950 hover:bg-white/90"
                    size="lg"
                  >
                    <Link
                      href={
                        leadRequirement
                          ? `/dashboard/requirements/${leadRequirement.id}`
                          : "/dashboard/requirements/new"
                      }
                    >
                      {runPresentation.actionLabel}
                    </Link>
                  </Button>
                </div>
              </div>
            </div>

            {secondaryRequirements.length > 0 ? (
              <div className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    Recent work
                  </p>
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/dashboard/requirements">View all requirements</Link>
                  </Button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {secondaryRequirements.map((requirement) => (
                    <Link
                      className="rounded-[1.45rem] border bg-white/78 px-4 py-4 transition-colors hover:bg-white"
                      href={`/dashboard/requirements/${requirement.id}`}
                      key={requirement.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline">{requirement.module_type}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatShortDate(requirement.updated_at)}
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-medium text-foreground">
                        {truncateCopy(requirement.title, 72)}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  const leadRequirement = activeRequirements[0] ?? archivedRequirements[0] ?? null;
  const latestLeadRun = leadRequirement
    ? (await listRecentGeneratePackJobsForRequirement(
        workspace.id,
        leadRequirement.id,
        1,
      ))[0] ?? null
    : null;
  const recentRequirements = [...activeRequirements, ...archivedRequirements]
    .filter((requirement) => requirement.id !== leadRequirement?.id)
    .sort((left, right) => right.updated_at.getTime() - left.updated_at.getTime())
    .slice(0, 3);
  const recentRunSummary = getRecentRunSummary(recentWorkspaceRuns);
  const activitySnapshotIds = Array.from(
    new Set(
      recentWorkspaceRuns
        .map((job) => job.input_requirement_snapshot_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const activityPackIds = Array.from(
    new Set(
      recentWorkspaceRuns
        .map((job) => job.output_pack_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const [activitySnapshots, activityPacks] = await Promise.all([
    activitySnapshotIds.length > 0
      ? db.requirementSnapshot.findMany({
          where: {
            id: {
              in: activitySnapshotIds,
            },
          },
          select: {
            id: true,
            version: true,
            requirement: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        })
      : [],
    activityPackIds.length > 0
      ? db.pack.findMany({
          where: {
            id: {
              in: activityPackIds,
            },
          },
          select: {
            id: true,
            status: true,
            requirement: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        })
      : [],
  ]);
  const snapshotTitleById = new Map(
    activitySnapshots.map((snapshot) => [
      snapshot.id,
      {
        title: snapshot.requirement.title,
        requirementId: snapshot.requirement.id,
        version: snapshot.version,
      },
    ]),
  );
  const packInfoById = new Map(
    activityPacks.map((pack) => [
      pack.id,
      {
        title: pack.requirement.title,
        requirementId: pack.requirement.id,
        status: pack.status,
      },
    ]),
  );
  const recentActivityItems = recentWorkspaceRuns.slice(0, 3).map((job) => {
    const snapshotInfo = job.input_requirement_snapshot_id
      ? snapshotTitleById.get(job.input_requirement_snapshot_id)
      : null;
    const packInfo = job.output_pack_id
      ? packInfoById.get(job.output_pack_id)
      : null;
    const subjectTitle =
      packInfo?.title ?? snapshotInfo?.title ?? "Untitled requirement";
    const requirementHref = snapshotInfo?.requirementId
      ? `/dashboard/requirements/${snapshotInfo.requirementId}`
      : leadRequirement
        ? `/dashboard/requirements/${leadRequirement.id}`
        : "/dashboard/requirements";
    const packHref = job.output_pack_id
      ? `/dashboard/packs/${job.output_pack_id}`
      : requirementHref;

    if (job.status === JobStatus.SUCCEEDED && job.output_pack_id) {
      return {
        id: job.id,
        status: job.status,
        sentence: "Review-ready pack created",
        title: subjectTitle,
        time: formatRelativeTime(job.created_at),
        href: packHref,
        actionLabel: "Open pack",
        supportingText: "Ready to reopen for review.",
      };
    }

    if (job.status === JobStatus.FAILED) {
      return {
        id: job.id,
        status: job.status,
        sentence: "Draft generation failed",
        title: subjectTitle,
        time: formatRelativeTime(job.created_at),
        href: requirementHref,
        actionLabel: "Inspect run",
        supportingText: job.error
          ? truncateCopy(job.error, 90)
          : "Open the requirement to inspect and retry.",
      };
    }

    if (job.status === JobStatus.RUNNING || job.status === JobStatus.QUEUED) {
      return {
        id: job.id,
        status: job.status,
        sentence:
          job.status === JobStatus.RUNNING
            ? "Draft generation running"
            : "Draft generation queued",
        title: subjectTitle,
        time: formatRelativeTime(job.created_at),
        href: requirementHref,
        actionLabel: job.status === JobStatus.RUNNING ? "Track run" : "Open requirement",
        supportingText:
          job.status === JobStatus.RUNNING
            ? "Follow the latest run from the requirement page."
            : "The next generation pass is waiting to start.",
      };
    }

    return {
      id: job.id,
      status: job.status,
      sentence: "Generation update",
      title: subjectTitle,
      time: formatRelativeTime(job.created_at),
      href: requirementHref,
      actionLabel: "Open requirement",
      supportingText: "Open the requirement for the full history.",
    };
  });
  const featuredActivityItem = recentActivityItems[0] ?? null;
  const remainingActivityItems = recentActivityItems.slice(1);
  const currentJobs = analyticsJobs.filter((job) => job.created_at >= rangeStart);
  const previousJobs = analyticsJobs.filter(
    (job) => job.created_at >= previousRangeStart && job.created_at < rangeStart,
  );
  const currentPacks = analyticsPacks.filter((pack) => pack.created_at >= rangeStart);
  const previousPacks = analyticsPacks.filter(
    (pack) => pack.created_at >= previousRangeStart && pack.created_at < rangeStart,
  );
  const currentFinishedJobs = currentJobs.filter(
    (job) => job.status === JobStatus.SUCCEEDED || job.status === JobStatus.FAILED,
  );
  const previousFinishedJobs = previousJobs.filter(
    (job) => job.status === JobStatus.SUCCEEDED || job.status === JobStatus.FAILED,
  );
  const currentSucceededJobs = currentFinishedJobs.filter(
    (job) => job.status === JobStatus.SUCCEEDED && job.output_pack_id,
  );
  const previousSucceededJobs = previousFinishedJobs.filter(
    (job) => job.status === JobStatus.SUCCEEDED && job.output_pack_id,
  );
  const currentFailedJobs = currentJobs.filter((job) => job.status === JobStatus.FAILED);
  const previousFailedJobs = previousJobs.filter((job) => job.status === JobStatus.FAILED);
  const currentReviewReadyPacks = currentPacks.filter(
    (pack) => pack.status === PackStatus.NEEDS_REVIEW,
  ).length;
  const previousReviewReadyPacks = previousPacks.filter(
    (pack) => pack.status === PackStatus.NEEDS_REVIEW,
  ).length;
  const currentSuccessRate =
    currentFinishedJobs.length > 0
      ? (currentSucceededJobs.length / currentFinishedJobs.length) * 100
      : null;
  const previousSuccessRate =
    previousFinishedJobs.length > 0
      ? (previousSucceededJobs.length / previousFinishedJobs.length) * 100
      : null;
  const currentMedianMinutes = median(
    currentSucceededJobs
      .filter((job) => job.finished_at)
      .map((job) => (job.finished_at!.getTime() - job.created_at.getTime()) / 60000),
  );
  const previousMedianMinutes = median(
    previousSucceededJobs
      .filter((job) => job.finished_at)
      .map((job) => (job.finished_at!.getTime() - job.created_at.getTime()) / 60000),
  );
  const activeRunsNow = currentJobs.filter(
    (job) => job.status === JobStatus.RUNNING || job.status === JobStatus.QUEUED,
  ).length;
  const periodLeadLabel =
    selectedRange.key === "7d"
      ? "this week"
      : selectedRange.key === "30d"
        ? "over the last 30 days"
        : "this quarter";
  const staleRequirementThreshold = startOfDay(addDays(rangeEnd, -14));
  const staleRequirementsCount = activeRequirements.filter(
    (requirement) => requirement.updated_at < staleRequirementThreshold,
  ).length;
  const bucketCount = Math.ceil(selectedRange.days / selectedRange.bucketDays);
  const trendBuckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = startOfDay(
      addDays(rangeStart, index * selectedRange.bucketDays),
    );
    const bucketEnd = index === bucketCount - 1
      ? rangeEnd
      : startOfDay(addDays(bucketStart, selectedRange.bucketDays));
    const bucketJobs = currentJobs.filter(
      (job) => job.created_at >= bucketStart && job.created_at < bucketEnd,
    );
    const bucketFinishedJobs = bucketJobs.filter(
      (job) => job.status === JobStatus.SUCCEEDED || job.status === JobStatus.FAILED,
    );
    const bucketSucceeded = bucketFinishedJobs.filter(
      (job) => job.status === JobStatus.SUCCEEDED && job.output_pack_id,
    );
    const bucketFailed = bucketJobs.filter((job) => job.status === JobStatus.FAILED);
    const bucketActive = bucketJobs.filter(
      (job) => job.status === JobStatus.RUNNING || job.status === JobStatus.QUEUED,
    );
    const bucketMedianMinutes = median(
      bucketSucceeded
        .filter((job) => job.finished_at)
        .map((job) => (job.finished_at!.getTime() - job.created_at.getTime()) / 60000),
    );

    return {
      label: formatShortDate(bucketStart),
      reviewReady: currentPacks.filter(
        (pack) =>
          pack.created_at >= bucketStart &&
          pack.created_at < bucketEnd &&
          pack.status === PackStatus.NEEDS_REVIEW,
      ).length,
      successRate:
        bucketFinishedJobs.length > 0
          ? (bucketSucceeded.length / bucketFinishedJobs.length) * 100
          : 0,
      failures: bucketFailed.length,
      active: bucketActive.length,
      medianMinutes: bucketMedianMinutes ?? 0,
      total: bucketSucceeded.length + bucketFailed.length + bucketActive.length,
      succeeded: bucketSucceeded.length,
      failed: bucketFailed.length,
    };
  });
  const reviewReadySeries = trendBuckets.map((bucket) => bucket.reviewReady);
  const successRateSeries = trendBuckets.map((bucket) => bucket.successRate);
  const failureSeries = trendBuckets.map((bucket) => bucket.failures);
  const medianSeries = trendBuckets.map((bucket) => bucket.medianMinutes);
  const healthNarrative =
    currentSuccessRate !== null &&
    previousSuccessRate !== null &&
    currentSuccessRate >= previousSuccessRate &&
    currentFailedJobs.length <= previousFailedJobs.length
      ? `Draft health improved ${periodLeadLabel}. Success rate is up and failed runs stayed contained.`
      : currentFailedJobs.length > previousFailedJobs.length
        ? `Draft quality slipped ${periodLeadLabel}. Recent failures deserve a closer look before you push more work through.`
        : `Draft throughput held steady ${periodLeadLabel}. The clearest gain now is shortening time to a successful draft.`;
  const successRateDelta =
    currentSuccessRate !== null && previousSuccessRate !== null
      ? currentSuccessRate - previousSuccessRate
      : null;
  const medianMinutesDelta =
    currentMedianMinutes !== null && previousMedianMinutes !== null
      ? currentMedianMinutes - previousMedianMinutes
      : null;
  const failedRunsDelta = currentFailedJobs.length - previousFailedJobs.length;
  const reviewReadyDelta = currentReviewReadyPacks - previousReviewReadyPacks;
  const successRateShift =
    successRateDelta !== null
      ? `${successRateDelta > 0 ? "+" : ""}${Math.round(successRateDelta)} pts`
      : null;
  const failurePressureRising =
    latestGenerationJob?.status === JobStatus.FAILED ||
    failedRunsDelta > 0 ||
    (successRateDelta !== null && successRateDelta <= -8);
  const throughputSoftening =
    medianMinutesDelta !== null && medianMinutesDelta >= 8;
  const healthyMomentum =
    !failurePressureRising &&
    ((successRateDelta !== null && successRateDelta >= 6) ||
      reviewReadyDelta > 0 ||
      (medianMinutesDelta !== null && medianMinutesDelta <= -5));
  const priorityMetricLabel =
    latestGenerationJob?.status === JobStatus.FAILED || failedRunsDelta > 0
      ? "Failed runs"
      : successRateDelta !== null && successRateDelta <= -8
        ? "Draft success rate"
        : throughputSoftening
          ? "Median time to draft"
          : "Review-ready packs";
  const leadRequirementHref = leadRequirement
    ? `/dashboard/requirements/${leadRequirement.id}`
    : "/dashboard/requirements";
  const latestPackHref = successfulGenerationJob?.output_pack_id
    ? `/dashboard/packs/${successfulGenerationJob.output_pack_id}`
    : leadRequirementHref;
  const stateCStrategicLead =
    latestGenerationJob?.status === JobStatus.FAILED
      ? failedRunsDelta > 0
        ? `Failure pressure is rising ${periodLeadLabel}. Start with the newest issue, then reopen the latest successful pack.`
        : `The newest run needs intervention. Triage that issue first, then come back to the rest of the pipeline.`
      : latestGenerationJob?.status === JobStatus.RUNNING ||
          latestGenerationJob?.status === JobStatus.QUEUED
        ? successRateDelta !== null && successRateDelta < 0
          ? `A run is already moving, but draft quality softened ${periodLeadLabel}. Let this pass settle before you add more load.`
          : `A run is already moving. Stay close to it, then decide whether to keep pushing the latest requirement.`
        : failurePressureRising
          ? `Draft quality slipped ${periodLeadLabel}. Recenter on the newest issue, then move review-ready work forward.`
          : healthyMomentum
            ? `Review-ready work is landing cleanly ${periodLeadLabel}. The best move now is to pick up the newest pack and keep momentum.`
            : staleRequirementsCount > 0
              ? `Nothing urgent is breaking, but some work is starting to drift. Reopen the latest pack, then bring the stalest requirement back into motion.`
              : `Nothing urgent right now. Reopen the latest pack or continue the requirement with the most momentum.`;
  const heroHeadline =
    latestGenerationJob?.status === JobStatus.FAILED
      ? "Bring the draft pipeline back under control."
      : latestGenerationJob?.status === JobStatus.RUNNING ||
          latestGenerationJob?.status === JobStatus.QUEUED
        ? "Stay close to the active draft."
        : healthyMomentum
          ? "Keep review-ready work moving."
          : "See what needs attention next.";
  const kpiModules = [
    {
      label: "Review-ready packs",
      value: `${currentReviewReadyPacks}`,
      delta: formatDelta(currentReviewReadyPacks, previousReviewReadyPacks),
      series: reviewReadySeries,
      accentClassName: "text-emerald-700",
      isPriority: priorityMetricLabel === "Review-ready packs",
    },
    {
      label: "Draft success rate",
      value: currentSuccessRate !== null ? `${Math.round(currentSuccessRate)}%` : "—",
      delta: formatDelta(currentSuccessRate, previousSuccessRate, {
        suffix: " pts",
        decimals: 0,
      }),
      series: successRateSeries,
      accentClassName: "text-sky-700",
      isPriority: priorityMetricLabel === "Draft success rate",
    },
    {
      label: "Failed runs",
      value: `${currentFailedJobs.length}`,
      delta: formatDelta(currentFailedJobs.length, previousFailedJobs.length, {
        inverse: true,
      }),
      series: failureSeries,
      accentClassName: "text-amber-700",
      isPriority: priorityMetricLabel === "Failed runs",
    },
    {
      label: "Median time to draft",
      value: formatDurationMinutes(currentMedianMinutes),
      delta: formatDelta(currentMedianMinutes, previousMedianMinutes, {
        inverse: true,
        decimals: 0,
        unitWord: "m",
      }),
      series: medianSeries,
      accentClassName: "text-indigo-700",
      isPriority: priorityMetricLabel === "Median time to draft",
    },
  ];
  const stateCAttention =
    latestGenerationJob?.status === JobStatus.FAILED
      ? {
          eyebrow: failedRunsDelta > 0 ? "Pressure rising" : "Needs attention",
          title:
            failedRunsDelta > 0
              ? `Failure pressure rose this ${selectedRange.label}.`
              : "The latest generation run failed.",
          body: latestGenerationJob.error
            ? `${truncateCopy(latestGenerationJob.error, 140)}${successRateShift ? ` Success rate moved ${successRateShift} against the previous ${selectedRange.label}.` : ""}`
            : failedRunsDelta > 0
              ? `${Math.abs(failedRunsDelta)} more failed run${Math.abs(failedRunsDelta) === 1 ? "" : "s"} landed than the previous ${selectedRange.label}. Start with the newest failure.`
              : "Open the requirement that produced it and launch another pass.",
          href: leadRequirementHref,
          cta: "Inspect latest failure",
          toneClassName:
            "border-amber-200/90 bg-[linear-gradient(180deg,#fff7ec_0%,#fff2df_100%)]",
        }
      : latestGenerationJob?.status === JobStatus.RUNNING ||
          latestGenerationJob?.status === JobStatus.QUEUED
        ? {
            eyebrow:
              latestGenerationJob.status === JobStatus.RUNNING
                ? "Active run"
                : "Queued next",
            title:
              latestGenerationJob.status === JobStatus.RUNNING
                ? activeRunsNow > 1
                  ? `${activeRunsNow} draft runs are moving right now.`
                  : "A draft run is active right now."
                : "A draft run is queued right now.",
            body:
              successRateDelta !== null && successRateDelta < 0
                ? `Success rate slipped ${successRateShift} this ${selectedRange.label}, so this active pass matters more than starting another.`
                : "Open the latest requirement to follow the run as it moves, then decide the next step when it settles.",
            href: leadRequirementHref,
            cta:
              latestGenerationJob.status === JobStatus.RUNNING
                ? "Track active run"
                : "Open queued requirement",
            toneClassName:
              "border-sky-200/90 bg-[linear-gradient(180deg,#f2f9ff_0%,#ebf4ff_100%)]",
          }
        : {
            eyebrow: healthyMomentum ? "Momentum up" : staleRequirementsCount > 0 ? "Stay ahead" : "All clear",
            title:
              currentReviewReadyPacks > 1
                ? `All clear. ${currentReviewReadyPacks} packs are ready for review.`
                : "All clear. Your latest pack is ready for review.",
            body: healthyMomentum
              ? `${currentReviewReadyPacks > 0 ? `${currentReviewReadyPacks} pack${currentReviewReadyPacks === 1 ? "" : "s"} ${currentReviewReadyPacks === 1 ? "is" : "are"} ready for review` : "Draft health is improving across this window"}.${successRateShift ? ` Success rate moved ${successRateShift}.` : ""}${medianMinutesDelta !== null && medianMinutesDelta < 0 ? ` Successful drafts are landing ${Math.abs(Math.round(medianMinutesDelta))}m faster.` : ""}`
              : staleRequirementsCount > 0
                ? `${staleRequirementsCount} requirement${staleRequirementsCount === 1 ? "" : "s"} have gone quiet for more than two weeks. Review the newest pack first, then bring the stalest requirement back into motion.`
                : "You are in a good spot. Reopen the latest pack now, or keep refining the latest requirement when you are ready.",
            href: latestPackHref,
            cta: successfulGenerationJob?.output_pack_id
              ? "Open latest pack"
              : "Continue latest requirement",
            toneClassName:
              "border-emerald-200/90 bg-[linear-gradient(180deg,#f1fbf6_0%,#ebf7f0_100%)]",
          };
  const stateCIsHealthy =
    latestGenerationJob?.status !== JobStatus.FAILED &&
    latestGenerationJob?.status !== JobStatus.RUNNING &&
    latestGenerationJob?.status !== JobStatus.QUEUED;
  const stateCSecondaryAction =
    stateCAttention.cta === "Open latest pack"
      ? leadRequirement
        ? {
            label: "Continue latest requirement",
            href: `/dashboard/requirements/${leadRequirement.id}`,
          }
        : {
            label: "View all requirements",
            href: "/dashboard/requirements",
          }
      : successfulGenerationJob?.output_pack_id
        ? {
            label: "Open latest pack",
            href: `/dashboard/packs/${successfulGenerationJob.output_pack_id}`,
          }
        : leadRequirement
          ? {
              label: "Continue latest requirement",
              href: `/dashboard/requirements/${leadRequirement.id}`,
            }
          : {
              label: "View all requirements",
              href: "/dashboard/requirements",
            };
  const stateCSupportingSurface =
    successfulGenerationJob?.output_pack_id
      ? {
          eyebrow: "Latest review-ready draft",
          title: leadRequirement?.title ?? "Latest successful draft",
          body:
            currentSucceededJobs.length > 1
              ? `${currentSucceededJobs.length} successful drafts landed in ${selectedRange.label}. Reopen the latest pack or continue the most active requirement from here.`
              : "Your latest successful draft is still the cleanest path back into review.",
          href: stateCSecondaryAction.href,
          cta: stateCSecondaryAction.label,
          meta: `Updated ${leadRequirement ? formatShortDate(leadRequirement.updated_at) : "recently"}`,
        }
      : {
          eyebrow: "Most active requirement",
          title: leadRequirement?.title ?? "Requirement history",
          body:
            "No review-ready pack is ahead of the queue right now. Continue the latest requirement to move the next draft into shape.",
          href: stateCSecondaryAction.href,
          cta: stateCSecondaryAction.label,
          meta: leadRequirement
            ? `Updated ${formatShortDate(leadRequirement.updated_at)}`
            : "Open the workspace requirement list",
        };
  const whatChangedNarrative =
    staleRequirementsCount > 0
      ? `${healthNarrative} ${staleRequirementsCount} active requirement${staleRequirementsCount === 1 ? "" : "s"} have been quiet for more than two weeks.`
      : healthNarrative;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-end">
        <ClientUserButton />
      </div>

      <div className="mx-auto max-w-6xl">
        <div className="overflow-hidden rounded-[2.25rem] border bg-[linear-gradient(180deg,#fffdf8_0%,#f5efe3_100%)] px-6 py-8 shadow-sm sm:px-8 sm:py-10">
          <div className="mt-1">
            <div className="max-w-3xl">
              <p className="text-[11px] font-medium tracking-[0.24em] text-muted-foreground">
                Dashboard
              </p>
              <h1 className="mt-3 max-w-3xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-[2.7rem] sm:leading-[1.02]">
                {heroHeadline}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-[15px]">
                {stateCStrategicLead}
              </p>
            </div>

            <div className="mt-6 flex max-w-4xl flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
              <DashboardRangeSelector initialRange={selectedRange.key} />
              <div className="dashboard-action-rail inline-flex flex-wrap items-center">
                <Button asChild className="h-10 rounded-full px-5" size="lg">
                  <Link href={stateCAttention.href}>{stateCAttention.cta}</Link>
                </Button>
                <Button
                  asChild
                  className="h-10 rounded-full border-black/8 bg-white/76 px-5"
                  size="lg"
                  variant="outline"
                >
                  <Link href={stateCSecondaryAction.href}>
                    {stateCSecondaryAction.label}
                  </Link>
                </Button>
                <details className="dashboard-action-menu group relative">
                  <summary className="dashboard-action-menu__toggle">
                    <span className="sr-only">Open secondary dashboard actions</span>
                    <svg
                      aria-hidden="true"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M6 12h.01M12 12h.01M18 12h.01"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </summary>
                  <div className="dashboard-action-menu__menu">
                    <div className="grid gap-1">
                      <Link
                        className="dashboard-action-menu__item"
                        href="/dashboard/requirements/new"
                      >
                        <span className="dashboard-action-menu__item-icon">
                          <svg
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M12 5v14M5 12h14"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="1.8"
                            />
                          </svg>
                        </span>
                        <span>
                          <span className="dashboard-action-menu__item-label">
                            New requirement
                          </span>
                          <span className="dashboard-action-menu__item-copy">
                            Start another source requirement
                          </span>
                        </span>
                      </Link>
                      <Link
                        className="dashboard-action-menu__item"
                        href="/dashboard/requirements"
                      >
                        <span className="dashboard-action-menu__item-icon">
                          <svg
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M7 6h10M7 12h10M7 18h10"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="1.8"
                            />
                          </svg>
                        </span>
                        <span>
                          <span className="dashboard-action-menu__item-label">
                            View all requirements
                          </span>
                          <span className="dashboard-action-menu__item-copy">
                            Browse active and archived work
                          </span>
                        </span>
                      </Link>
                      {can(membership.role, "audit:view") ? (
                        <Link
                          className="dashboard-action-menu__item"
                          href="/dashboard/audit"
                        >
                          <span className="dashboard-action-menu__item-icon">
                            <svg
                              aria-hidden="true"
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <path
                                d="M12 4.5 18.5 7v5.5c0 4.1-2.7 6.9-6.5 7.9-3.8-1-6.5-3.8-6.5-7.9V7L12 4.5Z"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1.8"
                              />
                            </svg>
                          </span>
                          <span>
                            <span className="dashboard-action-menu__item-label">
                              Open audit log
                            </span>
                            <span className="dashboard-action-menu__item-copy">
                              Review workspace history
                            </span>
                          </span>
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-[1.55rem] border bg-white/72 shadow-sm">
            <div className="grid divide-y divide-black/6 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
              {kpiModules.map((module) => (
                <div
                  className={
                    module.isPriority
                      ? "bg-[linear-gradient(180deg,#fffefb_0%,#f6f0e7_100%)] px-4 py-3.5 ring-1 ring-inset ring-slate-900/5"
                      : "px-4 py-3.5"
                  }
                  key={module.label}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        {module.label}
                      </p>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <p className="text-lg font-semibold tracking-tight text-foreground">
                          {module.value}
                        </p>
                        <span
                          className={`shrink-0 whitespace-nowrap text-xs font-medium ${module.accentClassName}`}
                        >
                          {module.delta}
                        </span>
                      </div>
                    </div>

                    <div className={`h-9 w-20 shrink-0 ${module.accentClassName}`}>
                      <svg
                        className="h-full w-full"
                        preserveAspectRatio="none"
                        viewBox="0 0 100 36"
                      >
                        <line
                          stroke="currentColor"
                          strokeOpacity="0.12"
                          strokeWidth="1"
                          x1="0"
                          x2="100"
                          y1="29"
                          y2="29"
                        />
                        <polyline
                          fill="none"
                          opacity="0.18"
                          points={buildSparklinePoints(module.series)}
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="4.5"
                        />
                        <polyline
                          fill="none"
                          points={buildSparklinePoints(module.series)}
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.3"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
            <div
              className={
                stateCIsHealthy
                  ? "rounded-[1.95rem] border bg-[linear-gradient(180deg,#1c2230_0%,#171b23_100%)] p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.12)]"
                  : `rounded-[1.95rem] border p-6 shadow-sm ${stateCAttention.toneClassName}`
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p
                    className={
                      stateCIsHealthy
                        ? "text-xs font-medium text-white/60"
                        : "text-xs font-medium text-muted-foreground"
                    }
                  >
                    What matters now
                  </p>
                  <h2
                    className={
                      stateCIsHealthy
                        ? "mt-2 text-2xl font-semibold tracking-tight text-white"
                        : "mt-2 text-2xl font-semibold tracking-tight text-foreground"
                    }
                  >
                    {stateCAttention.title}
                  </h2>
                </div>
                <span
                  className={
                    stateCIsHealthy
                      ? "rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs font-medium text-white/88"
                      : "rounded-full border border-black/8 bg-white/72 px-3 py-1 text-xs font-medium text-foreground"
                  }
                >
                  {stateCAttention.eyebrow}
                </span>
              </div>

              <p
                className={
                  stateCIsHealthy
                    ? "mt-3 max-w-2xl text-sm leading-6 text-white/72"
                    : "mt-3 max-w-2xl text-sm leading-6 text-muted-foreground"
                }
              >
                {stateCAttention.body}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div
                  className={
                    stateCIsHealthy
                      ? "rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                      : "rounded-2xl border bg-white/70 px-4 py-3"
                  }
                >
                  <p
                    className={
                      stateCIsHealthy
                        ? "text-xs font-medium text-white/52"
                        : "text-xs font-medium text-muted-foreground"
                    }
                  >
                    Active now
                  </p>
                  <p
                    className={
                      stateCIsHealthy
                        ? "mt-2 text-sm font-medium text-white"
                        : "mt-2 text-sm font-medium text-foreground"
                    }
                  >
                    {activeRunsNow} runs
                  </p>
                </div>
                <div
                  className={
                    stateCIsHealthy
                      ? "rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                      : "rounded-2xl border bg-white/70 px-4 py-3"
                  }
                >
                  <p
                    className={
                      stateCIsHealthy
                        ? "text-xs font-medium text-white/52"
                        : "text-xs font-medium text-muted-foreground"
                    }
                  >
                    Draft success
                  </p>
                  <p
                    className={
                      stateCIsHealthy
                        ? "mt-2 text-sm font-medium text-white"
                        : "mt-2 text-sm font-medium text-foreground"
                    }
                  >
                    {currentSuccessRate !== null ? `${Math.round(currentSuccessRate)}%` : "—"}
                  </p>
                </div>
                <div
                  className={
                    stateCIsHealthy
                      ? "rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                      : "rounded-2xl border bg-white/70 px-4 py-3"
                  }
                >
                  <p
                    className={
                      stateCIsHealthy
                        ? "text-xs font-medium text-white/52"
                        : "text-xs font-medium text-muted-foreground"
                    }
                  >
                    Stale work
                  </p>
                  <p
                    className={
                      stateCIsHealthy
                        ? "mt-2 text-sm font-medium text-white"
                        : "mt-2 text-sm font-medium text-foreground"
                    }
                  >
                    {staleRequirementsCount}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  asChild
                  className={
                    stateCIsHealthy
                      ? "h-10 rounded-full bg-white px-5 text-slate-950 hover:bg-white/92"
                      : "h-10 rounded-full px-5"
                  }
                  size="lg"
                >
                  <Link href={stateCAttention.href}>{stateCAttention.cta}</Link>
                </Button>
                <DashboardSideSheet
                  description={stateCAttention.body}
                  eyebrow={stateCAttention.eyebrow}
                  title={stateCAttention.title}
                  triggerLabel={
                    latestGenerationJob?.status === JobStatus.FAILED
                      ? "Inspect context"
                      : latestGenerationJob?.status === JobStatus.RUNNING ||
                          latestGenerationJob?.status === JobStatus.QUEUED
                        ? "Peek run detail"
                        : "Peek review context"
                  }
                  triggerClassName={
                    stateCIsHealthy
                      ? "h-10 rounded-full border-white/12 bg-white/8 px-5 text-white hover:bg-white/12 hover:text-white"
                      : "h-10 rounded-full border-black/8 bg-white/72 px-5"
                  }
                  triggerSize="lg"
                  triggerVariant="outline"
                >
                  <div className="space-y-5">
                    <div className="rounded-[1.4rem] border bg-white/72 p-4">
                      <p className="text-xs font-medium text-muted-foreground">
                        Priority signal
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <span className="rounded-full border border-black/8 bg-background/90 px-3 py-1">
                          Watching {priorityMetricLabel.toLowerCase()}
                        </span>
                        <span className="rounded-full border border-black/8 bg-background/90 px-3 py-1">
                          {selectedRange.label} vs previous
                        </span>
                        <span className="rounded-full border border-black/8 bg-background/90 px-3 py-1">
                          {activeRunsNow > 0 ? `${activeRunsNow} active now` : "No active runs"}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-[1.2rem] border bg-white/72 px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Success rate
                        </p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          {currentSuccessRate !== null ? `${Math.round(currentSuccessRate)}%` : "—"}
                        </p>
                      </div>
                      <div className="rounded-[1.2rem] border bg-white/72 px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Failed runs
                        </p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          {currentFailedJobs.length}
                        </p>
                      </div>
                      <div className="rounded-[1.2rem] border bg-white/72 px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Stale work
                        </p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          {staleRequirementsCount}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-[1.4rem] border bg-white/72 p-4 text-sm leading-6 text-muted-foreground">
                      {whatChangedNarrative}
                    </div>
                  </div>
                </DashboardSideSheet>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-black/6 bg-white/62 p-5 shadow-sm sm:p-6">
              <p className="text-xs font-medium text-muted-foreground">
                {stateCSupportingSurface.eyebrow}
              </p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-foreground">
                {stateCSupportingSurface.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {stateCSupportingSurface.body}
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {leadRequirement ? <Badge variant="outline">{leadRequirement.module_type}</Badge> : null}
                <span>{stateCSupportingSurface.meta}</span>
                <span>{getCompactRunStatus(latestLeadRun?.status)}</span>
              </div>

              <Button asChild className="mt-5" size="sm" variant="ghost">
                <Link href={stateCSupportingSurface.href}>
                  {stateCSupportingSurface.cta}
                </Link>
              </Button>
            </div>
          </div>

          <DashboardLayerSwitcher
            evidence={
              <div className="space-y-5" key="dashboard-evidence-layer">
                <div
                  className="rounded-[1.85rem] border bg-white/76 p-5 shadow-sm sm:p-6"
                  id="recent-activity"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Evidence feed
                      </p>
                      <h2 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
                        What changed most recently
                      </h2>
                    </div>
                    <span className="rounded-full border border-black/8 bg-white px-3 py-1 text-xs text-muted-foreground">
                      {recentRunSummary.succeeded} success • {recentRunSummary.failed} failed
                      {recentRunSummary.active > 0 ? ` • ${recentRunSummary.active} active` : ""}
                    </span>
                  </div>

                  {recentActivityItems.length > 0 ? (
                    <>
                      {featuredActivityItem ? (
                        <div className="mt-4 rounded-[1.5rem] bg-[linear-gradient(180deg,#fffaf1_0%,#fffefb_100%)] p-4">
                          {(() => {
                            const chip = getRunStatusChip(featuredActivityItem.status);

                            return (
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span
                                      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${chip.className}`}
                                    >
                                      <span
                                        className={`h-2 w-2 rounded-full ${getRunStatusDotClassName(featuredActivityItem.status)}`}
                                      />
                                      <span>{chip.label}</span>
                                    </span>
                                    <span className="text-sm font-medium text-foreground">
                                      {featuredActivityItem.sentence}
                                    </span>
                                  </div>

                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                                    <Link
                                      className="font-medium text-foreground transition-colors hover:text-primary"
                                      href={featuredActivityItem.href}
                                    >
                                      {featuredActivityItem.title}
                                    </Link>
                                    <span className="text-muted-foreground">•</span>
                                    <span className="text-muted-foreground">
                                      {featuredActivityItem.time}
                                    </span>
                                  </div>

                                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                                    {featuredActivityItem.supportingText}
                                  </p>
                                </div>

                                <Button
                                  asChild
                                  className="h-8 rounded-full border-black/8 bg-white/78 px-4 text-foreground hover:bg-white"
                                  size="sm"
                                  variant="outline"
                                >
                                  <Link href={featuredActivityItem.href}>
                                    {featuredActivityItem.actionLabel}
                                  </Link>
                                </Button>
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}

                      <div className="mt-3 divide-y divide-black/6">
                        {remainingActivityItems.map((item) => {
                          const chip = getRunStatusChip(item.status);

                          return (
                            <div
                              className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-start sm:justify-between"
                              key={item.id}
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${chip.className}`}
                                  >
                                    <span
                                      className={`h-2 w-2 rounded-full ${getRunStatusDotClassName(item.status)}`}
                                    />
                                    <span>{chip.label}</span>
                                  </span>
                                  <span className="text-sm font-medium text-foreground">
                                    {item.sentence}
                                  </span>
                                </div>

                                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                                  <Link
                                    className="font-medium text-foreground transition-colors hover:text-primary"
                                    href={item.href}
                                  >
                                    {item.title}
                                  </Link>
                                  <span className="text-muted-foreground">•</span>
                                  <span className="text-muted-foreground">{item.time}</span>
                                </div>

                                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                                  {item.supportingText}
                                </p>
                              </div>

                              <Button
                                asChild
                                className="h-8 rounded-full border-black/8 bg-white/78 px-4 text-foreground hover:bg-white"
                                size="sm"
                                variant="outline"
                              >
                                <Link href={item.href}>{item.actionLabel}</Link>
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="mt-5 text-sm text-muted-foreground">
                      No recent generation activity yet.
                    </div>
                  )}
                </div>

                {recentRequirements.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-muted-foreground">
                        Recent requirements
                      </p>
                      <Button asChild size="sm" variant="ghost">
                        <Link href="/dashboard/requirements">View all requirements</Link>
                      </Button>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {recentRequirements.map((requirement) => (
                        <Link
                          className="rounded-[1.45rem] border bg-white/78 px-4 py-4 transition-colors hover:bg-white"
                          href={`/dashboard/requirements/${requirement.id}`}
                          key={requirement.id}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <Badge variant="outline">{requirement.module_type}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatShortDate(requirement.updated_at)}
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-medium text-foreground">
                            {truncateCopy(requirement.title, 72)}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            }
            initialView={selectedView}
            overview={
              <div
                className="rounded-[1.85rem] border bg-white/76 p-5 shadow-sm sm:p-6"
                key="dashboard-overview-layer"
              >
                <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr] xl:items-start">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Overview
                    </p>
                    <h2 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
                      What changed this {selectedRange.label}
                    </h2>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
                      {whatChangedNarrative}
                    </p>
                  </div>

                  <div className="rounded-[1.5rem] bg-[linear-gradient(180deg,#fffaf1_0%,#fffefb_100%)] p-5">
                    {featuredActivityItem ? (
                      (() => {
                        const chip = getRunStatusChip(featuredActivityItem.status);

                        return (
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${chip.className}`}
                                >
                                  <span
                                    className={`h-2 w-2 rounded-full ${getRunStatusDotClassName(featuredActivityItem.status)}`}
                                  />
                                  <span>{chip.label}</span>
                                </span>
                                <span className="text-sm font-medium text-foreground">
                                  {featuredActivityItem.sentence}
                                </span>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                                <Link
                                  className="font-medium text-foreground transition-colors hover:text-primary"
                                  href={featuredActivityItem.href}
                                >
                                  {featuredActivityItem.title}
                                </Link>
                                <span className="text-muted-foreground">•</span>
                                <span className="text-muted-foreground">
                                  {featuredActivityItem.time}
                                </span>
                              </div>

                              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                                {featuredActivityItem.supportingText}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                asChild
                                className="h-8 rounded-full border-black/8 bg-white/78 px-4 text-foreground hover:bg-white"
                                size="sm"
                                variant="outline"
                              >
                                <Link href={featuredActivityItem.href}>
                                  {featuredActivityItem.actionLabel}
                                </Link>
                              </Button>
                              <DashboardSideSheet
                                description={featuredActivityItem.supportingText}
                                eyebrow="Evidence detail"
                                title={featuredActivityItem.sentence}
                                triggerClassName="h-8 rounded-full border-black/8 bg-white/78 px-4 text-foreground hover:bg-white"
                                triggerLabel="Peek detail"
                                triggerSize="sm"
                                triggerVariant="outline"
                              >
                                <div className="space-y-4">
                                  <div className="rounded-[1.4rem] border bg-white/72 p-4">
                                    <p className="text-xs font-medium text-muted-foreground">
                                      Affected item
                                    </p>
                                    <Link
                                      className="mt-2 block text-base font-semibold text-foreground transition-colors hover:text-primary"
                                      href={featuredActivityItem.href}
                                    >
                                      {featuredActivityItem.title}
                                    </Link>
                                    <p className="mt-2 text-sm text-muted-foreground">
                                      {featuredActivityItem.time}
                                    </p>
                                  </div>

                                  <div className="rounded-[1.4rem] border bg-white/72 p-4 text-sm leading-6 text-muted-foreground">
                                    {featuredActivityItem.supportingText}
                                  </div>
                                </div>
                              </DashboardSideSheet>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No recent generation activity yet.
                      </p>
                    )}
                  </div>
                </div>

                {leadRequirement ? (
                  <div className="mt-5 rounded-[1.45rem] border bg-background/88 px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          Continue from here
                        </p>
                        <Link
                          className="mt-1 block truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
                          href={`/dashboard/requirements/${leadRequirement.id}`}
                        >
                          {leadRequirement.title}
                        </Link>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {getCompactRunStatus(latestLeadRun?.status)} • Updated{" "}
                          {formatShortDate(leadRequirement.updated_at)}
                        </p>
                      </div>

                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/dashboard/requirements/${leadRequirement.id}`}>
                          Open requirement
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            }
            rangeKey={selectedRange.key}
            trends={
              <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]" key="dashboard-trends-layer">
                <div className="rounded-[1.85rem] border bg-white/78 p-5 shadow-sm sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Draft health over time
                      </p>
                      <h2 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
                        Success, failure, and live work across {selectedRange.label}
                      </h2>
                    </div>
                    <span className="rounded-full border border-black/8 bg-white px-3 py-1 text-xs text-muted-foreground">
                      {currentSuccessRate !== null ? `${Math.round(currentSuccessRate)}%` : "—"} success
                    </span>
                  </div>

                  <div className="mt-6 flex h-40 items-end gap-2">
                    {trendBuckets.map((bucket, index) => {
                      const total = Math.max(bucket.total, 1);
                      const showLabel =
                        index === 0 ||
                        index === Math.floor(trendBuckets.length / 2) ||
                        index === trendBuckets.length - 1;

                      return (
                        <div className="flex flex-1 flex-col items-center" key={bucket.label}>
                          <div className="flex h-28 w-full flex-col justify-end overflow-hidden rounded-full bg-muted/35">
                            {bucket.active > 0 ? (
                              <div
                                className="bg-sky-400/75"
                                style={{ height: `${(bucket.active / total) * 100}%` }}
                              />
                            ) : null}
                            {bucket.failed > 0 ? (
                              <div
                                className="bg-amber-400/85"
                                style={{ height: `${(bucket.failed / total) * 100}%` }}
                              />
                            ) : null}
                            {bucket.succeeded > 0 ? (
                              <div
                                className="bg-emerald-500/85"
                                style={{ height: `${(bucket.succeeded / total) * 100}%` }}
                              />
                            ) : null}
                          </div>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            {showLabel ? bucket.label : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500/85" />
                      Success
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-400/85" />
                      Failed
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-sky-400/75" />
                      Active
                    </span>
                  </div>
                </div>

                <div className="rounded-[1.85rem] border bg-[linear-gradient(180deg,#1c2230_0%,#171b23_100%)] p-5 text-white shadow-[0_24px_60px_rgba(15,23,42,0.12)] sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-white/60">
                        What changed this {selectedRange.label}
                      </p>
                      <h2 className="mt-2 text-lg font-semibold tracking-tight text-white">
                        Strategic view
                      </h2>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-white/72">
                      vs previous {selectedRange.label}
                    </span>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-white/72">
                    {whatChangedNarrative}
                  </p>

                  <div className="mt-5 rounded-[1.4rem] border border-white/10 bg-white/6 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-white/52">
                          Median time to successful draft
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-white">
                          {formatDurationMinutes(currentMedianMinutes)}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-white/72">
                        {formatDelta(currentMedianMinutes, previousMedianMinutes, {
                          inverse: true,
                          decimals: 0,
                          unitWord: "m",
                        })}
                      </span>
                    </div>

                    <div className="mt-4 h-12">
                      <svg
                        className="h-full w-full text-white"
                        preserveAspectRatio="none"
                        viewBox="0 0 100 36"
                      >
                        <polyline
                          fill="none"
                          opacity="0.25"
                          points={buildSparklinePoints(successRateSeries)}
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.5"
                        />
                        <polyline
                          fill="none"
                          points={buildSparklinePoints(medianSeries)}
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.5"
                        />
                      </svg>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
                      <p className="text-xs font-medium text-white/52">
                        Review-ready created
                      </p>
                      <p className="mt-2 text-sm font-medium text-white">
                        {currentReviewReadyPacks} in {selectedRange.label}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
                      <p className="text-xs font-medium text-white/52">
                        Stale requirements
                      </p>
                      <p className="mt-2 text-sm font-medium text-white">
                        {staleRequirementsCount} need attention
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            }
          />
        </div>
      </div>
    </section>
  );
}
