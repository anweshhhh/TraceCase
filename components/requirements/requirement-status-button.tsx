"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RequirementStatus } from "@prisma/client";
import { setRequirementStatusAction } from "@/server/requirement-actions";
import { Button } from "@/components/ui/button";

type RequirementStatusButtonProps = {
  requirementId: string;
  currentStatus: RequirementStatus;
};

export function RequirementStatusButton({
  requirementId,
  currentStatus,
}: RequirementStatusButtonProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nextStatus: RequirementStatus =
    currentStatus === "ACTIVE" ? "ARCHIVED" : "ACTIVE";

  const label = currentStatus === "ACTIVE" ? "Archive" : "Unarchive";

  const handleClick = () => {
    setServerError(null);

    startTransition(async () => {
      try {
        const result = await setRequirementStatusAction(requirementId, nextStatus);

        if (result.notFound) {
          router.push("/dashboard/requirements");
          return;
        }

        router.refresh();
      } catch {
        setServerError("Unable to update status. Please try again.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <Button
        disabled={isPending}
        onClick={handleClick}
        type="button"
        variant={currentStatus === "ACTIVE" ? "destructive" : "outline"}
      >
        {isPending ? "Updating..." : label}
      </Button>
      {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
    </div>
  );
}
