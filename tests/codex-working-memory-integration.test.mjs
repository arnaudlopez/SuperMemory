import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexCaptureStore } from "../scripts/lib/codex-capture-store.mjs";
import { createCodexWorkingRecall } from "../scripts/lib/codex-working-recall.mjs";
import { createCodexWorkingSetStore } from "../scripts/lib/codex-working-set-store.mjs";

const PROJECT_ID = "prj_018f1234-5678-7abc-8def-0123456789ab";
const WORKSPACE_ID = "ws_018f1234-5678-7abc-8def-0123456789ac";
const CHECKOUT_ID = "co_018f1234-5678-7abc-8def-0123456789ad";
const KEY = Buffer.alloc(32, 0x33);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "working-integration-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault };
}

function input(sequence, overrides = {}) {
  return {
    adapter: overrides.adapter ?? "hook", adapter_version: "1.0.0",
    external_event_id: overrides.externalEventId ?? `event-${sequence}`,
    project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, checkout_id: CHECKOUT_ID,
    session_id: overrides.sessionId ?? "ses_hook:working", thread_id: "working",
    turn_id: `turn_working:${sequence}`, item_id: `item-${sequence}`,
    event_type: overrides.eventType ?? "tool.completed",
    occurred_at: `2026-08-04T10:00:${String(sequence).padStart(2, "0")}.000Z`,
    capture_level: overrides.captureLevel ?? "standard", sequence,
    payload: overrides.payload ?? { output: `result-${sequence}` }
  };
}

test("enabled capture returns independently reopened evidence and canonical episode provenance", (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY, workingMemory: { enabled: true } });
  const result = store.ingest(input(0));
  assert.equal(result.stored, true);
  assert.equal(result.working.durable, true);
  assert.equal(result.working.reopen_verified, true);
  assert.equal(result.working.complete, true);
  assert.match(result.working.evidence_id, /^wev_/);
  const state = store.workingStore.readState({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    sessionId: "ses_hook:working",
    workingSetId: result.working.working_set_id
  });
  assert.equal(state.episodes[0].episode_id, result.working.episode_id);
  const episode = store.workingStore.readEpisode({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    sessionId: "ses_hook:working",
    workingSetId: result.working.working_set_id,
    evidenceId: result.working.evidence_id,
    episodeId: result.working.episode_id
  });
  assert.deepEqual(episode.source_event_ids, [result.eventId]);
  assert.equal(store.ingest(input(0)).working.evidence_id, result.working.evidence_id);
});

test("coverage, resume, fork, and feature-off behavior remain truthful", (t) => {
  const { vault } = fixture(t);
  const disabled = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const baseline = disabled.ingest(input(0));
  assert.equal("working" in baseline, false);
  assert.equal(fs.existsSync(path.join(vault, "00_inbox/supermemory-product/codex-working-sets")), false);

  const enabled = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY, workingMemory: { enabled: true } });
  const resumed = enabled.ingest(input(1));
  const partial = enabled.ingest(input(3));
  assert.equal(partial.working.capture_coverage, "partial");
  assert.equal(partial.working.complete, false);
  assert.equal(partial.working.offload_eligible, false);
  assert.equal(resumed.working.working_set_id, partial.working.working_set_id);

  const forked = createCodexCaptureStore({
    vaultRoot: vault, encryptionKey: KEY,
    workingMemory: {
      enabled: true,
      forkedFromWorkingSetId: resumed.working.working_set_id,
      forkedFromSessionId: "ses_hook:working",
      forkIdentity: "fork-a"
    }
  }).ingest(input(0, { sessionId: "ses_hook:fork", externalEventId: "fork-event" }));
  assert.notEqual(forked.working.working_set_id, resumed.working.working_set_id);
});

test("a post-commit working projection failure never overstates durability", (t) => {
  const { vault } = fixture(t);
  const faultyWorkingStore = createCodexWorkingSetStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    faultInjector: (point) => { if (point === "after_state_commit") throw Object.assign(new Error("injected"), { code: "injected_post_commit_failure" }); }
  });
  const store = createCodexCaptureStore({
    vaultRoot: vault, encryptionKey: KEY, workingMemory: { enabled: true }, workingSetStore: faultyWorkingStore
  });
  const result = store.ingest(input(0));
  assert.equal(result.durable, true);
  assert.equal(result.stored, true);
  assert.equal(result.working.durable, false);
  assert.equal(result.working.reopen_verified, false);
  assert.equal(result.working.state, "degraded");
  assert.equal(store.readEvents({ workspaceId: WORKSPACE_ID }).length, 1);
});

test("WM-AC04: capacity eviction never deletes the canonical encrypted capture payload", (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    workingMemory: { enabled: true, capacity_tokens: 12 }
  });
  const first = store.ingest(input(0, { payload: { output: "first ".repeat(20) } }));
  store.ingest(input(1, { payload: { output: "second ".repeat(20) } }));
  const state = store.workingStore.readState({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    sessionId: "ses_hook:working",
    workingSetId: first.working.working_set_id
  });
  const evicted = state.entries.find((entry) => entry.status === "evicted");
  assert.ok(evicted);
  const archived = store.readEvents({
    workspaceId: WORKSPACE_ID,
    sessionId: "ses_hook:working",
    includePayload: true
  }).find((record) => record.envelope.event_id === evicted.event_id);
  assert.ok(archived?.payload);
  assert.equal(archived.envelope.payload_hash, evicted.content_hash);
});

test("WM-AC15: Working capture and recall remain independent from Ollama and Hindsight", (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    workingMemory: { enabled: true }
  });
  const captured = store.ingest(input(0, { payload: { output: "offline-safe working evidence" } }));
  const reopened = store.workingStore.openEvidence({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    sessionId: "ses_hook:working",
    workingSetId: captured.working.working_set_id,
    evidenceId: captured.working.evidence_id,
    captureStore: store
  });
  assert.equal(reopened.payload.output, "offline-safe working evidence");
});

test("WM-AC13/17: tombstones invalidate old map evidence and corrupt maps rebuild", (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    workingMemory: { enabled: true }
  });
  const captured = store.ingest(input(0, { payload: { output: "map evidence" } }));
  const recall = createCodexWorkingRecall({
    workingStore: store.workingStore,
    captureStore: store,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    clock: () => "2026-08-04T11:00:00.000Z"
  });
  const scope = {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    sessionId: "ses_hook:working",
    workingSetId: captured.working.working_set_id,
    evidenceId: captured.working.evidence_id
  };
  assert.deepEqual(recall.map({ working_set_id: captured.working.working_set_id }).evidence_ids, [captured.working.evidence_id]);
  const mapPath = path.join(store.workingStore.root, WORKSPACE_ID, captured.working.working_set_id, "active-map.json.aead");
  fs.writeFileSync(mapPath, "corrupt", { mode: 0o600 });
  assert.deepEqual(recall.map({ working_set_id: captured.working.working_set_id }).evidence_ids, [captured.working.evidence_id]);
  store.workingStore.tombstone(scope);
  const after = recall.map({ working_set_id: captured.working.working_set_id });
  assert.deepEqual(after.evidence_ids, []);
  assert.doesNotMatch(after.additional_context, new RegExp(captured.working.evidence_id));
});
