import crypto from "node:crypto";
import { canonicalJson } from "./codex-redaction.mjs";
import { createEncryptedLedger } from "./codex-encrypted-ledger.mjs";

const LEVELS = new Set(["latent", "visible", "blocking"]);
const STATUSES = new Set(["open", "resolved", "dismissed"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function projection(events) {
  const exceptions = new Map();
  for (const event of events) {
    if (event?.type !== "exception.upserted" || event.exception?.schema !== "supermemory.authority-exception.v1") {
      fail("exception_ledger_corrupt");
    }
    exceptions.set(event.exception.fingerprint, structuredClone(event.exception));
  }
  return exceptions;
}

export function createMemoryExceptionStore({
  vaultRoot,
  encryptionKey,
  workspaceId,
  projectId,
  visibleMinAgeMs = 86_400_000,
  clock = () => new Date().toISOString()
} = {}) {
  if (typeof workspaceId !== "string" || typeof projectId !== "string") fail("exception_configuration_invalid");
  if (!Number.isSafeInteger(visibleMinAgeMs) || visibleMinAgeMs < 0) fail("exception_age_invalid");
  const ledger = createEncryptedLedger({
    vaultRoot, encryptionKey, workspaceId,
    relativeRoot: "00_inbox/supermemory-product/codex-authority",
    fileName: "exception-events.jsonl.aead",
    aadPrefix: "supermemory.exception-ledger.v1"
  });
  const read = () => projection(ledger.read());
  const timestamp = () => {
    const value = clock();
    if (!Number.isFinite(Date.parse(value))) fail("exception_clock_invalid");
    return new Date(value).toISOString();
  };
  const persist = (exception) => {
    ledger.append({
      schema: "supermemory.exception-event.v1", type: "exception.upserted",
      workspace_id: workspaceId, project_id: projectId, exception
    });
    return Object.freeze(exception);
  };

  const upsert = (input = {}) => {
    const claimIds = [...new Set(input.claimIds ?? input.claim_ids ?? [])].sort();
    const reasonCodes = [...new Set(input.reasonCodes ?? input.reason_codes ?? [])].sort();
    if (claimIds.length === 0 || reasonCodes.length === 0) fail("exception_input_invalid");
    const topicId = input.topicId ?? input.topic_id ?? null;
    const fingerprint = `sha256:${hash(canonicalJson({ workspaceId, projectId, topicId, claimIds, reasonCodes }))}`;
    const existing = read().get(fingerprint);
    const now = timestamp();
    const level = input.level ?? existing?.level ?? "latent";
    if (!LEVELS.has(level)) fail("exception_level_invalid");
    const exception = {
      schema: "supermemory.authority-exception.v1",
      exception_id: existing?.exception_id ?? `exc_${hash(fingerprint)}`,
      fingerprint,
      workspace_id: workspaceId,
      project_id: projectId,
      topic_id: topicId,
      claim_ids: claimIds,
      level,
      status: existing?.status ?? "open",
      reason_codes: reasonCodes,
      recommended_resolution: input.recommendedResolution ?? input.recommended_resolution ?? existing?.recommended_resolution ?? null,
      impact: input.impact ?? existing?.impact ?? "low",
      irreversibility: input.irreversibility ?? existing?.irreversibility ?? "reversible",
      first_seen_at: existing?.first_seen_at ?? now,
      last_evaluated_at: now,
      next_evaluation_at: input.nextEvaluationAt ?? input.next_evaluation_at ?? null,
      evaluation_count: (existing?.evaluation_count ?? 0) + 1,
      resolution: existing?.resolution ?? null
    };
    return persist(exception);
  };

  const reevaluate = ({ fingerprint, resolved = false, resolution = null, context = {} } = {}) => {
    const current = read().get(fingerprint);
    if (!current) fail("exception_not_found");
    const now = timestamp();
    if (resolved) return persist({
      ...current,
      level: "latent",
      status: "resolved",
      last_evaluated_at: now,
      evaluation_count: current.evaluation_count + 1,
      resolution: {
        kind: resolution?.kind ?? "automatic",
        reason: resolution?.reason ?? "new_evidence",
        receipt_id: `xrc_${hash(canonicalJson({ fingerprint, now, resolution }))}`,
        resolved_at: now
      }
    });

    const blocking = (
      Number(context.plausible_states ?? 0) >= 2 && context.rule_available !== true &&
      context.operation_waiting === true && ["high", "critical"].includes(context.impact ?? current.impact) &&
      ["external", "destructive", "permission", "hard_to_reverse"].includes(context.irreversibility ?? current.irreversibility) &&
      context.conservative_fallback_available !== true && context.owner_directive_available !== true
    );
    const age = Date.parse(now) - Date.parse(current.first_seen_at);
    const visible = blocking || (age >= visibleMinAgeMs && context.real_value !== false);
    return persist({
      ...current,
      level: blocking ? "blocking" : (visible ? "visible" : "latent"),
      status: "open",
      impact: context.impact ?? current.impact,
      irreversibility: context.irreversibility ?? current.irreversibility,
      last_evaluated_at: now,
      evaluation_count: current.evaluation_count + 1
    });
  };

  const resolveOwner = ({ fingerprint, decision, actor = "local_owner" } = {}) => {
    const current = read().get(fingerprint);
    if (!current || typeof decision !== "string" || !decision.trim()) fail("exception_resolution_invalid");
    const now = timestamp();
    return persist({
      ...current, level: "latent", status: "resolved",
      last_evaluated_at: now, evaluation_count: current.evaluation_count + 1,
      resolution: {
        kind: "owner",
        actor,
        decision: decision.trim(),
        receipt_id: `xrc_${hash(canonicalJson({ fingerprint, actor, decision: decision.trim(), now }))}`,
        resolved_at: now
      }
    });
  };

  const query = ({ topicId = null, topic_id: snakeTopicId = null, includeLatent = false, includeResolved = false } = {}) => {
    const topic = topicId ?? snakeTopicId;
    return [...read().values()].filter((item) => (
      (topic === null || item.topic_id === topic) &&
      (includeLatent || item.level !== "latent") &&
      (includeResolved || item.status === "open")
    )).sort((left, right) => (
      ({ blocking: 0, visible: 1, latent: 2 })[left.level] - ({ blocking: 0, visible: 1, latent: 2 })[right.level] ||
      left.first_seen_at.localeCompare(right.first_seen_at)
    ));
  };

  return Object.freeze({
    ledgerRoot: ledger.root,
    upsert,
    reevaluate,
    resolveOwner,
    query,
    get: ({ fingerprint } = {}) => read().get(fingerprint) ?? null
  });
}
