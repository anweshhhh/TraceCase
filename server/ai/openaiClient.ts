import "server-only";
import OpenAI from "openai";
import type {
  ResponseFormatTextJSONSchemaConfig,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { getServerEnv } from "@/server/env";

export type AiTokenUsage = Pick<
  ResponseUsage,
  "input_tokens" | "output_tokens" | "total_tokens"
>;

export type StructuredOutputRequest = {
  input: string;
  instructions: string;
  name: string;
  schema: NonNullable<ResponseFormatTextJSONSchemaConfig["schema"]>;
  description?: string;
  model?: string;
  store?: boolean;
};

export type StructuredOutputResult<T> = {
  output: T;
  model: string;
  usage?: AiTokenUsage;
};

export type StructuredOutputRunner = <T>(
  params: StructuredOutputRequest,
) => Promise<StructuredOutputResult<T>>;

let cachedClient: OpenAI | null = null;

function getOpenAiClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const env = getServerEnv();
  cachedClient = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  });

  return cachedClient;
}

function parseStructuredOutput<T>(outputText: string): T {
  try {
    return JSON.parse(outputText) as T;
  } catch {
    throw new Error("OpenAI response returned invalid JSON for structured output.");
  }
}

export const createStructuredOutput: StructuredOutputRunner = async <T>(
  params: StructuredOutputRequest,
) => {
  const { input, instructions, name, schema, description, model, store } =
    params;
  const env = getServerEnv();
  const client = getOpenAiClient();
  const resolvedModel = model ?? env.OPENAI_MODEL;

  const response = await client.responses.create({
    model: resolvedModel,
    instructions,
    input,
    store: store ?? env.OPENAI_STORE,
    text: {
      format: {
        type: "json_schema",
        name,
        description,
        strict: true,
        schema,
      },
    },
  });

  const outputText = response.output_text?.trim();

  if (!outputText) {
    throw new Error("OpenAI response did not include structured output text.");
  }

  return {
    output: parseStructuredOutput<T>(outputText),
    model: response.model ?? resolvedModel,
    usage: response.usage
      ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined,
  };
};
