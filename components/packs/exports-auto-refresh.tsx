"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type ExportsAutoRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
};

export function ExportsAutoRefresh({
  enabled,
  intervalMs = 2000,
}: ExportsAutoRefreshProps) {
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
      Export is in progress. Status updates automatically every 2 seconds.
    </p>
  );
}
