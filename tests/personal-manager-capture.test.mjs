import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPersonalManagerCaptureStore, normalizePersonalManagerCapture } from "../scripts/lib/personal-manager-capture.mjs";

test("Hermes capture keeps visible turn content and reduced receipts only", () => {
  const capture = normalizePersonalManagerCapture({
    ownerId: "owner_personal",
    agentId: "agent_personal_manager",
    sessionId: "session_12345678",
    turnId: "turn_12345678",
    occurredAt: "2026-08-10T10:00:00.000Z",
    encryptionKey: crypto.randomBytes(32),
    messages: [
      { role: "system", content: "hidden system" },
      { role: "user", content: "Rédige un email. token=" + "gh" + "p_abcdefghijklmnopqrstuvwxyz1234567890" },
      { role: "tool", content: "raw gmail payload and oauth_token=secret" },
      { role: "assistant", content: "Brouillon préparé.", final: true }
    ],
    actionReceipts: [{ connector: "gmail", action: "draft_created", status: "created", external_id: "msg_opaque", oauth_token: "secret" }],
    prefetchedContext: "do not retain this"
  });
  assert.deepEqual(capture.messages.map((item) => item.role), ["user", "assistant"]);
  assert.doesNotMatch(JSON.stringify(capture), /hidden system|raw gmail|do not retain|ghp_|oauth_token/);
  assert.equal(capture.action_receipts[0].connector, "gmail");
  assert.equal(capture.capture_level, "governed");
  assert.equal(capture.activates_memory, false);
});

test("Personal Manager capture ledger is encrypted and idempotent by turn", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-capture-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const store = createPersonalManagerCaptureStore({ vaultRoot: vault, encryptionKey: key });
  const capture = normalizePersonalManagerCapture({
    ownerId: "owner_personal",
    agentId: "agent_personal_manager",
    sessionId: "session_1",
    turnId: "turn_1",
    occurredAt: "2026-08-10T10:00:00.000Z",
    encryptionKey: key,
    messages: [{ role: "user", content: "private-capture-text" }],
    actionReceipts: []
  });
  const first = store.append(capture);
  const duplicate = store.append(capture);
  assert.equal(first.status, "queued");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.capture_id, first.capture_id);
  assert.doesNotMatch(fs.readFileSync(store.storePath, "utf8"), /private-capture-text/);
});
