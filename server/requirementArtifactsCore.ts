import {
  buildRequirementArtifactAuditMetadata,
  prepareRequirementArtifactForWrite,
  type ArtifactParseSummary,
} from "@/lib/requirementArtifacts";
import type {
  RequirementArtifactPayload,
  RequirementArtifactTypeValue,
} from "@/lib/validators/requirementArtifacts";

export class RequirementArtifactNotFoundError extends Error {
  constructor() {
    super("Requirement artifact not found.");
    this.name = "RequirementArtifactNotFoundError";
  }
}

export class RequirementArtifactSnapshotNotFoundError extends Error {
  constructor() {
    super("Requirement snapshot not found.");
    this.name = "RequirementArtifactSnapshotNotFoundError";
  }
}

export class RequirementArtifactPermissionError extends Error {
  constructor() {
    super("You do not have permission to modify requirement artifacts.");
    this.name = "RequirementArtifactPermissionError";
  }
}

type RequirementArtifactSnapshotRecord = {
  id: string;
  requirement_id: string;
};

export type RequirementArtifactRecord = {
  id: string;
  requirement_snapshot_id: string;
  type: RequirementArtifactTypeValue;
  title: string;
  content_text: string;
  content_hash: string;
  mime_type: string;
  metadata_json: unknown | null;
  created_at: Date;
  updated_at: Date;
};

type RequirementArtifactLookupRecord = {
  id: string;
  requirement_snapshot_id: string;
  type: RequirementArtifactTypeValue;
  title: string;
  content_hash: string;
  requirement_snapshot: {
    requirement_id: string;
  };
};

type CreateRequirementArtifactData = {
  workspace_id: string;
  requirement_snapshot_id: string;
  type: RequirementArtifactTypeValue;
  title: string;
  content_text: string;
  content_hash: string;
  mime_type: string;
  metadata_json: ArtifactParseSummary;
  created_by_clerk_user_id: string;
};

type UpdateRequirementArtifactData = {
  type: RequirementArtifactTypeValue;
  title: string;
  content_text: string;
  content_hash: string;
  mime_type: string;
  metadata_json: ArtifactParseSummary;
};

export type RequirementArtifactServiceDeps = {
  assertCanEdit: (workspaceId: string, actorId: string) => Promise<void>;
  parseArtifact: (input: {
    type: RequirementArtifactTypeValue;
    contentText: string;
  }) => Promise<ArtifactParseSummary>;
  listArtifacts: (
    workspaceId: string,
    snapshotId: string,
  ) => Promise<RequirementArtifactRecord[]>;
  findSnapshot: (
    workspaceId: string,
    snapshotId: string,
  ) => Promise<RequirementArtifactSnapshotRecord | null>;
  createArtifact: (
    data: CreateRequirementArtifactData,
  ) => Promise<RequirementArtifactRecord>;
  findArtifact: (
    workspaceId: string,
    artifactId: string,
  ) => Promise<RequirementArtifactLookupRecord | null>;
  updateArtifact: (
    artifactId: string,
    data: UpdateRequirementArtifactData,
  ) => Promise<RequirementArtifactRecord>;
  deleteArtifact: (artifactId: string) => Promise<void>;
  logAuditEvent: (event: {
    workspaceId: string;
    actorClerkUserId: string;
    action: string;
    entityType: "requirement_artifact";
    entityId: string;
    metadata: ReturnType<typeof buildRequirementArtifactAuditMetadata>;
  }) => Promise<void>;
};

export async function listRequirementArtifactsWithDeps(
  deps: RequirementArtifactServiceDeps,
  workspaceId: string,
  snapshotId: string,
) {
  return deps.listArtifacts(workspaceId, snapshotId);
}

export async function createRequirementArtifactWithDeps(
  deps: RequirementArtifactServiceDeps,
  workspaceId: string,
  actorId: string,
  snapshotId: string,
  payload: RequirementArtifactPayload,
) {
  await deps.assertCanEdit(workspaceId, actorId);
  const artifactData = prepareRequirementArtifactForWrite(payload);
  const parseSummary = await deps.parseArtifact({
    type: artifactData.type,
    contentText: artifactData.content_text,
  });

  const snapshot = await deps.findSnapshot(workspaceId, snapshotId);

  if (!snapshot) {
    throw new RequirementArtifactSnapshotNotFoundError();
  }

  const artifact = await deps.createArtifact({
    workspace_id: workspaceId,
    requirement_snapshot_id: snapshot.id,
    type: artifactData.type,
    title: artifactData.title,
    content_text: artifactData.content_text,
    content_hash: artifactData.content_hash,
    mime_type: artifactData.mime_type,
    metadata_json: parseSummary,
    created_by_clerk_user_id: actorId,
  });

  await deps.logAuditEvent({
    workspaceId,
    actorClerkUserId: actorId,
    action: "requirement_artifact.created",
    entityType: "requirement_artifact",
    entityId: artifact.id,
    metadata: buildRequirementArtifactAuditMetadata(artifact),
  });

  return {
    artifact,
    requirementId: snapshot.requirement_id,
  };
}

export async function updateRequirementArtifactWithDeps(
  deps: RequirementArtifactServiceDeps,
  workspaceId: string,
  actorId: string,
  artifactId: string,
  payload: RequirementArtifactPayload,
) {
  await deps.assertCanEdit(workspaceId, actorId);
  const artifactData = prepareRequirementArtifactForWrite(payload);
  const parseSummary = await deps.parseArtifact({
    type: artifactData.type,
    contentText: artifactData.content_text,
  });
  const existingArtifact = await deps.findArtifact(workspaceId, artifactId);

  if (!existingArtifact) {
    throw new RequirementArtifactNotFoundError();
  }

  const artifact = await deps.updateArtifact(artifactId, {
    type: artifactData.type,
    title: artifactData.title,
    content_text: artifactData.content_text,
    content_hash: artifactData.content_hash,
    mime_type: artifactData.mime_type,
    metadata_json: parseSummary,
  });

  await deps.logAuditEvent({
    workspaceId,
    actorClerkUserId: actorId,
    action: "requirement_artifact.updated",
    entityType: "requirement_artifact",
    entityId: artifact.id,
    metadata: buildRequirementArtifactAuditMetadata(artifact),
  });

  return {
    artifact,
    requirementId: existingArtifact.requirement_snapshot.requirement_id,
  };
}

export async function deleteRequirementArtifactWithDeps(
  deps: RequirementArtifactServiceDeps,
  workspaceId: string,
  actorId: string,
  artifactId: string,
) {
  await deps.assertCanEdit(workspaceId, actorId);
  const existingArtifact = await deps.findArtifact(workspaceId, artifactId);

  if (!existingArtifact) {
    throw new RequirementArtifactNotFoundError();
  }

  await deps.deleteArtifact(artifactId);

  await deps.logAuditEvent({
    workspaceId,
    actorClerkUserId: actorId,
    action: "requirement_artifact.deleted",
    entityType: "requirement_artifact",
    entityId: existingArtifact.id,
    metadata: buildRequirementArtifactAuditMetadata(existingArtifact),
  });

  return {
    requirementId: existingArtifact.requirement_snapshot.requirement_id,
  };
}
