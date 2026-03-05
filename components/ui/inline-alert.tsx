import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type InlineAlertProps = {
  children: ReactNode;
  className?: string;
};

function InlineAlertBase({
  children,
  className,
  tone,
}: InlineAlertProps & {
  tone: "success" | "error" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-300"
      : tone === "error"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-primary/20 bg-primary/5 text-foreground";

  return (
    <div className={cn("rounded-md border p-3 text-sm", toneClass, className)}>
      {children}
    </div>
  );
}

export function SuccessAlert(props: InlineAlertProps) {
  return <InlineAlertBase tone="success" {...props} />;
}

export function ErrorAlert(props: InlineAlertProps) {
  return <InlineAlertBase tone="error" {...props} />;
}

export function InfoAlert(props: InlineAlertProps) {
  return <InlineAlertBase tone="info" {...props} />;
}
