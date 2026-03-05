import { EXPORT_PACK_EVENT } from "@/server/exports/constants";

export type GeneratePackEventData = {
  workspaceId: string;
  jobId: string;
};

export type ExportPackEventData = {
  workspaceId: string;
  jobId: string;
  exportId: string;
};

export const GENERATE_PACK_EVENT = "pack/generate.requested" as const;
export { EXPORT_PACK_EVENT };
