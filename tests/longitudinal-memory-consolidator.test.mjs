import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLongitudinalMemoryConsolidator } from "../scripts/lib/longitudinal-memory-consolidator.mjs";
import { createMemorySignalStore, createMemorySignal } from "../scripts/lib/memory-signal-store.mjs";
import { createMemorySaliencePolicy } from "../scripts/lib/memory-salience-policy.mjs";
import { createPersonalMemoryRevisionStore } from "../scripts/lib/personal-memory-revision-store.mjs";

const OWNER = "owner_personal";
const WORKSPACE = "ws_11111111-1111-4111-8111-111111111111";

function fixture({ projector = async () => ({ status: "completed" }) } = {}) {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-consolidator-"));
  const encryptionKey = crypto.randomBytes(32);
  const clock = (() => { let tick = 0; return () => `2026-08-10T10:00:${String(tick++).padStart(2, "0")}.000Z`; })();
  const signalStore = createMemorySignalStore({ vaultRoot, encryptionKey });
  const revisionStore = createPersonalMemoryRevisionStore({ vaultRoot, encryptionKey, clock });
  const worker = createLongitudinalMemoryConsolidator({
    vaultRoot,
    encryptionKey,
    signalStore,
    revisionStore,
    saliencePolicy: createMemorySaliencePolicy(),
    proposer: async ({ signals }) => ({ operation: "activate", proposed_text: signals[0].text, title: "Runtime Hermes", domain: "project_decision" }),
    verifier: async () => ({ status: "verified", independent: true, evidence_supported: true }),
    projector,
    clock,
    limits: { concurrency: 1, maxBatchEpisodes: 50, maxClusterEpisodes: 24, maxClusterTokens: 32_000 }
  });
  return { vaultRoot, encryptionKey, signalStore, revisionStore, worker };
}

function signal(overrides = {}) {
  return createMemorySignal({
    ownerId: OWNER,
    workspaceId: WORKSPACE,
    sessionId: "session_consolidator",
    episodeIds: ["episode_consolidator"],
    evidenceIds: ["evidence_consolidator"],
    subjectKey: "architecture:runtime",
    memoryClass: "decision",
    authorityRole: "user_direct",
    text: "Home 101 exécute Hermes et Z2 conserve le vault canonique.",
    occurredAt: "2026-08-10T10:00:00.000Z",
    features: { user_commitment: 1, consequentiality: 1, future_utility: 1, recurrence: 0.2, stability: 1, reuse: 0, recency: 1 },
    ...overrides
  });
}

test("natural direct conclusion consolidates canonically with cited lineage and no explicit command", async () => {
  const { signalStore, revisionStore, worker } = fixture();
  signalStore.append(signal());
  assert.equal(worker.enqueue({ ownerId: OWNER, workspaceId: WORKSPACE, signalIds: signalStore.list({ ownerId: OWNER, workspaceId: WORKSPACE }).map((item) => item.signal_id) }).status, "queued");
  const drained = await worker.drain();
  assert.equal(drained.activated, 1);
  const memories = revisionStore.list({ ownerId: OWNER, includeOwner: true });
  assert.equal(memories.length, 1);
  assert.equal(memories[0].pinned, false);
  const lineage = worker.lineage({ memoryId: memories[0].memory_id });
  assert.deepEqual(lineage.episode_ids, ["episode_consolidator"]);
  assert.deepEqual(lineage.evidence_ids, ["evidence_consolidator"]);
  assert.equal(lineage.verification.status, "verified");
});

test("same evidence and restart are idempotent, while projection outage stays retryable", async () => {
  const projected = [];
  const fx = fixture({ projector: async (job) => { projected.push(job); throw Object.assign(new Error("hindsight_unavailable"), { code: "hindsight_unavailable" }); } });
  const stored = fx.signalStore.append(signal());
  fx.worker.enqueue({ ownerId: OWNER, workspaceId: WORKSPACE, signalIds: [stored.signal_id] });
  const first = await fx.worker.drain();
  assert.equal(first.activated, 1);
  assert.equal(fx.worker.status().projection_retryable, 1);
  const restarted = createLongitudinalMemoryConsolidator({
    vaultRoot: fx.vaultRoot, encryptionKey: fx.encryptionKey, signalStore: fx.signalStore,
    revisionStore: fx.revisionStore, saliencePolicy: createMemorySaliencePolicy(),
    proposer: async ({ signals }) => ({ operation: "activate", proposed_text: signals[0].text, title: "Runtime Hermes", domain: "project_decision" }),
    verifier: async () => ({ status: "verified", independent: true, evidence_supported: true }),
    projector: async () => ({ status: "completed" })
  });
  restarted.enqueue({ ownerId: OWNER, workspaceId: WORKSPACE, signalIds: [stored.signal_id] });
  const second = await restarted.drain();
  assert.equal(second.duplicates, 1);
  assert.equal(fx.revisionStore.list({ ownerId: OWNER, includeOwner: true }).length, 1);
});

test("revoked evidence transitively removes authority from dependent synthesis", async () => {
  const { signalStore, revisionStore, worker } = fixture();
  const stored = signalStore.append(signal());
  worker.enqueue({ ownerId: OWNER, workspaceId: WORKSPACE, signalIds: [stored.signal_id] });
  await worker.drain();
  const memory = revisionStore.list({ ownerId: OWNER, includeOwner: true })[0];
  signalStore.revokeEvidence({ evidenceIds: ["evidence_consolidator"] });
  const result = await worker.recalculate({ revokedEvidenceIds: ["evidence_consolidator"] });
  assert.equal(result.revoked, 1);
  assert.equal(revisionStore.current({ memoryId: memory.memory_id }).status, "do_not_use");
});

test("new evidence reinforces or revises one canonical subject without duplicate memories", async () => {
  const { signalStore, revisionStore, worker } = fixture();
  const first = signalStore.append(signal());
  worker.enqueue({ ownerId: OWNER, workspaceId: WORKSPACE, signalIds: [first.signal_id] });
  await worker.drain();
  const original = revisionStore.list({ ownerId: OWNER, includeOwner: true })[0];

  const confirmation = signalStore.append(signal({
    sessionId: "session_confirmation",
    episodeIds: ["episode_confirmation"],
    evidenceIds: ["evidence_confirmation"],
    occurredAt: "2026-08-10T11:00:00.000Z"
  }));
  worker.enqueue({ ownerId: OWNER, workspaceId: WORKSPACE, signalIds: [confirmation.signal_id] });
  const reinforced = await worker.drain();
  assert.equal(reinforced.reinforced, 1);
  assert.equal(revisionStore.list({ ownerId: OWNER, includeOwner: true }).length, 1);
  assert.equal(revisionStore.current({ memoryId: original.memory_id }).reinforcement_count, 2);

  const correction = signalStore.append(signal({
    sessionId: "session_revision",
    episodeIds: ["episode_revision"],
    evidenceIds: ["evidence_revision"],
    text: "Home 101 exécute Hermes et Z2 conserve le vault canonique chiffré.",
    occurredAt: "2026-08-10T12:00:00.000Z"
  }));
  worker.enqueue({ ownerId: OWNER, workspaceId: WORKSPACE, signalIds: [correction.signal_id] });
  const revised = await worker.drain();
  assert.equal(revised.revised, 1);
  const current = revisionStore.current({ memoryId: original.memory_id });
  assert.equal(current.revision, 3);
  assert.match(current.text, /chiffré/);
  assert.equal(worker.lineage({ memoryId: original.memory_id }).revisions.length, 3);
});

test("worker enforces cluster and batch bounds before model calls", () => {
  const { worker } = fixture();
  assert.throws(() => worker.enqueue({
    ownerId: OWNER,
    workspaceId: WORKSPACE,
    signalIds: Array.from({ length: 25 }, (_, index) => `msig_${String(index).padStart(64, "0")}`)
  }), { message: "longitudinal_cluster_limit_exceeded" });
  assert.deepEqual(worker.status().limits, { concurrency: 1, max_batch_episodes: 50, max_cluster_episodes: 24, max_cluster_tokens: 32000 });
});
