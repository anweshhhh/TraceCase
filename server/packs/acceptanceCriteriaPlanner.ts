export const ACCEPTANCE_CRITERION_LAYERS = [
  "UI",
  "API",
  "SQL",
  "AUDIT",
  "SECURITY",
  "SESSION",
  "OTHER",
] as const;

export type AcceptanceCriterionLayer =
  (typeof ACCEPTANCE_CRITERION_LAYERS)[number];

export type AcceptanceCriterion = {
  id: string;
  text: string;
  expected_layers: AcceptanceCriterionLayer[];
};

export type AcceptanceCriteriaPlan = {
  criteria_total: number;
  criteria: AcceptanceCriterion[];
};

const ACCEPTANCE_CRITERIA_HEADER_PATTERN =
  /^\s*acceptance criteria\s*:\s*$/i;
const MAJOR_SECTION_HEADER_PATTERN =
  /^\s*[A-Z][A-Za-z0-9 /&()_-]{1,80}:\s*$/;
const LIST_ITEM_PATTERN = /^\s*(?:\d+[\.\)]|[-*])\s+(.*)$/;
const LAYER_ORDER: AcceptanceCriterionLayer[] = [
  "UI",
  "API",
  "SQL",
  "AUDIT",
  "SECURITY",
  "SESSION",
  "OTHER",
];

function normalizeCriterionText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function formatCriterionId(index: number) {
  return `AC-${String(index + 1).padStart(2, "0")}`;
}

function inferExpectedLayers(text: string): AcceptanceCriterionLayer[] {
  const normalized = text.toLowerCase();
  const layers = new Set<AcceptanceCriterionLayer>();

  if (
    /\b(form|screen|page|input|button|field|click(?:ing)?|shows?|display(?:s|ed)?|visible|before submission|continue button)\b/.test(
      normalized,
    )
  ) {
    layers.add("UI");
  }

  if (
    /(?:^|[\s(])(get|post|put|patch|delete)\s+\/|\/[a-z0-9/_-]+|\b(api|endpoint|request|response|returns?|status|header|retry-after|rate limit|rate-limit)\b/.test(
      normalized,
    )
  ) {
    layers.add("API");
  }

  if (
    /\b(stored?|persist(?:ed|ence)?|database|db\b|record|row|table|model|updates?\b|created exactly one|linked to)\b/.test(
      normalized,
    ) ||
    /\b[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+\b/.test(text)
  ) {
    layers.add("SQL");
  }

  if (/\b(audit|audit log|audit logs|event log)\b/.test(normalized)) {
    layers.add("AUDIT");
  }

  if (
    /\b(generic error|failed attempt|lock(?:ed|out)?|rate limit(?:ing)?|expired?|invalidat(?:e|ed|ion)|rejected|suspend(?:ed)?|security)\b/.test(
      normalized,
    )
  ) {
    layers.add("SECURITY");
  }

  if (
    /\b(session|session_id|session record|lastloginat|last_login_at|last login)\b/.test(
      normalized,
    ) ||
    /\b[A-Z][A-Za-z0-9_]*\.last[A-Za-z0-9_]*\b/.test(text)
  ) {
    layers.add("SESSION");
  }

  if (layers.size === 0) {
    layers.add("OTHER");
  }

  return LAYER_ORDER.filter((layer) => layers.has(layer));
}

function extractAcceptanceCriteriaSection(sourceText: string) {
  const lines = sourceText.split(/\r\n|\n/);
  const headerIndex = lines.findIndex((line) =>
    ACCEPTANCE_CRITERIA_HEADER_PATTERN.test(line.trim()),
  );

  if (headerIndex === -1) {
    return [];
  }

  const extractedLines: string[] = [];

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      extractedLines.push("");
      continue;
    }

    if (MAJOR_SECTION_HEADER_PATTERN.test(trimmed)) {
      break;
    }

    extractedLines.push(line);
  }

  return extractedLines;
}

export function planAcceptanceCriteria(sourceText: string): AcceptanceCriterion[] {
  const sectionLines = extractAcceptanceCriteriaSection(sourceText);
  const criteriaTexts: string[] = [];
  let current: string[] = [];

  for (const rawLine of sectionLines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }

    const itemMatch = trimmed.match(LIST_ITEM_PATTERN);
    if (itemMatch) {
      if (current.length > 0) {
        const finalized = normalizeCriterionText(current.join(" "));
        if (finalized) {
          criteriaTexts.push(finalized);
        }
      }

      current = [itemMatch[1] ?? ""];
      continue;
    }

    if (current.length > 0) {
      current.push(trimmed);
    }
  }

  if (current.length > 0) {
    const finalized = normalizeCriterionText(current.join(" "));
    if (finalized) {
      criteriaTexts.push(finalized);
    }
  }

  return criteriaTexts.map((text, index) => ({
    id: formatCriterionId(index),
    text,
    expected_layers: inferExpectedLayers(text),
  }));
}

export function buildAcceptanceCriteriaPlan(
  sourceText: string,
): AcceptanceCriteriaPlan {
  const criteria = planAcceptanceCriteria(sourceText);

  return {
    criteria_total: criteria.length,
    criteria,
  };
}

export function formatAcceptanceCriteriaPlan(
  criteria: AcceptanceCriterion[],
): string {
  return criteria
    .map(
      (criterion) =>
        `${criterion.id} [${criterion.expected_layers.join(", ")}] ${criterion.text}`,
    )
    .join("\n");
}
