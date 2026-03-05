"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import type { RequirementPayload } from "@/lib/validators/requirements";
import {
  MODULE_TYPES,
  requirementPayloadSchema,
  TEST_FOCUS_OPTIONS,
} from "@/lib/validators/requirements";
import {
  createRequirementAction,
  updateRequirementAction,
} from "@/server/requirement-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

type RequirementFormProps = {
  mode: "create" | "edit";
  requirementId?: string;
  initialValues?: RequirementPayload;
};

const defaultValues: RequirementPayload = {
  title: "",
  module_type: "GENERIC",
  test_focus: [],
  source_text: "",
};

export function RequirementForm({
  mode,
  requirementId,
  initialValues = defaultValues,
}: RequirementFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<RequirementPayload>({
    resolver: zodResolver(requirementPayloadSchema),
    defaultValues: initialValues,
  });

  const onSubmit = (values: RequirementPayload) => {
    setServerError(null);

    startTransition(async () => {
      try {
        if (mode === "create") {
          const result = await createRequirementAction(values);
          router.push(`/dashboard/requirements/${result.id}`);
          return;
        }

        if (!requirementId) {
          throw new Error("Requirement id is missing.");
        }

        const result = await updateRequirementAction(requirementId, values);

        if (result.notFound) {
          router.push("/dashboard/requirements");
          return;
        }

        router.refresh();
      } catch {
        setServerError("Unable to save requirement. Please try again.");
      }
    });
  };

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" placeholder="e.g. Login with email + MFA" {...form.register("title")} />
        {form.formState.errors.title ? (
          <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="module_type">Module Type</Label>
        <Controller
          control={form.control}
          name="module_type"
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger id="module_type" className="w-full">
                <SelectValue placeholder="Select module type" />
              </SelectTrigger>
              <SelectContent>
                {MODULE_TYPES.map((moduleType) => (
                  <SelectItem key={moduleType} value={moduleType}>
                    {moduleType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-3">
        <Label>Test Focus</Label>
        <Controller
          control={form.control}
          name="test_focus"
          render={({ field }) => (
            <div className="grid gap-3 sm:grid-cols-2">
              {TEST_FOCUS_OPTIONS.map((focus) => (
                <div key={focus} className="flex items-center gap-2">
                  <Checkbox
                    checked={field.value.includes(focus)}
                    id={`test_focus_${focus}`}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        field.onChange([...field.value, focus]);
                        return;
                      }
                      field.onChange(field.value.filter((item) => item !== focus));
                    }}
                  />
                  <Label htmlFor={`test_focus_${focus}`}>{focus}</Label>
                </div>
              ))}
            </div>
          )}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="source_text">Source Text</Label>
        <Textarea
          id="source_text"
          placeholder="Paste requirement details, flows, acceptance criteria, edge cases..."
          rows={12}
          {...form.register("source_text")}
        />
        {form.formState.errors.source_text ? (
          <p className="text-xs text-destructive">{form.formState.errors.source_text.message}</p>
        ) : null}
      </div>

      {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}

      <Button disabled={isPending} type="submit">
        {isPending
          ? "Saving..."
          : mode === "create"
            ? "Create Requirement"
            : "Save Changes"}
      </Button>
    </form>
  );
}
