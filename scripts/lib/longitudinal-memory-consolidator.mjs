import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const AAD = "supermemory.longitudinal-consolidator-state.v1";
const OPERATIONS = new Set(["observe", "activate", "reinforce", "revise", "supersede", "deemphasize", "noop"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalMemoryId({ ownerId, workspaceId, subjectKey }) {
  const material = canonicalJson({ owner_id: ownerId, workspace_id: workspaceId, subject_key: subjectKey });
  return `mem_${crypto.createHash("sha256").update(material).digest("base64url").slice(0, 32)}`;
}

function tokenEstimate(signals) {
  return Math.ceil(signals.reduce((total, signal) => total + Buffer.byteLength(String(signal.text ?? ""), "utf8"), 0) / 3.5);
}

function normalizedText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("fr").replace(/\s+/g, " ");
}

export function createLongitudinalMemoryConsolidator({
  vaultRoot, encryptionKey, signalStore, revisionStore, saliencePolicy, proposer, verifier,
  projector = async () => ({ status: "completed" }), clock = () => new Date().toISOString(), limits = {}
} = {}) {
  const vault = path.resolve(vaultRoot ?? "");
  if (
    !fs.existsSync(vault) || !Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32 ||
    !signalStore?.list || !revisionStore?.create || !revisionStore?.revise ||
    !saliencePolicy?.evaluate || typeof proposer !== "function" || typeof verifier !== "function"
  ) fail("longitudinal_consolidator_invalid");
  const effectiveLimits = Object.freeze({
    concurrency: limits.concurrency ?? 1,
    maxBatchEpisodes: limits.maxBatchEpisodes ?? 50,
    maxClusterEpisodes: limits.maxClusterEpisodes ?? 24,
    maxClusterTokens: limits.maxClusterTokens ?? 32_000
  });
  if (
    effectiveLimits.concurrency !== 1 || effectiveLimits.maxBatchEpisodes < 1 ||
    effectiveLimits.maxClusterEpisodes < 1 || effectiveLimits.maxClusterTokens < 256
  ) fail("longitudinal_limits_invalid");

  const directory = path.join(vault, "00_inbox", "supermemory-product");
  const target = path.join(directory, "longitudinal-consolidator-state.json.aead");
  const initial = () => ({
    schema: "supermemory.longitudinal-consolidator-state.v1",
    queue: [], processed: {}, lineages: {}, projection_retryable: [], dead_letters: [],
    checkpoint: null, counters: { activate: 0, reinforce: 0, revise: 0, supersede: 0, deemphasize: 0, observe: 0, noop: 0 }
  });
  const read = () => {
    if (!fs.existsSync(target)) return initial();
    const state = openJsonAead(JSON.parse(fs.readFileSync(target, "utf8")), { encryptionKey, expectedAad: AAD });
    if (state?.schema !== "supermemory.longitudinal-consolidator-state.v1") fail("longitudinal_state_invalid");
    state.queue ??= [];
    state.processed ??= {};
    state.lineages ??= {};
    state.projection_retryable ??= [];
    state.dead_letters ??= [];
    state.counters ??= initial().counters;
    return state;
  };
  const write = (state) => {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(sealJsonAead(state, { encryptionKey, aad: AAD }))}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  };
  const mutate = (change) => withVaultMutationLock(vault, () => {
    const state = read();
    const result = change(state);
    write(state);
    return structuredClone(result);
  });

  const enqueue = ({ ownerId, workspaceId, signalIds = [] } = {}) => {
    if (!ownerId || !workspaceId || !Array.isArray(signalIds) || !signalIds.length) fail("longitudinal_enqueue_invalid");
    const uniqueIds = [...new Set(signalIds)].sort();
    if (uniqueIds.length > effectiveLimits.maxClusterEpisodes) fail("longitudinal_cluster_limit_exceeded");
    const signals = signalStore.list({ ownerId, workspaceId, signalIds: uniqueIds, includeRevoked: false });
    if (signals.length !== uniqueIds.length) fail("longitudinal_signal_scope_invalid");
    const episodeIds = new Set(signals.flatMap((signal) => signal.episode_ids ?? []));
    const subjects = [...new Set(signals.map((signal) => signal.subject_key))];
    if (episodeIds.size > effectiveLimits.maxClusterEpisodes || subjects.length !== 1) fail("longitudinal_cluster_limit_exceeded");
    if (tokenEstimate(signals) > effectiveLimits.maxClusterTokens) fail("longitudinal_cluster_token_limit_exceeded");
    const material = {
      owner_id: ownerId,
      workspace_id: workspaceId,
      subject_key: subjects[0],
      signal_ids: uniqueIds
    };
    const clusterId = `lmc_${digest(material)}`;
    return mutate((state) => {
      if (state.processed[clusterId]) {
        state.queue.push({ ...material, cluster_id: clusterId, duplicate: true, queued_at: clock(), attempts: 0 });
        return { status: "duplicate", cluster_id: clusterId };
      }
      if (state.queue.some((item) => item.cluster_id === clusterId)) {
        return { status: "duplicate", cluster_id: clusterId };
      }
      state.queue.push({ ...material, cluster_id: clusterId, queued_at: clock(), attempts: 0 });
      return { status: "queued", cluster_id: clusterId };
    });
  };

  const finish = (clusterId, record, lineageUpdate = null) => mutate((state) => {
    state.processed[clusterId] = structuredClone(record);
    state.queue = state.queue.filter((item) => item.cluster_id !== clusterId);
    state.checkpoint = { cluster_id: clusterId, decision: record.operation ?? record.decision, completed_at: clock() };
    if (state.counters[record.operation] !== undefined) state.counters[record.operation] += 1;
    if (lineageUpdate) {
      const previous = state.lineages[lineageUpdate.memory_id];
      state.lineages[lineageUpdate.memory_id] = {
        ...record,
        episode_ids: [...new Set([...(previous?.episode_ids ?? []), ...record.episode_ids])].sort(),
        evidence_ids: [...new Set([...(previous?.evidence_ids ?? []), ...record.evidence_ids])].sort(),
        reinforcements: [
          ...(previous?.reinforcements ?? []),
          ...(["reinforce", "activate"].includes(record.operation)
            ? [{ cluster_id: clusterId, revision: record.revision, at: record.committed_at }]
            : [])
        ],
        revisions: [
          ...(previous?.revisions ?? []),
          { operation: record.operation, revision: record.revision, previous_revision: record.previous_revision, at: record.committed_at }
        ],
        receipts: [...(previous?.receipts ?? []), record]
      };
    }
    return record;
  });

  const archive = (item, operation, details = {}) => finish(item.cluster_id, {
    schema: "supermemory.consolidation-receipt.v1",
    receipt_id: `lcr_${digest({ cluster_id: item.cluster_id, operation })}`,
    cluster_id: item.cluster_id,
    memory_id: null,
    operation,
    decision: details.decision ?? "archive_only",
    episode_ids: details.episode_ids ?? [],
    evidence_ids: details.evidence_ids ?? [],
    verification: details.verification ?? null,
    salience: details.salience ?? null,
    committed_at: clock()
  });

  const drain = async () => {
    const summary = { activated: 0, reinforced: 0, revised: 0, superseded: 0, deemphasized: 0, observed: 0, duplicates: 0, failed: 0 };
    let consumedEpisodes = 0;
    while (consumedEpisodes < effectiveLimits.maxBatchEpisodes) {
      const item = read().queue[0] ?? null;
      if (!item) break;
      if (read().processed[item.cluster_id]) {
        mutate((state) => { state.queue = state.queue.filter((entry) => entry.cluster_id !== item.cluster_id); });
        summary.duplicates += 1;
        continue;
      }
      const signals = signalStore.list({ ownerId: item.owner_id, workspaceId: item.workspace_id, signalIds: item.signal_ids, includeRevoked: false });
      const episodeIds = [...new Set(signals.flatMap((signal) => signal.episode_ids ?? []))].sort();
      const evidenceIds = [...new Set(signals.flatMap((signal) => signal.evidence_ids ?? []))].sort();
      consumedEpisodes += Math.max(1, episodeIds.length);
      if (!signals.length) {
        archive(item, "observe", { episode_ids: episodeIds, evidence_ids: evidenceIds });
        summary.observed += 1;
        continue;
      }
      if (
        signals.some((signal) => signal.owner_id !== item.owner_id || signal.workspace_id !== item.workspace_id || signal.subject_key !== item.subject_key) ||
        episodeIds.length > effectiveLimits.maxClusterEpisodes || tokenEstimate(signals) > effectiveLimits.maxClusterTokens
      ) fail("longitudinal_cluster_invalid");

      const authorityOrder = ["user_direct", "user_endorsement", "derived_pattern", "action_receipt", "assistant_proposal"];
      const authority = authorityOrder.find((role) => signals.some((signal) => signal.authority_role === role));
      const sessionIds = [...new Set(signals.map((signal) => signal.session_id))];
      const featureKeys = ["user_commitment", "consequentiality", "future_utility", "recurrence", "stability", "reuse", "recency"];
      const features = Object.fromEntries(featureKeys.map((key) => [key, Math.max(...signals.map((signal) => Number(signal.features?.[key] ?? 0)))]));
      const salience = saliencePolicy.evaluate({
        authorityRole: authority,
        memoryClass: signals[0].memory_class,
        text: signals[0].text,
        evidence: { verified: true, episode_ids: episodeIds, session_ids: sessionIds, evidence_ids: evidenceIds },
        features
      });
      if (!salience.recall_allowed) {
        archive(item, "observe", { decision: salience.decision, episode_ids: episodeIds, evidence_ids: evidenceIds, salience });
        summary.observed += 1;
        continue;
      }

      try {
        const proposed = await proposer({
          clusterId: item.cluster_id,
          ownerId: item.owner_id,
          workspaceId: item.workspace_id,
          subjectKey: item.subject_key,
          signals: structuredClone(signals),
          salience: structuredClone(salience)
        });
        const proposal = {
          schema: "supermemory.longitudinal-consolidation-proposal.v1",
          proposal_id: proposed?.proposal_id ?? `lmp_${digest({ cluster_id: item.cluster_id, proposed })}`,
          cluster_id: item.cluster_id,
          operation: proposed?.operation ?? "noop",
          proposed_text: String(proposed?.proposed_text ?? "").trim(),
          title: String(proposed?.title ?? "Consolidated memory").trim(),
          domain: String(proposed?.domain ?? signals[0].memory_class).trim(),
          episode_ids: episodeIds,
          evidence_ids: evidenceIds
        };
        if (!OPERATIONS.has(proposal.operation)) fail("longitudinal_operation_invalid");
        if (["observe", "noop"].includes(proposal.operation)) {
          archive(item, proposal.operation, { decision: proposal.operation, episode_ids: episodeIds, evidence_ids: evidenceIds, salience });
          summary.observed += 1;
          continue;
        }
        if (!proposal.proposed_text || Buffer.byteLength(proposal.proposed_text) > 8_192) fail("longitudinal_proposal_invalid");
        const verification = await verifier({ proposal: structuredClone(proposal), signals: structuredClone(signals) });
        if (
          verification?.status !== "verified" || verification.independent !== true ||
          verification.evidence_supported !== true
        ) fail("longitudinal_verification_failed");

        const targetId = canonicalMemoryId({ ownerId: item.owner_id, workspaceId: item.workspace_id, subjectKey: item.subject_key });
        const existing = revisionStore.current({ memoryId: targetId });
        let operation = proposal.operation;
        if (!existing) operation = "activate";
        else if (existing.provenance?.cluster_id === item.cluster_id) operation = "noop";
        else if (operation === "activate") operation = normalizedText(existing.text) === normalizedText(proposal.proposed_text) ? "reinforce" : "revise";
        else if (operation === "reinforce" && normalizedText(existing.text) !== normalizedText(proposal.proposed_text)) operation = "revise";

        let revision = existing;
        if (operation !== "noop") {
          const priorEpisodes = existing?.source_episode_ids ?? [];
          const priorEvidence = existing?.evidence_ids ?? [];
          const patch = {
            domain: proposal.domain,
            title: proposal.title,
            text: operation === "deemphasize" ? existing?.text : proposal.proposed_text,
            pinned: existing?.pinned === true,
            subject_key: item.subject_key,
            memory_class: signals[0].memory_class,
            temporal_class: signals[0].memory_class,
            salience_score: salience.score,
            salience_policy_version: salience.policy_version,
            last_reinforced_at: ["activate", "reinforce"].includes(operation) ? clock() : existing?.last_reinforced_at,
            last_confirmed_at: authority === "user_direct" || authority === "user_endorsement" ? clock() : existing?.last_confirmed_at,
            reinforcement_count: Number(existing?.reinforcement_count ?? 0) + (["activate", "reinforce"].includes(operation) ? 1 : 0),
            source_episode_ids: [...new Set([...priorEpisodes, ...episodeIds])].sort(),
            evidence_ids: [...new Set([...priorEvidence, ...evidenceIds])].sort(),
            consolidation_receipt_ids: existing?.consolidation_receipt_ids ?? [],
            recall_priority: operation === "deemphasize" ? Math.min(Number(existing?.recall_priority ?? salience.score), salience.score * 0.5) : salience.score,
            deemphasized_at: operation === "deemphasize" ? clock() : existing?.deemphasized_at ?? null,
            freshness_class: signals[0].memory_class
          };
          const provenance = {
            source: "longitudinal-consolidation",
            operation,
            cluster_id: item.cluster_id,
            signal_ids: item.signal_ids,
            episode_ids: episodeIds,
            evidence_ids: evidenceIds,
            verification,
            salience,
            supersedes_revision: ["revise", "supersede"].includes(operation) ? existing?.revision ?? null : null
          };
          revision = existing
            ? revisionStore.revise({ memoryId: targetId, expectedRevision: existing.revision, patch, provenance })
            : revisionStore.create({ memoryId: targetId, scope: { kind: "owner", owner_id: item.owner_id }, patch, provenance });
        }

        const receipt = {
          schema: "supermemory.consolidation-receipt.v1",
          receipt_id: `lcr_${digest({ cluster_id: item.cluster_id, memory_id: targetId, revision: revision.revision, operation })}`,
          cluster_id: item.cluster_id,
          memory_id: targetId,
          operation,
          decision: salience.decision,
          episode_ids: episodeIds,
          evidence_ids: evidenceIds,
          verification,
          salience,
          revision: revision.revision,
          previous_revision: existing?.revision ?? null,
          committed_at: revision.valid_from
        };
        finish(item.cluster_id, receipt, { memory_id: targetId });
        try {
          await projector({ memoryId: targetId, revision, receipt });
        } catch (error) {
          mutate((state) => {
            if (!state.projection_retryable.some((entry) => entry.receipt_id === receipt.receipt_id)) {
              state.projection_retryable.push({ memory_id: targetId, revision: revision.revision, receipt, receipt_id: receipt.receipt_id, attempts: 1, error: error?.code ?? "projection_failed" });
            }
          });
        }
        if (operation === "activate") summary.activated += 1;
        else if (operation === "reinforce") summary.reinforced += 1;
        else if (operation === "revise") summary.revised += 1;
        else if (operation === "supersede") summary.superseded += 1;
        else if (operation === "deemphasize") summary.deemphasized += 1;
        else summary.duplicates += 1;
      } catch (error) {
        mutate((state) => {
          const queued = state.queue.find((entry) => entry.cluster_id === item.cluster_id);
          if (queued) {
            queued.attempts = Number(queued.attempts ?? 0) + 1;
            queued.last_error = error?.code ?? error?.message ?? "longitudinal_consolidation_failed";
            if (queued.attempts >= 3) {
              state.dead_letters.push({ ...queued, failed_at: clock() });
              state.queue = state.queue.filter((entry) => entry.cluster_id !== item.cluster_id);
            }
          }
        });
        summary.failed += 1;
        throw Object.assign(new Error("longitudinal_consolidation_failed"), { code: "longitudinal_consolidation_failed", cause: error });
      }
    }
    return summary;
  };

  const retryProjections = async () => {
    const pending = read().projection_retryable;
    let completed = 0;
    for (const entry of pending) {
      const revision = revisionStore.current({ memoryId: entry.memory_id });
      if (!revision || revision.revision !== entry.revision) continue;
      try {
        await projector({ memoryId: entry.memory_id, revision, receipt: entry.receipt });
        mutate((state) => { state.projection_retryable = state.projection_retryable.filter((item) => item.receipt_id !== entry.receipt_id); });
        completed += 1;
      } catch (error) {
        mutate((state) => {
          const item = state.projection_retryable.find((value) => value.receipt_id === entry.receipt_id);
          if (item) {
            item.attempts = Number(item.attempts ?? 0) + 1;
            item.error = error?.code ?? "projection_failed";
          }
        });
      }
    }
    return { completed, pending: read().projection_retryable.length };
  };

  const lineage = ({ memoryId: requested } = {}) => structuredClone(read().lineages[requested] ?? null);
  const receipts = ({ limit = 100 } = {}) => Object.values(read().processed)
    .filter((item) => item?.schema === "supermemory.consolidation-receipt.v1")
    .sort((left, right) => String(right.committed_at).localeCompare(String(left.committed_at)))
    .slice(0, limit)
    .map((item) => structuredClone(item));
  const recalculate = async ({ revokedEvidenceIds = [] } = {}) => {
    const revoked = new Set(revokedEvidenceIds);
    let count = 0;
    for (const [id, record] of Object.entries(read().lineages)) {
      if (!(record.evidence_ids ?? []).some((item) => revoked.has(item))) continue;
      const current = revisionStore.current({ memoryId: id });
      if (current?.status === "active") {
        revisionStore.revoke({ memoryId: id, expectedRevision: current.revision, provenance: { source: "longitudinal-evidence-revocation", evidence_ids: revokedEvidenceIds } });
        count += 1;
      }
    }
    return { revoked: count };
  };
  const status = () => {
    const state = read();
    return {
      status: state.dead_letters.length ? "degraded" : "ready",
      pending: state.queue.length,
      processed: Object.keys(state.processed).length,
      projection_retryable: state.projection_retryable.length,
      dead_letters: state.dead_letters.length,
      checkpoint: structuredClone(state.checkpoint),
      decisions: structuredClone(state.counters),
      limits: {
        concurrency: effectiveLimits.concurrency,
        max_batch_episodes: effectiveLimits.maxBatchEpisodes,
        max_cluster_episodes: effectiveLimits.maxClusterEpisodes,
        max_cluster_tokens: effectiveLimits.maxClusterTokens
      }
    };
  };
  return Object.freeze({ enqueue, drain, retryProjections, lineage, receipts, recalculate, status, storePath: target });
}
