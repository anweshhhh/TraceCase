-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "metadata_json" JSONB,
ALTER COLUMN "input_requirement_snapshot_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "content_type" TEXT NOT NULL DEFAULT 'text/csv',
    "file_name" TEXT NOT NULL,
    "content_text" TEXT,
    "error" TEXT,
    "created_by_clerk_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Export_workspace_id_created_at_idx" ON "Export"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "Export_workspace_id_pack_id_idx" ON "Export"("workspace_id", "pack_id");

-- CreateIndex
CREATE INDEX "Export_workspace_id_status_idx" ON "Export"("workspace_id", "status");

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "Pack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
