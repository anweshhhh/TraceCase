"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { Input } from "@/components/ui/input";
import { ErrorAlert, InfoAlert } from "@/components/ui/inline-alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getRequirementArtifactDefaultTitle,
  getRequirementArtifactTypeLabel,
} from "@/lib/artifacts";
import {
  buildRequirementArtifactsPanelViewModel,
  type RequirementArtifactPanelInput,
} from "@/lib/requirementArtifacts";
import {
  REQUIREMENT_ARTIFACT_TYPES,
  type RequirementArtifactTypeValue,
} from "@/lib/validators/requirementArtifacts";
import {
  createRequirementArtifactAction,
  deleteRequirementArtifactAction,
  updateRequirementArtifactAction,
} from "@/server/requirement-artifact-actions";

export type RequirementArtifactListItem = RequirementArtifactPanelInput;

type RequirementArtifactsPanelProps = {
  snapshotId: string | null;
  snapshotVersion: number | null;
  artifacts: RequirementArtifactListItem[];
  canEdit: boolean;
};

type ArtifactDraft = {
  artifactId?: string;
  type: RequirementArtifactTypeValue;
  title: string;
  content_text: string;
};

function createDraft(type: RequirementArtifactTypeValue = "OPENAPI"): ArtifactDraft {
  return {
    type,
    title: getRequirementArtifactDefaultTitle(type),
    content_text: "",
  };
}

function buildEditDraft(artifact: RequirementArtifactListItem): ArtifactDraft {
  return {
    artifactId: artifact.id,
    type: artifact.type,
    title: artifact.title,
    content_text: artifact.content_text,
  };
}

export function RequirementArtifactsPanel({
  snapshotId,
  snapshotVersion,
  artifacts,
  canEdit,
}: RequirementArtifactsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<ArtifactDraft | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canCreate = Boolean(snapshotId) && canEdit;
  const artifactList = buildRequirementArtifactsPanelViewModel({
    artifacts,
    canEdit,
  });

  const updateDraftType = (nextType: RequirementArtifactTypeValue) => {
    setDraft((currentDraft) => {
      if (!currentDraft) {
        return createDraft(nextType);
      }

      const previousDefault = getRequirementArtifactDefaultTitle(currentDraft.type);
      const nextDefault = getRequirementArtifactDefaultTitle(nextType);
      const shouldReplaceTitle =
        currentDraft.title.trim().length === 0 || currentDraft.title === previousDefault;

      return {
        ...currentDraft,
        type: nextType,
        title: shouldReplaceTitle ? nextDefault : currentDraft.title,
      };
    });
  };

  const handleSave = () => {
    if (!draft || !snapshotId) {
      return;
    }

    setServerError(null);
    setSuccessMessage(null);

    startTransition(async () => {
      try {
        if (draft.artifactId) {
          await updateRequirementArtifactAction(draft.artifactId, {
            type: draft.type,
            title: draft.title,
            content_text: draft.content_text,
          });
          setSuccessMessage("Artifact updated.");
        } else {
          await createRequirementArtifactAction(snapshotId, {
            type: draft.type,
            title: draft.title,
            content_text: draft.content_text,
          });
          setSuccessMessage("Artifact created.");
        }

        setDraft(null);
        router.refresh();
      } catch (error) {
        if (error instanceof Error && error.message.trim().length > 0) {
          setServerError(error.message.slice(0, 260));
          return;
        }

        setServerError("Unable to save artifact. Please try again.");
      }
    });
  };

  const handleDelete = (artifactId: string) => {
    if (!window.confirm("Delete this artifact?")) {
      return;
    }

    setServerError(null);
    setSuccessMessage(null);

    startTransition(async () => {
      try {
        await deleteRequirementArtifactAction(artifactId);
        if (draft?.artifactId === artifactId) {
          setDraft(null);
        }
        setSuccessMessage("Artifact deleted.");
        router.refresh();
      } catch (error) {
        if (error instanceof Error && error.message.trim().length > 0) {
          setServerError(error.message.slice(0, 260));
          return;
        }

        setServerError("Unable to delete artifact. Please try again.");
      }
    });
  };

  return (
    <div className="mt-4 space-y-4">
      {successMessage ? <InfoAlert>{successMessage}</InfoAlert> : null}
      {serverError ? <ErrorAlert>{serverError}</ErrorAlert> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {snapshotVersion
            ? `Artifacts in v1 attach to the latest snapshot (v${snapshotVersion}).`
            : "Save requirement source text first to create a snapshot before adding artifacts."}
        </p>
        {canEdit ? (
          <Button
            disabled={!canCreate || isPending}
            onClick={() => {
              setServerError(null);
              setSuccessMessage(null);
              setDraft(createDraft());
            }}
            type="button"
            variant="outline"
          >
            Add Artifact
          </Button>
        ) : null}
      </div>

      {artifactList.items.length > 0 ? (
        <div className="space-y-2">
          {artifactList.items.map((artifact) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-3"
              key={artifact.id}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{artifact.title}</p>
                  <Badge variant="outline">{artifact.typeLabel}</Badge>
                  <Badge variant="outline">{artifact.parseStatusLabel}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Updated {artifact.updatedLabel} • hash {artifact.hashPrefix}
                </p>
                <p className="text-xs text-muted-foreground">
                  {artifact.parseSummaryText}
                </p>
                {artifact.parseErrorPreview ? (
                  <p className="text-xs text-destructive">
                    {artifact.parseErrorPreview}
                  </p>
                ) : null}
              </div>
              {artifact.canEdit ? (
                <div className="flex items-center gap-2">
                  <CopyTextButton
                    label="Copy Hash"
                    size="sm"
                    value={artifact.content_hash}
                    variant="ghost"
                  />
                  <Button
                    disabled={isPending}
                    onClick={() => {
                      setServerError(null);
                      setSuccessMessage(null);
                      setDraft(buildEditDraft(artifact));
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Edit
                  </Button>
                  <Button
                    disabled={isPending}
                    onClick={() => handleDelete(artifact.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{artifactList.emptyMessage}</p>
      )}

      {draft ? (
        <form
          className="space-y-4 rounded-md border bg-muted/10 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="artifact_type">Type</Label>
              <Select
                onValueChange={(value) =>
                  updateDraftType(value as RequirementArtifactTypeValue)
                }
                value={draft.type}
              >
                <SelectTrigger id="artifact_type">
                  <SelectValue placeholder="Select artifact type" />
                </SelectTrigger>
                <SelectContent>
                  {REQUIREMENT_ARTIFACT_TYPES.map((artifactType) => (
                    <SelectItem key={artifactType} value={artifactType}>
                      {getRequirementArtifactTypeLabel(artifactType)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="artifact_title">Title</Label>
              <Input
                id="artifact_title"
                onChange={(event) =>
                  setDraft((currentDraft) =>
                    currentDraft
                      ? {
                          ...currentDraft,
                          title: event.target.value,
                        }
                      : currentDraft,
                  )
                }
                placeholder={getRequirementArtifactDefaultTitle(draft.type)}
                value={draft.title}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Defaults to a type-based label if left blank.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="artifact_content">Content</Label>
            <Textarea
              id="artifact_content"
              onChange={(event) =>
                setDraft((currentDraft) =>
                  currentDraft
                    ? {
                        ...currentDraft,
                        content_text: event.target.value,
                      }
                    : currentDraft,
                )
              }
              placeholder="Paste OpenAPI YAML/JSON or Prisma schema text here."
              rows={14}
              value={draft.content_text}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={isPending}
              onClick={() => {
                setDraft(null);
                setServerError(null);
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isPending || !snapshotId} type="submit">
              {isPending
                ? "Saving..."
                : draft.artifactId
                  ? "Save Artifact"
                  : "Add Artifact"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
