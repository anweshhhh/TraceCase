-- CreateEnum
CREATE TYPE "RequirementArtifactType" AS ENUM ('OPENAPI', 'PRISMA_SCHEMA');

-- CreateTable
CREATE TABLE "RequirementArtifact" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "requirement_snapshot_id" TEXT NOT NULL,
    "type" "RequirementArtifactType" NOT NULL,
    "title" TEXT NOT NULL,
    "content_text" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'text/plain',
    "metadata_json" JSONB,
    "created_by_clerk_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequirementArtifact_workspace_id_requirement_snapshot_id_idx" ON "RequirementArtifact"("workspace_id", "requirement_snapshot_id");

-- CreateIndex
CREATE INDEX "RequirementArtifact_workspace_id_type_idx" ON "RequirementArtifact"("workspace_id", "type");

-- CreateIndex
CREATE INDEX "RequirementArtifact_workspace_id_created_at_idx" ON "RequirementArtifact"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "RequirementArtifact" ADD CONSTRAINT "RequirementArtifact_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementArtifact" ADD CONSTRAINT "RequirementArtifact_requirement_snapshot_id_fkey" FOREIGN KEY ("requirement_snapshot_id") REFERENCES "RequirementSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
