import type { CanonicalPackContent } from "@/server/packs/validatePack";
import {
  type AiTokenUsage,
  type StructuredOutputRunner,
} from "@/server/ai/openaiClient";
import { buildPackPromptSummary } from "@/server/packs/packPromptContext";
import type { AcceptanceCriteriaPlan } from "@/server/packs/acceptanceCriteriaPlanner";
import type { AcceptanceCoverageMap } from "@/server/packs/coverageMap";

export type PackCriticReport = {
  verdict: "pass" | "needs_work";
  coverage: {
    acceptance_criteria_total: number;
    acceptance_criteria_covered: number;
    uncovered: Array<{
      id: string;
      criterion: string;
      why_uncovered: string;
    }>;
  };
  major_risks: string[];
  quality_notes: string[];
};

type CritiquePackInput = {
  requirementSourceText: string;
  acceptanceCriteriaPlan: AcceptanceCriteriaPlan;
  coverageMap: AcceptanceCoverageMap;
  packContent: CanonicalPackContent;
  model?: string;
  runner?: StructuredOutputRunner;
  timeoutMs?: number;
};

const criticSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "coverage", "major_risks", "quality_notes"],
  properties: {
    verdict: {
      type: "string",
      enum: ["pass", "needs_work"],
    },
    coverage: {
      type: "object",
      additionalProperties: false,
      required: [
        "acceptance_criteria_total",
        "acceptance_criteria_covered",
        "uncovered",
      ],
      properties: {
        acceptance_criteria_total: {
          type: "integer",
          minimum: 0,
        },
        acceptance_criteria_covered: {
          type: "integer",
          minimum: 0,
        },
        uncovered: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "criterion", "why_uncovered"],
            properties: {
              id: {
                type: "string",
                pattern: "^AC-\\d{2}$",
              },
              criterion: {
                type: "string",
                minLength: 1,
              },
              why_uncovered: {
                type: "string",
                minLength: 1,
              },
            },
          },
        },
      },
    },
    major_risks: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
      },
    },
    quality_notes: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
      },
    },
  },
} as const;

const criticInstructions = [
  "You are the TraceCase QA pack critic.",
  "Your job is to assess whether the generated pack covers the supplied Acceptance Criteria Coverage Plan in a requirement-specific, non-generic way.",
  "Use only the provided AC ids. Do not invent new AC ids.",
  "Treat the deterministic coverage map as the baseline signal for whether AC ids are referenced, then judge whether that coverage is adequate and non-generic.",
  "Compare the pack against the AC plan and report gaps precisely using the provided AC ids.",
  "Mark verdict as needs_work if the pack is generic, misses requirement-specific behavior, or leaves any criterion uncovered.",
  "Do not invent product behavior that is absent from the requirement.",
].join(" ");

function buildCriticInput(
  requirementSourceText: string,
  acceptanceCriteriaPlan: AcceptanceCriteriaPlan,
  coverageMap: AcceptanceCoverageMap,
  packContent: CanonicalPackContent,
) {
  return [
    "Requirement source text:",
    requirementSourceText,
    "Acceptance criteria coverage plan:",
    JSON.stringify(acceptanceCriteriaPlan, null, 2),
    "Deterministic AC coverage map:",
    JSON.stringify(
      {
        total: coverageMap.total,
        covered: coverageMap.covered,
        uncovered_ids: coverageMap.uncovered_ids,
      },
      null,
      2,
    ),
    "Generated pack summary:",
    buildPackPromptSummary(packContent),
  ].join("\n\n");
}

export async function critiquePack({
  requirementSourceText,
  acceptanceCriteriaPlan,
  coverageMap,
  packContent,
  model,
  runner,
  timeoutMs,
}: CritiquePackInput): Promise<{
  report: PackCriticReport;
  model: string;
  usage?: AiTokenUsage;
}> {
  const resolvedRunner =
    runner ??
    (await import("@/server/ai/openaiClient")).createStructuredOutput;

  const response = await resolvedRunner<PackCriticReport>({
    name: "tracecase_pack_critic_v1",
    description: "Critic report for QA pack requirement coverage.",
    schema: criticSchema,
    instructions: criticInstructions,
    input: buildCriticInput(
      requirementSourceText,
      acceptanceCriteriaPlan,
      coverageMap,
      packContent,
    ),
    model,
    timeoutMs: timeoutMs ?? 90_000,
  });

  return {
    report: response.output,
    model: response.model,
    usage: response.usage,
  };
}
