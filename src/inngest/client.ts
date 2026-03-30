import { EventSchemas, Inngest } from "inngest";
import {
  EXPORT_PACK_EVENT,
  GENERATE_PACK_EVENT,
  type ExportPackEventData,
  type GeneratePackEventData,
} from "@/src/inngest/events";
import { getServerEnv } from "@/server/env";

type InngestEvents = {
  [GENERATE_PACK_EVENT]: {
    data: GeneratePackEventData;
  };
  [EXPORT_PACK_EVENT]: {
    data: ExportPackEventData;
  };
};

const env = getServerEnv();
const isDev = env.INNGEST_DEV === "1";
const baseUrlFromEnv = env.INNGEST_BASE_URL?.trim();
const localDevBaseUrl = "http://127.0.0.1:8288";
const baseUrl = baseUrlFromEnv || (isDev ? localDevBaseUrl : undefined);

export const inngest = new Inngest({
  id: "tracecase",
  schemas: new EventSchemas().fromRecord<InngestEvents>(),
  isDev,
  ...(baseUrl ? { baseUrl } : {}),
});
