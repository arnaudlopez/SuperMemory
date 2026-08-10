import { normalizePersonalActionReceipt } from "./personal-action-receipt.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openJsonAead, redactCodexPayload, sealJsonAead } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function normalizePersonalManagerCapture({
  ownerId,
  agentId,
  sessionId,
  turnId,
  occurredAt = new Date().toISOString(),
  encryptionKey,
  messages = [],
  actionReceipts = []
} = {}) {
  if (
    !ownerId || !agentId || !sessionId || !turnId || !Number.isFinite(Date.parse(occurredAt)) ||
    !Array.isArray(messages) || !Array.isArray(actionReceipts)
  ) fail("personal_capture_invalid");
  const visibleMessages = messages
    .filter((message) => message?.role === "user" || (message?.role === "assistant" && message.final === true))
    .map(({ role, content }) => ({ role, content: String(content ?? "") }));
  const normalizedReceipts = actionReceipts.map(normalizePersonalActionReceipt);
  const redacted = redactCodexPayload({ messages: visibleMessages, action_receipts: normalizedReceipts }, { encryptionKey });
  return Object.freeze({
    schema: "supermemory.personal-manager-capture.v1",
    owner_id: ownerId,
    agent_id: agentId,
    session_id: sessionId,
    turn_id: turnId,
    occurred_at: occurredAt,
    capture_level: "governed",
    activates_memory: false,
    messages: Object.freeze(redacted.payload.messages),
    action_receipts: Object.freeze(redacted.payload.action_receipts),
    redaction: Object.freeze(redacted.findings)
  });
}

export function createPersonalManagerCaptureStore({ vaultRoot, encryptionKey } = {}) {
  const vault = path.resolve(vaultRoot ?? "");
  if (!fs.existsSync(vault) || fs.lstatSync(vault).isSymbolicLink() || !fs.statSync(vault).isDirectory()) fail("personal_capture_store_invalid");
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) fail("personal_capture_store_invalid");
  const directory = path.join(vault, "00_inbox", "supermemory-product");
  const target = path.join(directory, "personal-manager-captures.json.aead");
  const aad = "supermemory.personal-manager-captures.v1";
  const read = () => {
    if (!fs.existsSync(target)) return [];
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("personal_capture_store_invalid");
    const value = openJsonAead(JSON.parse(fs.readFileSync(target, "utf8")), { encryptionKey, expectedAad: aad });
    if (value?.schema !== "supermemory.personal-manager-captures.v1" || !Array.isArray(value.captures)) fail("personal_capture_store_invalid");
    return value.captures;
  };
  const append = (capture) => withVaultMutationLock(vault, () => {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const captures = read();
    const existing = captures.find((item) => (
      item.owner_id === capture.owner_id && item.agent_id === capture.agent_id &&
      item.session_id === capture.session_id && item.turn_id === capture.turn_id
    ));
    if (existing) return { status: "duplicate", capture_id: existing.capture_id };
    const receipt = { ...capture, capture_id: `pmcap_${crypto.randomUUID()}` };
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    const sealed = sealJsonAead({ schema: "supermemory.personal-manager-captures.v1", captures: [...captures, receipt] }, { encryptionKey, aad });
    fs.writeFileSync(temporary, `${JSON.stringify(sealed)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
    return { status: "queued", capture_id: receipt.capture_id };
  });
  return Object.freeze({ append, list: read, storePath: target });
}
