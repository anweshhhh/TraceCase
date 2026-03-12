"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ExpandablePreviewProps = {
  children: ReactNode;
  summary?: string;
  collapsedHeightClassName?: string;
  expandedHeightClassName?: string;
  contentClassName?: string;
  expandLabel?: string;
  collapseLabel?: string;
  storageKey?: string;
  defaultExpanded?: boolean;
};

export function ExpandablePreview({
  children,
  summary,
  collapsedHeightClassName = "max-h-[16rem]",
  expandedHeightClassName = "max-h-[75vh]",
  contentClassName = "",
  expandLabel = "Expand",
  collapseLabel = "Collapse",
  storageKey,
  defaultExpanded = false,
}: ExpandablePreviewProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const contentId = useId();

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") {
      return;
    }

    const storedValue = window.localStorage.getItem(storageKey);

    if (storedValue === "true") {
      setIsExpanded(true);
    }

    if (storedValue === "false") {
      setIsExpanded(false);
    }
  }, [storageKey]);

  const toggleExpanded = () => {
    setIsExpanded((current) => {
      const next = !current;

      if (storageKey && typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, String(next));
      }

      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {summary ?? "Preview is collapsed by default."}
        </p>
        <Button
          aria-controls={contentId}
          aria-expanded={isExpanded}
          onClick={toggleExpanded}
          size="sm"
          type="button"
          variant="outline"
        >
          {isExpanded ? collapseLabel : expandLabel}
        </Button>
      </div>
      <div className="relative rounded-md border bg-muted/10">
        <div
          className={`p-3 ${
            isExpanded
              ? `${expandedHeightClassName} overflow-auto`
              : `${collapsedHeightClassName} overflow-hidden`
          } ${contentClassName}`.trim()}
          id={contentId}
        >
          {children}
        </div>
        {!isExpanded ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 rounded-b-md bg-gradient-to-t from-background via-background/95 to-transparent" />
        ) : null}
      </div>
    </div>
  );
}
