"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

type PendingSubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
};

export function PendingSubmitButton({
  idleLabel,
  pendingLabel,
  variant = "default",
  size = "default",
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} size={size} type="submit" variant={variant}>
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
