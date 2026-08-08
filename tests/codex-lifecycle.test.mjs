import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexArchiveStore } from "../scripts/lib/codex-archive-store.mjs";
import { createCodexLifecycle } from "../scripts/lib/codex-lifecycle.mjs";
import { createCodexWorkspaceStore } from "../scripts/lib/codex-workspace-store.mjs";

const PROJECT = "prj_018f1234-5678-7abc-8def-0123456789a1";
const WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789a2";
const OLD_KEY = Buffer.alloc(32, 0x61);
const NEW_KEY = Buffer.alloc(32, 0x62);
const NOW = "2026-07-24T19:00:00.000Z";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-lifecycle-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { vault };
}

async function memory(store) {
  const candidate = store.createCandidate({
    workspace_id: WORKSPACE,
    project_id: PROJECT,
    archive_id: "arc_018f1234-5678-7abc-8def-0123456789aa",
    event_ids: [`evt_${"a".repeat(64)}`],
    turn_snapshot_id: `tsnap_${"b".repeat(64)}`,
    source_snapshot_ids: [`snap_${"c".repeat(64)}`],
    title: "Sensitive deletion fixture",
    proposed_text: "This content must never enter deletion attestations.",
    type: "decision",
    confidence: 1,
    sensitivity: "standard",
    extractor: { model: "fixture", prompt_version: "v1" }
  });
  return store.reviewCandidate(candidate.candidate_id, { action: "approve" });
}

test("memory deletion tombstones before projection retry and attests without content", async (t) => {
  const { vault } = fixture(t);
  let failDelete = true;
  const store = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    projection: {
      async delete() {
        if (failDelete) {
          const error = new Error("offline");
          error.code = "hindsight_unavailable";
          throw error;
        }
        return { status: "deleted" };
      }
    },
    clock: () => NOW
  });
  const approved = await memory(store);
  const archives = createCodexArchiveStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    encryptionKey: OLD_KEY,
    clock: () => NOW
  });
  const lifecycle = createCodexLifecycle({
    workspaceStore: store,
    archiveStore: archives,
    clock: () => NOW
  });
  await assert.rejects(lifecycle.deleteMemory(approved.memory.memory_id), (error) => (
    error.code === "exact_confirmation_required"
  ));
  const pending = await lifecycle.deleteMemory(approved.memory.memory_id, {
    confirmation: `DELETE ${approved.memory.memory_id}`,
    reason: "Owner request."
  });
  assert.equal(pending.status, "tombstone");
  assert.equal(pending.recall_allowed, false);
  assert.deepEqual(store.listActiveMemories({ consumer: "codex" }), []);

  failDelete = false;
  const completed = await lifecycle.deleteMemory(approved.memory.memory_id, {
    confirmation: `DELETE ${approved.memory.memory_id}`,
    reason: "Owner request."
  });
  assert.equal(completed.status, "purged");
  const repeated = await lifecycle.deleteMemory(approved.memory.memory_id, {
    confirmation: `DELETE ${approved.memory.memory_id}`
  });
  assert.equal(repeated.idempotent, true);
  const attestation = fs.readFileSync(
    path.join(lifecycle.attestationRoot, `${completed.attestation_id}.json`),
    "utf8"
  );
  assert.equal(attestation.includes("Sensitive deletion fixture"), false);
  assert.equal(attestation.includes("must never enter"), false);
  assert.match(attestation, /memories_native_codex_covered/);
});

test("retention purges expired ciphertext but explicit legal hold survives", (t) => {
  const { vault } = fixture(t);
  const store = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    clock: () => NOW
  });
  const archives = createCodexArchiveStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    encryptionKey: OLD_KEY,
    clock: () => NOW
  });
  const expired = archives.createArchive({
    sessionId: "expired",
    turnId: "turn",
    visibleMessages: [{ text: "purge me" }],
    toolEvents: [`evt_${"a".repeat(64)}`],
    turnSnapshotId: `tsnap_${"b".repeat(64)}`,
    expiresAt: "2026-07-23T00:00:00.000Z"
  });
  const held = archives.createArchive({
    sessionId: "held",
    turnId: "turn",
    visibleMessages: [{ text: "hold me" }],
    toolEvents: [`evt_${"c".repeat(64)}`],
    turnSnapshotId: `tsnap_${"d".repeat(64)}`,
    retentionClass: "legal_hold",
    expiresAt: "2026-07-23T00:00:00.000Z"
  });
  const lifecycle = createCodexLifecycle({ workspaceStore: store, archiveStore: archives });
  const result = lifecycle.enforceRetention({ now: NOW });
  assert.equal(result.find((entry) => entry.archive_id === expired.archive_id).status, "purged");
  assert.equal(result.find((entry) => entry.archive_id === held.archive_id).status, "legal_hold");
  assert.throws(() => archives.openArchive(expired.archive_id));
  assert.equal(archives.openArchive(held.archive_id).content.visible_messages[0].text, "hold me");
});

test("key rotation keeps old archives readable while new writes use the new key", (t) => {
  const { vault } = fixture(t);
  const oldStore = createCodexArchiveStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    encryptionKey: OLD_KEY,
    clock: () => NOW
  });
  const oldArchive = oldStore.createArchive({
    sessionId: "old",
    turnId: "turn",
    visibleMessages: [{ text: "old-key-content" }],
    toolEvents: [`evt_${"e".repeat(64)}`],
    turnSnapshotId: `tsnap_${"f".repeat(64)}`
  });
  const rotated = createCodexArchiveStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    encryptionKeys: {
      [oldStore.currentKeyId]: OLD_KEY,
      key_rotated_fixture: NEW_KEY
    },
    currentKeyId: "key_rotated_fixture",
    clock: () => NOW
  });
  assert.equal(rotated.openArchive(oldArchive.archive_id).content.visible_messages[0].text,
    "old-key-content");
  const next = rotated.createArchive({
    sessionId: "new",
    turnId: "turn",
    visibleMessages: [{ text: "new-key-content" }],
    toolEvents: [`evt_${"1".repeat(64)}`],
    turnSnapshotId: `tsnap_${"2".repeat(64)}`
  });
  assert.equal(next.encryption_key_id, "key_rotated_fixture");
  assert.equal(rotated.openArchive(next.archive_id).content.visible_messages[0].text,
    "new-key-content");
});

test("session deletion purges its derived candidate, memory and ciphertext by scope", async (t) => {
  const { vault } = fixture(t);
  const store = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    projection: {
      async delete() {
        return { status: "deleted" };
      }
    },
    clock: () => NOW
  });
  const archives = createCodexArchiveStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    encryptionKey: OLD_KEY,
    clock: () => NOW
  });
  const archive = archives.createArchive({
    sessionId: "session-purge",
    turnId: "turn",
    visibleMessages: [{ text: "session content" }],
    toolEvents: [`evt_${"7".repeat(64)}`],
    turnSnapshotId: `tsnap_${"8".repeat(64)}`
  });
  const candidate = store.createCandidate({
    workspace_id: WORKSPACE,
    project_id: PROJECT,
    archive_id: archive.archive_id,
    event_ids: [`evt_${"7".repeat(64)}`],
    turn_snapshot_id: `tsnap_${"8".repeat(64)}`,
    source_snapshot_ids: [`snap_${"9".repeat(64)}`],
    title: "Session-derived fact",
    proposed_text: "Delete with the session.",
    type: "decision",
    confidence: 1,
    sensitivity: "standard",
    extractor: { model: "fixture", prompt_version: "v1" }
  });
  const approved = await store.reviewCandidate(candidate.candidate_id, {
    action: "approve"
  });
  const lifecycle = createCodexLifecycle({
    workspaceStore: store,
    archiveStore: archives,
    clock: () => NOW
  });
  const result = await lifecycle.deleteSession("session-purge", {
    confirmation: "DELETE SESSION session-purge"
  });
  assert.equal(result.status, "purged");
  assert.equal(result.memories.length, 1);
  assert.equal(store.memoryEntry(approved.memory.memory_id).status, "purged");
  assert.deepEqual(store.listCandidates(), []);
  assert.throws(() => archives.openArchive(archive.archive_id));
  const attestation = fs.readFileSync(
    path.join(lifecycle.attestationRoot, `${result.attestation_id}.json`),
    "utf8"
  );
  assert.equal(attestation.includes("session content"), false);
  assert.equal(attestation.includes("Session-derived fact"), false);
});
