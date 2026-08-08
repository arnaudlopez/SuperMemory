import { createEncryptedLedger } from "./codex-encrypted-ledger.mjs";
import { legacyObservedEventTime, validateEventTime } from "./codex-temporal-normalizer.mjs";

const FACT_CLASSES = new Set([
  "machine_state", "source_state", "user_decision", "user_preference", "project_constraint",
  "external_fact", "derived_observation", "permission", "high_impact_fact"
]);
const STATES = new Set(["current", "provisional", "disputed", "superseded", "revoked", "expired"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateClaim(claim, scope) {
  if (
    !claim || typeof claim.claim_id !== "string" || !claim.claim_id ||
    typeof claim.claim_key !== "string" || !claim.claim_key ||
    claim.workspace_id !== scope.workspaceId || claim.project_id !== scope.projectId ||
    !FACT_CLASSES.has(claim.fact_class) || !Array.isArray(claim.evidence_ids) || claim.evidence_ids.length === 0 ||
    !Number.isFinite(Date.parse(claim.observed_at))
  ) fail("authority_claim_invalid");
  const eventTime = claim.event_time ? validateEventTime(claim.event_time) : legacyObservedEventTime(claim.observed_at);
  return {
    ...structuredClone(claim),
    topic_id: claim.topic_id ?? null,
    event_time: eventTime,
    evidence_ids: [...new Set(claim.evidence_ids)].sort(),
    proof_strength: claim.proof_strength ?? "standard",
    explicit: claim.explicit === true,
    authenticated: claim.authenticated === true,
    inferred: claim.inferred === true,
    observed_at: new Date(claim.observed_at).toISOString()
  };
}

function projection(events) {
  const states = new Map();
  for (const event of events) {
    if (event.type !== "authority.transition" || !Array.isArray(event.states)) fail("authority_ledger_corrupt");
    for (const state of event.states) {
      if (state.schema !== "supermemory.authority-state.v1" || !STATES.has(state.state)) fail("authority_ledger_corrupt");
      states.set(state.claim_id, structuredClone(state));
    }
  }
  return states;
}

function sameScope(left, claim) {
  return left.workspace_id === claim.workspace_id && left.project_id === claim.project_id &&
    left.topic_id === claim.topic_id && left.claim_key === claim.claim_key;
}

export function createMemoryAuthorityPolicy({
  vaultRoot,
  encryptionKey,
  workspaceId,
  projectId,
  policyVersion = "quiet-authority-v1.0.0",
  clock = () => new Date().toISOString()
} = {}) {
  if (typeof workspaceId !== "string" || typeof projectId !== "string") fail("authority_configuration_invalid");
  const ledger = createEncryptedLedger({
    vaultRoot, encryptionKey, workspaceId,
    relativeRoot: "00_inbox/supermemory-product/codex-authority",
    fileName: "authority-events.jsonl.aead",
    aadPrefix: "supermemory.authority-ledger.v1"
  });

  const readStates = () => projection(ledger.read());

  const evaluate = ({ claim: rawClaim } = {}) => {
    const claim = validateClaim(rawClaim, { workspaceId, projectId });
    const states = readStates();
    const duplicate = states.get(claim.claim_id);
    if (duplicate) return Object.freeze({ state: duplicate, transitions: [], duplicate: true });
    const scoped = [...states.values()].filter((state) => sameScope(state, claim));
    const active = scoped.filter((state) => ["current", "provisional", "disputed"].includes(state.state))
      .sort((left, right) => right.revision - left.revision || right.evaluated_at.localeCompare(left.evaluated_at));
    const prior = active[0] ?? null;
    const observedMs = Date.parse(claim.observed_at);
    let nextState = "current";
    const reasons = [];

    if (claim.fact_class === "derived_observation") {
      nextState = "provisional";
      reasons.push("derived_non_authoritative");
    } else if (claim.fact_class === "permission") {
      if (!claim.explicit || claim.inferred || claim.proof_strength !== "strong") {
        nextState = "disputed";
        reasons.push("permission_requires_explicit_strong_grant");
      } else reasons.push("explicit_permission_grant");
    } else if (claim.fact_class === "high_impact_fact" && claim.proof_strength !== "strong") {
      nextState = "disputed";
      reasons.push("high_impact_requires_strong_proof");
    } else if (["machine_state", "source_state"].includes(claim.fact_class) && !claim.authenticated) {
      nextState = "provisional";
      reasons.push("state_observation_not_authenticated");
    } else if (["user_decision", "user_preference"].includes(claim.fact_class) && !claim.explicit) {
      nextState = "provisional";
      reasons.push("owner_statement_not_explicit");
    } else if (claim.proof_strength === "weak") {
      nextState = "disputed";
      reasons.push("weak_conflicting_claim");
    } else reasons.push("precedence_rule_satisfied");

    if (prior && observedMs < Date.parse(prior.observed_at)) {
      nextState = "superseded";
      reasons.splice(0, reasons.length, "older_than_current_claim");
    }
    const revision = Math.max(0, ...scoped.map((state) => state.revision)) + 1;
    const evaluatedAt = new Date(clock()).toISOString();
    const transitions = [];
    const supersedes = [];
    if (prior && nextState === "current" && Date.parse(claim.observed_at) >= Date.parse(prior.observed_at)) {
      transitions.push({
        ...prior,
        state: "superseded",
        valid_until: claim.observed_at,
        superseded_by: claim.claim_id,
        evaluated_at: evaluatedAt,
        reason_codes: [...new Set([...(prior.reason_codes ?? []), "newer_authoritative_claim"])]
      });
      supersedes.push(prior.claim_id);
    }
    const ttlMs = rawClaim.ttl_ms === undefined ? null : Number(rawClaim.ttl_ms);
    if (ttlMs !== null && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)) fail("authority_ttl_invalid");
    const state = {
      schema: "supermemory.authority-state.v1",
      claim_id: claim.claim_id,
      claim_key: claim.claim_key,
      workspace_id: workspaceId,
      project_id: projectId,
      topic_id: claim.topic_id,
      fact_class: claim.fact_class,
      state: nextState,
      revision,
      observed_at: claim.observed_at,
      event_time: claim.event_time,
      valid_from: claim.observed_at,
      valid_until: ttlMs === null ? null : new Date(observedMs + ttlMs).toISOString(),
      supersedes,
      superseded_by: null,
      evidence_ids: claim.evidence_ids,
      policy_version: policyVersion,
      reason_codes: reasons,
      evaluated_at: evaluatedAt
    };
    transitions.push(state);
    ledger.append({
      schema: "supermemory.authority-event.v1", type: "authority.transition",
      workspace_id: workspaceId, project_id: projectId, states: transitions
    });
    return Object.freeze({ state, transitions, duplicate: false });
  };

  const resolveCurrent = ({ claimKey, claim_key: snakeClaimKey, topicId = null, topic_id: snakeTopicId = null, at = clock() } = {}) => {
    const key = claimKey ?? snakeClaimKey;
    const topic = topicId ?? snakeTopicId;
    const now = Date.parse(at);
    if (typeof key !== "string" || !Number.isFinite(now)) fail("authority_query_invalid");
    const candidates = [...readStates().values()].filter((state) => (
      state.claim_key === key && state.topic_id === topic && ["current", "provisional", "disputed"].includes(state.state)
    )).map((state) => (
      state.valid_until && Date.parse(state.valid_until) <= now ? { ...state, state: "expired" } : state
    )).sort((left, right) => right.revision - left.revision);
    return candidates[0] ?? null;
  };

  const revoke = ({ claimId, claim_id: snakeClaimId, reason = "owner_revoked" } = {}) => {
    const id = claimId ?? snakeClaimId;
    const states = readStates();
    const current = states.get(id);
    if (!current) fail("authority_not_found");
    if (current.state === "revoked") return current;
    const revoked = {
      ...current, state: "revoked", valid_until: new Date(clock()).toISOString(),
      evaluated_at: new Date(clock()).toISOString(), reason_codes: [...new Set([...(current.reason_codes ?? []), reason])]
    };
    ledger.append({
      schema: "supermemory.authority-event.v1", type: "authority.transition",
      workspace_id: workspaceId, project_id: projectId, states: [revoked]
    });
    return revoked;
  };

  return Object.freeze({
    ledgerRoot: ledger.root,
    evaluate,
    resolveCurrent,
    revoke,
    get: ({ claimId, claim_id } = {}) => readStates().get(claimId ?? claim_id) ?? null,
    list: () => [...readStates().values()].sort((left, right) => left.claim_key.localeCompare(right.claim_key) || left.revision - right.revision)
  });
}
