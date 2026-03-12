"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  savePackReviewAction,
  validatePackJsonAction,
} from "@/server/pack-review-actions";
import {
  PACK_REVIEW_INITIAL_SAVE_STATE,
  type SavePackReviewState,
  type ValidatePackJsonResult,
} from "@/lib/packs/pack-review-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PackJsonReviewEditorProps = {
  packId: string;
  initialJson: string;
  canSave: boolean;
  canValidate: boolean;
  readOnlyMessage?: string;
};

export function PackJsonReviewEditor({
  packId,
  initialJson,
  canSave,
  canValidate,
  readOnlyMessage,
}: PackJsonReviewEditorProps) {
  const [jsonText, setJsonText] = useState(initialJson);
  const [isExpanded, setIsExpanded] = useState(false);
  const [validateResult, setValidateResult] =
    useState<ValidatePackJsonResult | null>(null);
  const [isValidating, startValidateTransition] = useTransition();
  const [saveState, saveAction, isSaving] = useActionState<SavePackReviewState, FormData>(
    savePackReviewAction.bind(null, packId),
    PACK_REVIEW_INITIAL_SAVE_STATE,
  );
  const editorStorageKey = `tracecase.pack.review.json.${packId}`;

  const handleValidate = () => {
    setValidateResult(null);

    startValidateTransition(async () => {
      const result = await validatePackJsonAction(packId, jsonText);
      setValidateResult(result);

      if (result.ok) {
        setJsonText(result.canonicalJson);
      }
    });
  };

  const saveError = saveState?.error ?? null;
  const saveIssues = Array.isArray(saveState?.issues) ? saveState.issues : [];
  const hasSaveIssues = Boolean(saveError) || saveIssues.length > 0;
  const jsonLineCount = jsonText.split(/\r\n|\n/).length;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedValue = window.localStorage.getItem(editorStorageKey);
    if (storedValue === "true") {
      setIsExpanded(true);
    }
    if (storedValue === "false") {
      setIsExpanded(false);
    }
  }, [editorStorageKey]);

  return (
    <form action={saveAction} className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="pack_json_editor">Pack JSON</Label>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">
              {jsonLineCount} lines | preview collapsed by default
            </p>
            <Button
              aria-expanded={isExpanded}
              onClick={() =>
                setIsExpanded((current) => {
                  const next = !current;
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem(editorStorageKey, String(next));
                  }
                  return next;
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {isExpanded ? "Collapse editor" : "Expand editor"}
            </Button>
          </div>
        </div>
        <Textarea
          className={`field-sizing-fixed font-mono text-xs leading-6 transition-[min-height] duration-200 sm:text-sm ${
            isExpanded ? "min-h-[70vh]" : "min-h-[260px]"
          }`}
          id="pack_json_editor"
          name="content_json"
          onChange={(event) => {
            setJsonText(event.target.value);
          }}
          readOnly={!canSave}
          value={jsonText}
        />
      </div>

      {canValidate || canSave ? (
        <div className="flex flex-wrap items-center gap-2">
          {canValidate ? (
            <Button
              disabled={isValidating || isSaving}
              onClick={handleValidate}
              type="button"
              variant="outline"
            >
              {isValidating ? "Validating..." : "Validate"}
            </Button>
          ) : null}
          {canSave ? (
            <Button disabled={isSaving || isValidating} type="submit">
              {isSaving ? "Saving..." : "Save"}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {readOnlyMessage ??
            "Read-only view. You do not have permission to edit packs."}
        </p>
      )}

      {validateResult ? (
        validateResult.ok ? (
          <div className="rounded-md border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-300">
            {validateResult.message}
          </div>
        ) : (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium text-destructive">{validateResult.error}</p>
            {validateResult.issues.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-destructive">
                {validateResult.issues.map((issue, index) => (
                  <li key={`${issue}-${index}`}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      ) : null}

      {hasSaveIssues ? (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {saveError ? (
            <p className="font-medium text-destructive">{saveError}</p>
          ) : null}
          {saveIssues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-destructive">
              {saveIssues.map((issue, index) => (
                <li key={`${issue}-${index}`}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
