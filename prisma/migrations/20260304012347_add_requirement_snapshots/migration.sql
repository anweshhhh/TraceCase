-- CreateTable
CREATE TABLE "RequirementSnapshot" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "requirement_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source_text" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "created_by_clerk_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequirementSnapshot_workspace_id_requirement_id_idx" ON "RequirementSnapshot"("workspace_id", "requirement_id");

-- CreateIndex
CREATE INDEX "RequirementSnapshot_workspace_id_created_at_idx" ON "RequirementSnapshot"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementSnapshot_requirement_id_version_key" ON "RequirementSnapshot"("requirement_id", "version");

-- AddForeignKey
ALTER TABLE "RequirementSnapshot" ADD CONSTRAINT "RequirementSnapshot_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementSnapshot" ADD CONSTRAINT "RequirementSnapshot_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
