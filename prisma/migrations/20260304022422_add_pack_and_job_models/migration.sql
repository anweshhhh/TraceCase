-- CreateEnum
CREATE TYPE "PackStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Pack" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "requirement_id" TEXT NOT NULL,
    "requirement_snapshot_id" TEXT NOT NULL,
    "status" "PackStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "schema_version" TEXT NOT NULL,
    "content_json" JSONB NOT NULL,
    "created_by_clerk_user_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_clerk_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "input_requirement_snapshot_id" TEXT NOT NULL,
    "output_pack_id" TEXT,
    "error" TEXT,
    "created_by_clerk_user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pack_workspace_id_requirement_snapshot_id_idx" ON "Pack"("workspace_id", "requirement_snapshot_id");

-- CreateIndex
CREATE INDEX "Pack_workspace_id_created_at_idx" ON "Pack"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "Job_workspace_id_created_at_idx" ON "Job"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "Pack" ADD CONSTRAINT "Pack_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pack" ADD CONSTRAINT "Pack_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pack" ADD CONSTRAINT "Pack_requirement_snapshot_id_fkey" FOREIGN KEY ("requirement_snapshot_id") REFERENCES "RequirementSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
