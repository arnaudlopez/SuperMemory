export const SALIENCE_POLICY_VERSION = "salience-v1";

const WEIGHTS = Object.freeze({
  user_commitment: 0.24,
  consequentiality: 0.18,
  future_utility: 0.17,
  recurrence: 0.14,
  stability: 0.10,
  reuse: 0.09,
  recency: 0.08
});

const HALF_LIFE_DAYS = Object.freeze({
  identity: Infinity,
  decision: Infinity,
  preference: 90,
  state: 21,
  relationship: 90,
  action: 7,
  commitment: 30
});

function clamp(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function unique(values) {
  return new Set(values ?? []).size;
}

export function createMemorySaliencePolicy({ activationThreshold = 0.72, observationThreshold = 0.50 } = {}) {
  const evaluate = ({ authorityRole, memoryClass, text, evidence = {}, features = {} } = {}) => {
    const normalized = Object.fromEntries(Object.keys(WEIGHTS).map((key) => [key, clamp(features[key])]));
    const score = Number(Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + normalized[key] * weight, 0).toFixed(6));
    const episodes = unique(evidence.episode_ids);
    const sessions = unique(evidence.session_ids);
    let decision = "archive_only";
    if (evidence.verified === true && String(text ?? "").trim()) {
      if (authorityRole === "derived_pattern") {
        decision = episodes >= 3 && sessions >= 2 && score >= activationThreshold ? "auto_activate" : "observe";
      } else if (["user_direct", "user_endorsement"].includes(authorityRole)) {
        decision = score >= activationThreshold ? "auto_activate" : score >= observationThreshold ? "observe" : "archive_only";
      } else if (authorityRole === "action_receipt" && episodes >= 2 && score >= activationThreshold) {
        decision = memoryClass === "state" ? "activate_ttl" : "observe";
      }
    }
    return Object.freeze({
      schema: "supermemory.salience-decision.v1",
      policy_version: SALIENCE_POLICY_VERSION,
      score,
      features: Object.freeze(normalized),
      decision,
      recall_allowed: ["auto_activate", "activate_ttl", "reinforce", "revise", "supersede"].includes(decision),
      reason_codes: Object.freeze([
        `authority:${authorityRole ?? "unknown"}`,
        `episodes:${episodes}`,
        `sessions:${sessions}`,
        `class:${memoryClass ?? "unknown"}`
      ])
    });
  };
  return Object.freeze({ policyVersion: SALIENCE_POLICY_VERSION, weights: WEIGHTS, evaluate });
}

export function decayRecallPriority({ memoryClass, salienceScore, lastReinforcedAt, asOf, pinned = false } = {}) {
  if (pinned) return Object.freeze({ recall_priority: 1, deleted: false, decay_policy: "class-aware-v1" });
  const base = clamp(salienceScore);
  const halfLife = HALF_LIFE_DAYS[memoryClass] ?? 30;
  if (halfLife === Infinity) return Object.freeze({ recall_priority: base, deleted: false, decay_policy: "class-aware-v1" });
  const ageMs = Math.max(0, Date.parse(asOf) - Date.parse(lastReinforcedAt));
  const ageDays = Number.isFinite(ageMs) ? ageMs / 86_400_000 : 0;
  const priority = Number((base * Math.pow(0.5, ageDays / halfLife)).toFixed(6));
  return Object.freeze({ recall_priority: priority, deleted: false, decay_policy: "class-aware-v1" });
}
