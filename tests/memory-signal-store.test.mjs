import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createMemorySignal,
  createMemorySignalStore,
  deriveMemorySignalsFromCapture
} from "../scripts/lib/memory-signal-store.mjs";

const OWNER = "owner_personal";
const WORKSPACE = "ws_11111111-1111-4111-8111-111111111111";

function directSignal(overrides = {}) {
  return createMemorySignal({
    ownerId: OWNER,
    workspaceId: WORKSPACE,
    sessionId: "session_signal_a",
    episodeIds: ["episode_signal_a"],
    evidenceIds: ["evidence_signal_a"],
    subjectKey: "architecture:runtime",
    memoryClass: "decision",
    authorityRole: "user_direct",
    text: "Home 101 exécute Hermes et Z2 conserve le vault canonique.",
    occurredAt: "2026-08-10T10:00:00.000Z",
    features: { user_commitment: 1, consequentiality: 0.9, future_utility: 0.9, stability: 0.9 },
    ...overrides
  });
}

test("MemorySignal is deterministic, cited, role-aware and cannot activate memory itself", () => {
  const first = directSignal();
  const second = directSignal();
  assert.equal(first.signal_id, second.signal_id);
  assert.match(first.signal_id, /^msig_[0-9a-f]{64}$/);
  assert.equal(first.schema, "supermemory.memory-signal.v1");
  assert.equal(first.authority_role, "user_direct");
  assert.equal(first.activates_memory, false);
  assert.deepEqual(first.episode_ids, ["episode_signal_a"]);
  assert.deepEqual(first.evidence_ids, ["evidence_signal_a"]);
});

test("signal store is AEAD encrypted, idempotent and tracks revoked evidence", () => {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-signals-"));
  const store = createMemorySignalStore({ vaultRoot, encryptionKey: crypto.randomBytes(32) });
  const signal = directSignal();
  assert.equal(store.append(signal).status, "stored");
  assert.equal(store.append(signal).status, "duplicate");
  assert.equal(store.list({ ownerId: OWNER, workspaceId: WORKSPACE }).length, 1);
  assert.equal(store.revokeEvidence({ evidenceIds: ["evidence_signal_a"] }).affected, 1);
  assert.equal(store.list({ ownerId: OWNER, workspaceId: WORKSPACE, includeRevoked: false }).length, 0);
  const ciphertext = fs.readFileSync(store.storePath, "utf8");
  assert.doesNotMatch(ciphertext, /Home 101|evidence_signal_a|owner_personal/);
});

test("capture derivation keeps user/final assistant authority distinct and excludes raw connector data", async () => {
  const signals = await deriveMemorySignalsFromCapture({
    schema: "supermemory.personal-manager-capture.v1",
    capture_id: "pmcap_signal_capture",
    owner_id: OWNER,
    session_id: "session_signal_capture",
    turn_id: "turn_signal_capture",
    occurred_at: "2026-08-10T10:00:00.000Z",
    messages: [
      { role: "user", content: "Je décide que Z2 reste le serveur mémoire." },
      { role: "assistant", content: "Tu préfères probablement tout mettre sur Z2.", final: true }
    ],
    action_receipts: [{ connector: "gmail", action: "draft_created", status: "created" }]
  }, { workspaceId: WORKSPACE });
  assert.ok(signals.some((item) => item.authority_role === "user_direct"));
  assert.ok(signals.some((item) => item.authority_role === "assistant_proposal"));
  assert.ok(signals.some((item) => item.authority_role === "action_receipt"));
  assert.ok(signals.every((item) => !JSON.stringify(item).includes("raw_payload")));
  assert.ok(signals.every((item) => item.activates_memory === false));
});
