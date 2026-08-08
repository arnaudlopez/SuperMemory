import { normalizeTemporalExpression } from "./codex-temporal-normalizer.mjs";

const INTENTS = new Set(["current_state", "temporal_range", "aggregation", "preference", "multi_hop", "simple_recall"]);
const REPAIRABLE = new Set(["current_state", "temporal_range", "aggregation", "preference", "multi_hop"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function bounded(value, fallback, minimum, maximum, code) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) fail(code);
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function classify(query, asOf) {
  if (/\b(combien|combien de fois|count|how many|total|toutes? les occurrences|all occurrences)\b/i.test(query)) return "aggregation";
  if (asOf || /\b(actuellement|courant|courante|maintenant|current(?:ly)?|latest|dernier état|état actuel)\b/i.test(query)) return "current_state";
  if (/\b(préférence|preference|préfère|prefer|aime|like|déteste|dislike)\b/i.test(query)) return "preference";
  if (/\b(pourquoi|why|dépend|depend|impact|cause|relation|chaîne|chain|lié|link|multi[- ]hop)\b/i.test(query)) return "multi_hop";
  if (/\b(hier|aujourd['’]hui|demain|semaine|week|mois|month|année|year|avant|après|before|after|depuis|since|entre|between|20\d{2}-\d{2}-\d{2})\b/i.test(query)) return "temporal_range";
  return "simple_recall";
}

function steps(intent) {
  if (intent === "aggregation") return [
    { source: "events", mode: "range", exhaustive: true },
    { source: "topic_turns", mode: "lexical_semantic", exhaustive: true },
    { source: "durable", mode: "hybrid", exhaustive: false }
  ];
  if (intent === "current_state") return [
    { source: "events", mode: "state_chain", exhaustive: true },
    { source: "durable", mode: "temporal", exhaustive: false },
    { source: "graph", mode: "as_of", exhaustive: false }
  ];
  if (intent === "temporal_range") return [
    { source: "events", mode: "range", exhaustive: true },
    { source: "topic_turns", mode: "lexical_semantic", exhaustive: false },
    { source: "durable", mode: "temporal", exhaustive: false }
  ];
  if (intent === "preference") return [
    { source: "durable", mode: "hybrid", exhaustive: false },
    { source: "events", mode: "state_chain", exhaustive: true },
    { source: "topic_turns", mode: "lexical_semantic", exhaustive: false }
  ];
  if (intent === "multi_hop") return [
    { source: "graph", mode: "multi_hop", exhaustive: false },
    { source: "durable", mode: "hybrid", exhaustive: false },
    { source: "topic_turns", mode: "lexical_semantic", exhaustive: false }
  ];
  return [
    { source: "working", mode: "lexical", exhaustive: false },
    { source: "durable", mode: "hybrid", exhaustive: false }
  ];
}

function timeWindow(query, asOf, observedAt, required) {
  if (asOf) return { start: null, end: new Date(asOf).toISOString(), required: true };
  if (!required) return { start: null, end: null, required: false };
  const normalized = normalizeTemporalExpression({ text: query, observedAt });
  return { start: normalized.earliest, end: normalized.latest, required: true };
}

export function validateRetrievalPlan(plan) {
  if (!plan || plan.schema !== "supermemory.retrieval-plan.v1" || !INTENTS.has(plan.intent)) fail("retrieval_plan_invalid");
  if (!Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 5) fail("retrieval_plan_steps_invalid");
  if (plan.steps.some((step) => (
    !["working", "topic_turns", "events", "durable", "graph"].includes(step?.source) ||
    typeof step.mode !== "string" || typeof step.exhaustive !== "boolean"
  ))) fail("retrieval_plan_steps_invalid");
  if (!plan.time_window || typeof plan.time_window.required !== "boolean") fail("retrieval_plan_window_invalid");
  for (const value of [plan.time_window.start, plan.time_window.end]) {
    if (value !== null && !Number.isFinite(Date.parse(value))) fail("retrieval_plan_window_invalid");
  }
  if (plan.time_window.start && plan.time_window.end && Date.parse(plan.time_window.start) > Date.parse(plan.time_window.end)) {
    fail("retrieval_plan_window_invalid");
  }
  bounded(plan.max_rounds, 1, 1, 3, "retrieval_plan_rounds_invalid");
  bounded(plan.budget?.max_ms, 5_000, 100, 30_000, "retrieval_plan_budget_invalid");
  bounded(plan.budget?.max_results, 1_000, 1, 10_000, "retrieval_plan_budget_invalid");
  bounded(plan.budget?.max_tokens, 12_000, 256, 50_000, "retrieval_plan_budget_invalid");
  return deepFreeze(structuredClone(plan));
}

export function createRetrievalPlan({
  query,
  asOf = null,
  observedAt = new Date().toISOString(),
  maxRounds = 3,
  maxMs = 5_000,
  maxResults = 1_000,
  maxTokens = 12_000
} = {}) {
  const text = String(query ?? "").trim();
  if (!text || text.length > 4_000) fail("retrieval_query_invalid");
  if (asOf !== null && !Number.isFinite(Date.parse(asOf))) fail("retrieval_plan_window_invalid");
  if (!Number.isFinite(Date.parse(observedAt))) fail("retrieval_plan_anchor_invalid");
  const intent = classify(text, asOf);
  const requiresWindow = ["aggregation", "temporal_range"].includes(intent) || asOf !== null;
  const repairable = REPAIRABLE.has(intent);
  return validateRetrievalPlan({
    schema: "supermemory.retrieval-plan.v1",
    intent,
    time_window: timeWindow(text, asOf, observedAt, requiresWindow),
    steps: steps(intent),
    requirements: {
      require_current_and_superseded: ["current_state", "preference"].includes(intent),
      require_complete_range: ["aggregation", "temporal_range"].includes(intent),
      require_explicit_preference: intent === "preference"
    },
    max_rounds: repairable ? bounded(maxRounds, 3, 1, 3, "retrieval_plan_rounds_invalid") : 1,
    budget: {
      max_ms: bounded(maxMs, 5_000, 100, 30_000, "retrieval_plan_budget_invalid"),
      max_results: bounded(maxResults, 1_000, 1, 10_000, "retrieval_plan_budget_invalid"),
      max_tokens: bounded(maxTokens, 12_000, 256, 50_000, "retrieval_plan_budget_invalid")
    }
  });
}

export function retrievalIntent(query, options = {}) {
  return createRetrievalPlan({ query, ...options }).intent;
}
