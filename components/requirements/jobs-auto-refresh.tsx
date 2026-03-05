"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type JobsAutoRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
};

export function JobsAutoRefresh({
  enabled,
  intervalMs = 2000,
}: JobsAutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const intervalId = setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [enabled, intervalMs, router]);

  if (!enabled) {
    return null;
  }

  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Generation is in progress. Status updates automatically every 2 seconds.
    </p>
  );
}
