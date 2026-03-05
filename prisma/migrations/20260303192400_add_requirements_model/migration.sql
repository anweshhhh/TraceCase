-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ModuleType" AS ENUM ('GENERIC', 'LOGIN', 'SIGNUP', 'PAYMENTS', 'CRUD', 'API', 'ETL');

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "module_type" "ModuleType" NOT NULL DEFAULT 'GENERIC',
    "test_focus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_text" TEXT NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_clerk_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Requirement_workspace_id_created_at_idx" ON "Requirement"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "Requirement_workspace_id_status_idx" ON "Requirement"("workspace_id", "status");

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
