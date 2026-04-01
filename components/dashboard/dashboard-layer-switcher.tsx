"use client";

import type { ReactNode } from "react";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DashboardViewKey = "overview" | "trends" | "evidence";
type DashboardRangeKey = "7d" | "30d" | "quarter";

type DashboardLayerSwitcherProps = {
  initialView: DashboardViewKey;
  rangeKey: DashboardRangeKey;
  overview: ReactNode;
  trends: ReactNode;
  evidence: ReactNode;
};

type DashboardRangeSelectorProps = {
  initialRange: DashboardRangeKey;
};

type DashboardSideSheetProps = {
  triggerLabel: string;
  title: string;
  eyebrow?: string;
  description?: string;
  children?: ReactNode;
  triggerVariant?: "default" | "outline" | "ghost";
  triggerSize?: "default" | "sm" | "lg";
  triggerClassName?: string;
};

function DashboardSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (nextValue: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-full border border-black/8 bg-white/82 p-1 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-sm"
      role="tablist"
    >
      {options.map((item) => (
        <button
          className={cn(
            "inline-flex h-9 min-w-[3.25rem] appearance-none items-center justify-center whitespace-nowrap rounded-full border border-transparent px-3.5 text-sm font-medium text-slate-600 transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 hover:bg-black/4 hover:text-slate-900",
            value === item.key &&
              "border-black/8 bg-slate-950 text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_10px_24px_rgba(15,23,42,0.12)] hover:bg-slate-950 hover:text-white",
          )}
          aria-pressed={value === item.key}
          key={item.key}
          onClick={() => onChange(item.key)}
          role="tab"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function DashboardRangeSelector({
  initialRange,
}: DashboardRangeSelectorProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [range, setRange] = useState<DashboardRangeKey>(initialRange);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setRange(initialRange);
  }, [initialRange]);

  const setNextRange = (nextRange: DashboardRangeKey) => {
    setRange(nextRange);
    startTransition(() => {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("range", nextRange);

      if (!nextUrl.searchParams.get("view")) {
        nextUrl.searchParams.set("view", "overview");
      }

      router.replace(`${pathname}?${nextUrl.searchParams.toString()}`, {
        scroll: false,
      });
    });
  };

  return (
    <DashboardSegmentedControl
      ariaLabel="Dashboard time range"
      onChange={setNextRange}
      options={[
        { key: "7d", label: "7d" },
        { key: "30d", label: "30d" },
        { key: "quarter", label: "Quarter" },
      ]}
      value={range}
    />
  );
}

export function DashboardLayerSwitcher({
  initialView,
  rangeKey,
  overview,
  trends,
  evidence,
}: DashboardLayerSwitcherProps) {
  const pathname = usePathname();
  const [view, setView] = useState<DashboardViewKey>(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const setLayer = (nextView: DashboardViewKey) => {
    setView(nextView);

    if (typeof window === "undefined") {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("range", rangeKey);
    nextUrl.searchParams.set("view", nextView);
    window.history.replaceState({}, "", `${pathname}?${nextUrl.searchParams.toString()}`);
  };

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Deeper view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open the layer you need without leaving the dashboard flow.
          </p>
        </div>

        <DashboardSegmentedControl
          ariaLabel="Dashboard detail layer"
          onChange={setLayer}
          options={[
            { key: "overview", label: "Overview" },
            { key: "trends", label: "Trends" },
            { key: "evidence", label: "Evidence" },
          ]}
          value={view}
        />
      </div>

      <div className="mt-4">
        {view === "overview" ? overview : null}
        {view === "trends" ? trends : null}
        {view === "evidence" ? evidence : null}
      </div>
    </div>
  );
}

export function DashboardSideSheet({
  triggerLabel,
  title,
  eyebrow,
  description,
  children,
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
}: DashboardSideSheetProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <>
      <Button
        className={cn("rounded-full", triggerClassName)}
        onClick={() => setOpen(true)}
        size={triggerSize}
        type="button"
        variant={triggerVariant}
      >
        {triggerLabel}
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            aria-label="Close details"
            className="absolute inset-0 bg-[rgba(15,23,42,0.22)] backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            type="button"
          />

          <div
            aria-modal="true"
            className="relative flex h-full w-full max-w-xl flex-col border-l border-black/8 bg-[linear-gradient(180deg,#fffdf8_0%,#f5efe3_100%)] shadow-[0_30px_90px_rgba(15,23,42,0.18)]"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b border-black/6 px-6 py-5">
              <div>
                {eyebrow ? (
                  <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
                ) : null}
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
                {description ? (
                  <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                    {description}
                  </p>
                ) : null}
              </div>

              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/8 bg-white/76 text-foreground transition-colors hover:bg-white"
                onClick={() => setOpen(false)}
                type="button"
              >
                <span className="sr-only">Close details</span>
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M6 6l12 12M18 6 6 18"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
