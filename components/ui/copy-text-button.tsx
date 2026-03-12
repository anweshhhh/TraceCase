"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

type CopyTextButtonProps = {
  value: string;
  label?: string;
  size?: "sm" | "default" | "icon";
  variant?: "ghost" | "outline" | "secondary";
  className?: string;
};

export function CopyTextButton({
  value,
  label = "Copy",
  size = "sm",
  variant = "ghost",
  className,
}: CopyTextButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button
      className={className}
      onClick={handleCopy}
      size={size}
      type="button"
      variant={variant}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span>{copied ? "Copied" : label}</span>
    </Button>
  );
}
