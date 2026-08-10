import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const AAD = "supermemory.memory-recall-feedback.v1";
const OUTCOMES = new Set(["confirmed", "used", "ignored", "corrected"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function createMemoryRecallFeedbackStore({ vaultRoot, encryptionKey } = {}) {
  const vault = path.resolve(vaultRoot ?? "");
  if (!fs.existsSync(vault) || fs.lstatSync(vault).isSymbolicLink() || !fs.statSync(vault).isDirectory() || !Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) fail("recall_feedback_store_invalid");
  const directory = path.join(vault, "00_inbox", "supermemory-product");
  const target = path.join(directory, "memory-recall-feedback.json.aead");
  const read = () => {
    if (!fs.existsSync(target)) return { schema: "supermemory.memory-recall-feedback.v1", events: {} };
    const state = openJsonAead(JSON.parse(fs.readFileSync(target, "utf8")), { encryptionKey, expectedAad: AAD });
    if (state?.schema !== "supermemory.memory-recall-feedback.v1" || !state.events) fail("recall_feedback_store_invalid");
    return state;
  };
  const write = (state) => {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(sealJsonAead(state, { encryptionKey, aad: AAD }))}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
  };
  const record = (input = {}) => withVaultMutationLock(vault, () => {
    if (["prompt", "response", "content", "raw", "messages"].some((key) => Object.hasOwn(input, key))) fail("recall_feedback_raw_content_forbidden");
    if (!input.ownerId || !input.agentId || !input.sessionId || !input.memoryId || !Number.isInteger(input.revision) || !OUTCOMES.has(input.outcome) || !Number.isFinite(Date.parse(input.occurredAt))) fail(input.outcome && !OUTCOMES.has(input.outcome) ? "recall_feedback_outcome_invalid" : "recall_feedback_invalid");
    const material = {
      owner_id: input.ownerId, agent_id: input.agentId, session_id: input.sessionId,
      memory_id: input.memoryId, revision: input.revision, outcome: input.outcome, occurred_at: input.occurredAt
    };
    const eventId = `mrf_${crypto.createHash("sha256").update(canonicalJson(material)).digest("hex")}`;
    const state = read();
    if (state.events[eventId]) return { status: "duplicate", feedback_id: eventId };
    state.events[eventId] = { schema: "supermemory.memory-recall-feedback-event.v1", feedback_id: eventId, ...material };
    write(state);
    return { status: "stored", feedback_id: eventId };
  });
  const summary = ({ memoryId } = {}) => {
    const result = { confirmed: 0, used: 0, ignored: 0, corrected: 0 };
    for (const event of Object.values(read().events)) if (event.memory_id === memoryId) result[event.outcome] += 1;
    return result;
  };
  return Object.freeze({ record, summary, storePath: target });
}
