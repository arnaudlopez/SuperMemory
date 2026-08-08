import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareCodexCapture } from "../scripts/lib/codex-capture-store.mjs";
import { createCodexWorkingSetStore } from "../scripts/lib/codex-working-set-store.mjs";

const KEY = Buffer.alloc(32, 7);
const PROJECT_ID = "prj_018f1234-5678-7abc-8def-0123456789ab";
const OTHER_PROJECT_ID = "prj_018f1234-5678-7abc-8def-0123456789ae";
const WORKSPACE_ID = "ws_018f1234-5678-7abc-8def-0123456789ac";
const OTHER_WORKSPACE_ID = "ws_018f1234-5678-7abc-8def-0123456789af";
const CHECKOUT_ID = "co_018f1234-5678-7abc-8def-0123456789ad";
const scope = { workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, sessionId: "ses_hook:test" };
const UUIDV7 = /^(?:wset|wev|epi)_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "working-store-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault, store: createCodexWorkingSetStore({ vaultRoot: vault, encryptionKey: KEY, ...options }) };
}

function source(sequence, payload = { text: "payload" }, overrides = {}) {
  const input = {
    adapter: overrides.adapter ?? "hook", adapter_version: "1.0.0",
    external_event_id: overrides.externalEventId ?? `store-${sequence}`,
    project_id: overrides.projectId ?? PROJECT_ID,
    workspace_id: overrides.workspaceId ?? WORKSPACE_ID,
    checkout_id: CHECKOUT_ID,
    session_id: overrides.sessionId ?? scope.sessionId,
    thread_id: "test", turn_id: `turn_test:${sequence}`, item_id: `item-${sequence}`,
    event_type: overrides.kind ?? "tool.completed",
    occurred_at: `2026-08-04T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    capture_level: overrides.captureLevel ?? "standard", sequence, payload
  };
  const prepared = prepareCodexCapture(input, {
    encryptionKey: KEY,
    observedAt: `2026-08-04T00:01:${String(sequence).padStart(2, "0")}.000Z`
  });
  const envelope = {
    ...prepared.envelope,
    payload_ref: `blob:${prepared.envelope.payload_hash}`
  };
  return {
    payload: prepared.payload,
    record: {
      schema: "supermemory.codex-journal-record.v1",
      envelope,
      order_status: "in_order",
      capture_coverage: overrides.coverage ?? "standard",
      applied: true,
      durable: true
    }
  };
}

function captureStore(sources) {
  return {
    readEvents: ({ workspaceId, sessionId }) => sources
      .filter(({ record }) => record.envelope.workspace_id === workspaceId && record.envelope.session_id === sessionId)
      .map(({ record, payload }) => ({ ...record, payload }))
  };
}

function scoped(state, evidenceId = null, overrides = {}) {
  return {
    ...scope,
    workingSetId: state.manifest.working_set_id,
    ...(evidenceId ? { evidenceId } : {}),
    ...overrides
  };
}

test("persisted UUIDv7 identities are stable for resume, duplicates, and distinct sibling forks", (t) => {
  const { store } = fixture(t);
  const parent = store.ensure(scope);
  assert.match(parent.manifest.working_set_id, UUIDV7);
  assert.equal(store.ensure(scope).manifest.working_set_id, parent.manifest.working_set_id);
  const event = source(1);
  const admitted = store.admit(event);
  assert.match(admitted.entry.evidence_id, UUIDV7);
  assert.match(admitted.episode.episode_id, UUIDV7);
  assert.equal(store.admit(event).entry.evidence_id, admitted.entry.evidence_id);
  const childScope = { ...scope, sessionId: "ses_hook:child" };
  const left = store.ensure({ ...childScope, forkedFromWorkingSetId: parent.manifest.working_set_id, forkedFromSessionId: scope.sessionId, forkIdentity: "fork-left" });
  const right = store.ensure({ ...childScope, forkedFromWorkingSetId: parent.manifest.working_set_id, forkedFromSessionId: scope.sessionId, forkIdentity: "fork-right" });
  assert.notEqual(left.manifest.working_set_id, right.manifest.working_set_id);
  assert.equal(store.ensure({ ...childScope, forkedFromWorkingSetId: parent.manifest.working_set_id, forkedFromSessionId: scope.sessionId, forkIdentity: "fork-left" }).manifest.working_set_id, left.manifest.working_set_id);
});

test("separate chained AEAD journals persist metadata without payload plaintext", (t) => {
  const { vault, store } = fixture(t);
  const admitted = store.admit(source(1, { text: "DO-NOT-DUPLICATE-PLAINTEXT" }));
  store.pin(scoped(admitted.state, admitted.entry.evidence_id));
  const directory = path.join(vault, "00_inbox/supermemory-product/codex-working-sets", WORKSPACE_ID, admitted.state.manifest.working_set_id);
  for (const name of ["manifest.json.aead", "entries.jsonl.aead", "checkpoints.jsonl.aead"]) {
    const content = fs.readFileSync(path.join(directory, name), "utf8");
    assert.doesNotMatch(content, /DO-NOT-DUPLICATE-PLAINTEXT/);
  }
  const frames = fs.readFileSync(path.join(directory, "checkpoints.jsonl.aead"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(frames.map((frame) => frame.sequence), [1, 2, 3]);
  assert.equal(frames[0].previous_frame_hash, "sha256:genesis");
  assert.match(frames[1].previous_frame_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(path.join(directory, "state.json.aead")), false);
});

test("pins and tombstones survive manifest loss and deterministic rebuild", (t) => {
  const { vault, store } = fixture(t, { capacityTokens: 35 });
  const one = source(1, { text: "x".repeat(60) });
  const two = source(2, { text: "y".repeat(80) });
  const first = store.admit(one);
  store.pin(scoped(first.state, first.entry.evidence_id));
  const second = store.admit(two);
  store.tombstone(scoped(second.state, second.entry.evidence_id));
  const directory = path.join(vault, "00_inbox/supermemory-product/codex-working-sets", WORKSPACE_ID, first.state.manifest.working_set_id);
  fs.writeFileSync(path.join(directory, "manifest.json.aead"), "corrupt\n");
  const replayed = store.readState(scoped(first.state));
  assert.equal(replayed.entries.find((entry) => entry.evidence_id === first.entry.evidence_id).pinned, true);
  assert.equal(replayed.entries.find((entry) => entry.evidence_id === second.entry.evidence_id).status, "tombstoned");
  fs.rmSync(path.join(directory, "manifest.json.aead"));
  const rebuilt = store.rebuild({ ...scoped(first.state), captureStore: captureStore([one, two]) });
  assert.deepEqual(
    rebuilt.entries.map(({ evidence_id, pinned, status }) => ({ evidence_id, pinned, status })),
    replayed.entries.map(({ evidence_id, pinned, status }) => ({ evidence_id, pinned, status }))
  );
  assert.throws(() => store.openEvidence({
    ...scoped(first.state, second.entry.evidence_id), captureStore: captureStore([one, two])
  }), /working_evidence_unknown/);
});

test("pins are never evicted and explicitly report over-capacity", (t) => {
  const { store } = fixture(t, { capacityTokens: 20 });
  const first = store.admit(source(1, { text: "a".repeat(60) }));
  store.pin(scoped(first.state, first.entry.evidence_id));
  const second = store.admit(source(2, { text: "b".repeat(60) }));
  let state = store.pin(scoped(first.state, second.entry.evidence_id));
  assert.equal(state.manifest.state, "over_capacity");
  assert.equal(state.entries.filter((entry) => entry.pinned && entry.status === "selected").length, 2);
  const third = store.admit(source(3, { text: "c".repeat(60) }));
  state = store.readState(scoped(first.state));
  assert.equal(state.entries.find((entry) => entry.evidence_id === third.entry.evidence_id).status, "evicted");
  assert.equal(state.entries.filter((entry) => entry.pinned && entry.status === "selected").length, 2);
});

test("pin and tombstone journals remain authoritative across injected post-fsync crashes", (t) => {
  let fault = null;
  const { store } = fixture(t, {
    faultInjector: (point) => {
      if (fault === "pin" && point === "after_checkpoint_commit") {
        fault = null;
        throw Object.assign(new Error("injected_pin_crash"), { code: "injected_pin_crash" });
      }
      if (fault === "tombstone" && point === "after_tombstone_commit") {
        fault = null;
        throw Object.assign(new Error("injected_tombstone_crash"), { code: "injected_tombstone_crash" });
      }
    }
  });
  const event = source(1);
  const admitted = store.admit(event);
  fault = "pin";
  assert.throws(() => store.pin(scoped(admitted.state, admitted.entry.evidence_id)), /injected_pin_crash/);
  assert.equal(store.readState(scoped(admitted.state)).entries[0].pinned, true);
  fault = "tombstone";
  assert.throws(() => store.tombstone(scoped(admitted.state, admitted.entry.evidence_id)), /injected_tombstone_crash/);
  assert.throws(() => store.openEvidence({
    ...scoped(admitted.state, admitted.entry.evidence_id), captureStore: captureStore([event])
  }), /working_evidence_unknown/);
  const reconciled = store.tombstone(scoped(admitted.state, admitted.entry.evidence_id));
  assert.equal(reconciled.entries[0].status, "tombstoned");
});

test("journal corruption and acknowledged truncation fail closed", (t) => {
  const { vault, store } = fixture(t);
  const admitted = store.admit(source(1));
  store.pin(scoped(admitted.state, admitted.entry.evidence_id));
  const directory = path.join(vault, "00_inbox/supermemory-product/codex-working-sets", WORKSPACE_ID, admitted.state.manifest.working_set_id);
  const checkpoint = path.join(directory, "checkpoints.jsonl.aead");
  const lines = fs.readFileSync(checkpoint, "utf8").trim().split("\n");
  fs.writeFileSync(checkpoint, `${lines.slice(0, -1).join("\n")}\n`);
  assert.throws(() => store.readState(scoped(admitted.state)), /working_journal_truncated/);

  const other = fixture(t);
  const otherAdmitted = other.store.admit(source(2));
  const otherJournal = path.join(other.vault, "00_inbox/supermemory-product/codex-working-sets", WORKSPACE_ID, otherAdmitted.state.manifest.working_set_id, "entries.jsonl.aead");
  const bytes = fs.readFileSync(otherJournal);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  fs.writeFileSync(otherJournal, bytes);
  assert.throws(() => other.store.readState(scoped(otherAdmitted.state)), /working_journal_corrupt/);
});

test("rebuild completes an interrupted evidence projection without changing its identity", (t) => {
  let armed = true;
  const event = source(1);
  const { store } = fixture(t, {
    faultInjector: (point) => {
      if (armed && point === "after_evidence_commit") {
        armed = false;
        throw Object.assign(new Error("injected_evidence_crash"), { code: "injected_evidence_crash" });
      }
    }
  });
  assert.throws(() => store.admit(event), /injected_evidence_crash/);
  const interrupted = store.ensure(scope);
  assert.equal(interrupted.entries.length, 1);
  const evidenceId = interrupted.entries[0].evidence_id;
  const rebuilt = store.rebuild({ ...scoped(interrupted), captureStore: captureStore([event]) });
  assert.equal(rebuilt.entries.length, 1);
  assert.equal(rebuilt.entries[0].evidence_id, evidenceId);
  assert.equal(rebuilt.manifest.source_sequence_high_watermark, 1);
});

test("all reads, mutations, forks, and rebuilds enforce exact scope indistinguishably", (t) => {
  const { store } = fixture(t);
  const event = source(1);
  const admitted = store.admit(event);
  for (const override of [
    { projectId: OTHER_PROJECT_ID },
    { sessionId: "ses_hook:foreign" },
    { workspaceId: OTHER_WORKSPACE_ID }
  ]) {
    const foreign = scoped(admitted.state, admitted.entry.evidence_id, override);
    assert.throws(() => store.readState(foreign), /working_set_unknown/);
    assert.throws(() => store.pin(foreign), /working_set_unknown/);
    assert.throws(() => store.openEvidence({ ...foreign, captureStore: captureStore([event]) }), /working_set_unknown/);
    assert.throws(() => store.rebuild({ ...foreign, captureStore: captureStore([event]) }), /working_set_unknown/);
  }
  assert.throws(() => store.openEvidence({
    ...scoped(admitted.state, "wev_018f1234-5678-7abc-8def-0123456789aa"),
    captureStore: captureStore([event])
  }), /working_evidence_unknown/);
  assert.throws(() => store.ensure({
    ...scope, projectId: OTHER_PROJECT_ID, sessionId: "ses_hook:foreign-child",
    forkedFromWorkingSetId: admitted.state.manifest.working_set_id,
    forkedFromSessionId: scope.sessionId,
    forkIdentity: "foreign"
  }), /working_set_unknown/);
  assert.throws(() => store.ensure({
    ...scope, sessionId: "ses_hook:foreign-child",
    forkedFromWorkingSetId: admitted.state.manifest.working_set_id,
    forkedFromSessionId: "ses_hook:not-the-parent",
    forkIdentity: "wrong-parent-session"
  }), /working_set_unknown/);
  assert.throws(() => store.rebuild({
    ...scoped(admitted.state),
    captureStore: { readEvents: () => [{ ...source(2, {}, { projectId: OTHER_PROJECT_ID }).record, payload: {} }] }
  }), /working_source_invalid/);
});

test("incremental selection equals replay and rebuild after eviction, pin changes, and late events", (t) => {
  const { store } = fixture(t, { capacityTokens: 60 });
  const events = [source(1, { text: "a".repeat(80) }), source(3, { text: "b".repeat(80) }), source(2, { text: "c".repeat(80) })];
  const first = store.admit(events[0]);
  store.admit(events[1]);
  store.pin(scoped(first.state, first.entry.evidence_id));
  store.admit(events[2]);
  store.unpin(scoped(first.state, first.entry.evidence_id));
  const replayed = store.readState(scoped(first.state));
  const rebuilt = store.rebuild({ ...scoped(first.state), captureStore: captureStore(events) });
  assert.deepEqual(
    rebuilt.entries.map(({ evidence_id, pinned, status }) => ({ evidence_id, pinned, status })),
    replayed.entries.map(({ evidence_id, pinned, status }) => ({ evidence_id, pinned, status }))
  );
  assert.equal(rebuilt.manifest.selected_tokens, replayed.manifest.selected_tokens);
});

test("interim monolithic T004 state is explicitly rejected", (t) => {
  const { vault, store } = fixture(t);
  const id = `wset_${"a".repeat(64)}`;
  const directory = path.join(vault, "00_inbox/supermemory-product/codex-working-sets", WORKSPACE_ID, id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "state.json.aead"), "legacy-interim\n");
  assert.throws(() => store.ensure(scope), /working_interim_format_unsupported/);
  assert.throws(() => store.readState({ ...scope, workingSetId: id }), /working_set_unknown/);
});

test("canonical admission revocations are encrypted, immutable, idempotent, and workspace scoped", (t) => {
  const { vault, store } = fixture(t, { clock: () => "2026-08-04T10:00:00.000Z" });
  const admissionId = `adm_${"a".repeat(64)}`;
  const first = store.recordAdmissionRevocation({
    workspaceId: WORKSPACE_ID,
    admissionId,
    revokedAt: "2026-08-04T10:00:00.000Z"
  });
  assert.deepEqual(store.recordAdmissionRevocation({
    workspaceId: WORKSPACE_ID,
    admissionId,
    revokedAt: "2026-08-04T10:00:00.000Z"
  }), first);
  assert.deepEqual(store.listRevokedAdmissions({ workspaceId: WORKSPACE_ID }), [admissionId]);
  assert.deepEqual(store.listRevokedAdmissions({ workspaceId: OTHER_WORKSPACE_ID }), []);
  assert.throws(() => store.recordAdmissionRevocation({
    workspaceId: WORKSPACE_ID,
    admissionId,
    revokedAt: "2026-08-04T10:00:01.000Z"
  }), /working_admission_revocation_conflict/);
  const ciphertext = fs.readFileSync(path.join(
    vault,
    "00_inbox/supermemory-product/codex-working-sets",
    WORKSPACE_ID,
    "admission-revocations",
    `${admissionId}.json.aead`
  ), "utf8");
  assert.doesNotMatch(ciphertext, /"admission_id"|"revoked_at"/);
});

test("WM-AC14: exact-confirmation purge removes derived state and attests without deleting capture", (t) => {
  const { store } = fixture(t);
  const event = source(1, { text: "retained canonical capture" });
  const admitted = store.admit(event);
  const scopedInput = scoped(admitted.state, admitted.entry.evidence_id);
  store.writeDerivedMap({
    ...scopedInput,
    map: {
      schema: "supermemory.working-map.v1",
      workspace_id: WORKSPACE_ID,
      project_id: PROJECT_ID,
      session_id: scope.sessionId,
      working_set_id: admitted.state.manifest.working_set_id,
      input_hash: "sha256:" + "a".repeat(64)
    }
  });
  assert.throws(() => store.purgeDerived({ ...scopedInput, confirmation: "PURGE wrong" }), /working_purge_confirmation_required/);
  const attestation = store.purgeDerived({
    ...scopedInput,
    confirmation: `PURGE ${admitted.entry.evidence_id}`
  });
  assert.equal(attestation.capture_archive_preserved, true);
  assert.equal(attestation.derived_map_removed, true);
  assert.equal(JSON.stringify(attestation).includes("retained canonical capture"), false);
  assert.equal(store.readState(scopedInput).entries[0].status, "purged");
  assert.equal(store.readDerivedMap(scopedInput), null);
  assert.equal(captureStore([event]).readEvents({ workspaceId: WORKSPACE_ID, sessionId: scope.sessionId })[0].payload.text, "retained canonical capture");
  assert.deepEqual(store.purgeDerived({
    ...scopedInput,
    confirmation: `PURGE ${admitted.entry.evidence_id}`
  }), attestation);
});
