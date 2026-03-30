import type {
  AcceptanceCriterion,
  AcceptanceCriterionLayer,
} from "@/server/packs/acceptanceCriteriaPlanner";

export type CoverageClosureRequiredAction =
  | "add_ui_case"
  | "add_api_case_or_check"
  | "add_sql_case_or_check"
  | "add_audit_or_logging_check"
  | "add_session_case_or_check"
  | "strengthen_existing_coverage";

export type CoverageClosurePlan = {
  uncovered_ids: string[];
  obligations: Array<{
    id: string;
    criterion: string;
    expected_layers: AcceptanceCriterionLayer[];
    required_action: CoverageClosureRequiredAction;
  }>;
};

type UncoveredAcceptanceCriterion = {
  id: string;
  criterion: string;
  why_uncovered: string;
};

function getRequiredAction(
  expectedLayers: AcceptanceCriterionLayer[],
): CoverageClosureRequiredAction {
  if (expectedLayers.includes("UI")) {
    return "add_ui_case";
  }

  if (expectedLayers.includes("API")) {
    return "add_api_case_or_check";
  }

  if (expectedLayers.includes("AUDIT")) {
    return "add_audit_or_logging_check";
  }

  if (expectedLayers.includes("SESSION")) {
    return "add_session_case_or_check";
  }

  if (expectedLayers.includes("SQL")) {
    return "add_sql_case_or_check";
  }

  return "strengthen_existing_coverage";
}

export function buildCoverageClosurePlan(
  criteria: AcceptanceCriterion[],
  uncovered: UncoveredAcceptanceCriterion[],
): CoverageClosurePlan {
  const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const obligations = uncovered
    .filter(
      (item, index, array) =>
        array.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .map((item) => {
      const criterion = criterionById.get(item.id);
      const expectedLayers = criterion?.expected_layers ?? ["OTHER"];

      return {
        id: item.id,
        criterion: criterion?.text ?? item.criterion.trim(),
        expected_layers: expectedLayers,
        required_action: getRequiredAction(expectedLayers),
      };
    });

  return {
    uncovered_ids: obligations.map((obligation) => obligation.id),
    obligations,
  };
}

export function formatCoverageClosurePlan(plan: CoverageClosurePlan) {
  return plan.obligations
    .map(
      (obligation) =>
        `${obligation.id} [${obligation.expected_layers.join(", ")}] ${obligation.required_action}: ${obligation.criterion}`,
    )
    .join("\n");
}
