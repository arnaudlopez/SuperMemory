import { validateRetrievalPlan } from "./codex-retrieval-plan.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function status(value) {
  return ["complete", "partial", "not_required", "unavailable"].includes(value) ? value : "partial";
}

export function evaluateEvidenceCoverage({ plan, round = 1, sources = {}, results = [] } = {}) {
  const contract = validateRetrievalPlan(plan);
  if (!Number.isSafeInteger(round) || round < 1 || round > contract.max_rounds) fail("retrieval_round_invalid");
  if (!Array.isArray(results)) fail("retrieval_results_invalid");
  const gaps = [];
  const requiredSources = contract.steps.filter((step) => step.exhaustive);
  const requiredComplete = requiredSources.every((step) => (
    sources[step.source]?.status === "complete" && sources[step.source]?.pagination_complete === true
  ));

  let temporalWindow = "not_required";
  if (contract.time_window.required) {
    temporalWindow = status(sources.events?.temporal_window ?? (requiredComplete ? "complete" : "partial"));
    if (!contract.time_window.start && !contract.time_window.end) {
      temporalWindow = "partial";
      gaps.push("missing_temporal_bounds");
    } else if (temporalWindow !== "complete") gaps.push("incomplete_temporal_window");
  }

  let currentState = "not_required";
  if (contract.requirements.require_current_and_superseded) {
    currentState = status(sources.events?.state_chain ?? "partial");
    if (currentState !== "complete") gaps.push("missing_prior_state");
  }

  let aggregation = "not_required";
  if (contract.intent === "aggregation") {
    aggregation = requiredComplete && temporalWindow === "complete" ? "exact" : (results.length > 0 ? "bounded" : "unknown");
    if (aggregation !== "exact") gaps.push("aggregation_not_exhaustive");
  }

  if (contract.requirements.require_explicit_preference && !results.some((item) => item.explicit_preference === true)) {
    gaps.push("explicit_preference_missing");
  }
  const uniqueGaps = [...new Set(gaps)].sort();
  const repairAttempted = round > 1;
  const shouldRepair = uniqueGaps.length > 0 && round < contract.max_rounds;
  const abstentionRequired = uniqueGaps.length > 0 && !shouldRepair;
  return Object.freeze({
    schema: "supermemory.retrieval-coverage.v1",
    coverage: {
      temporal_window: temporalWindow,
      current_state: currentState,
      aggregation,
      evidence_gap: uniqueGaps
    },
    round,
    repair_attempted: repairAttempted,
    repair_required: shouldRepair,
    abstention_required: abstentionRequired,
    complete: uniqueGaps.length === 0
  });
}

export function repairDirective(coverage) {
  if (!coverage?.repair_required) return null;
  const gaps = coverage.coverage?.evidence_gap ?? [];
  const modes = [];
  if (gaps.includes("missing_temporal_bounds")) modes.push("resolve_time_window");
  if (gaps.includes("incomplete_temporal_window") || gaps.includes("aggregation_not_exhaustive")) modes.push("exhaust_interval");
  if (gaps.includes("missing_prior_state")) modes.push("load_state_chain");
  if (gaps.includes("explicit_preference_missing")) modes.push("search_explicit_turns");
  return Object.freeze({ schema: "supermemory.retrieval-repair.v1", modes: [...new Set(modes)].sort() });
}
