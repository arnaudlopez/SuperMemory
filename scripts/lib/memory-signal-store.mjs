import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const AAD = "supermemory.memory-signals.v1";
const ROLES = new Set(["user_direct", "user_endorsement", "assistant_proposal", "action_receipt", "derived_pattern"]);
const CLASSES = new Set(["preference", "decision", "commitment", "state", "relationship", "action", "identity"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function boundedText(value, max = 8_192) {
  const text = String(value ?? "").trim();
  if (!text || Buffer.byteLength(text) > max) fail("memory_signal_text_invalid");
  return text;
}

function normalizeFeatures(features = {}) {
  return Object.freeze(Object.fromEntries([
    "user_commitment", "consequentiality", "future_utility", "recurrence", "stability", "reuse", "recency"
  ].map((key) => {
    const value = Number(features[key] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 1) fail("memory_signal_feature_invalid");
    return [key, value];
  })));
}

export function createMemorySignal({
  ownerId, workspaceId, sessionId, episodeIds, evidenceIds, subjectKey, memoryClass,
  authorityRole, text, occurredAt, features = {}, sensitivity = "standard", source = "governed_capture"
} = {}) {
  if (
    !ownerId || !workspaceId || !sessionId || !subjectKey || !ROLES.has(authorityRole) ||
    !CLASSES.has(memoryClass) || !Number.isFinite(Date.parse(occurredAt)) ||
    !Array.isArray(episodeIds) || !episodeIds.length || !Array.isArray(evidenceIds) || !evidenceIds.length
  ) fail("memory_signal_invalid");
  const material = {
    schema: "supermemory.memory-signal.v1",
    owner_id: String(ownerId),
    workspace_id: String(workspaceId),
    session_id: String(sessionId),
    episode_ids: [...new Set(episodeIds.map(String))].sort(),
    evidence_ids: [...new Set(evidenceIds.map(String))].sort(),
    subject_key: String(subjectKey),
    memory_class: memoryClass,
    authority_role: authorityRole,
    text: boundedText(text),
    occurred_at: occurredAt,
    features: normalizeFeatures(features),
    sensitivity,
    source,
    activates_memory: false
  };
  return Object.freeze({ ...material, signal_id: `msig_${hash(material)}` });
}

function inference(content, role) {
  const text = String(content ?? "").trim();
  const lower = text.toLocaleLowerCase("fr");
  const decision = /\b(?:je décide|on part|nous partons|je choisis|nous choisissons|finalement|la décision|reste le|sera le)\b/i.test(text);
  const preference = /\b(?:je préfère|je veux|j['’]aime|ma préférence|toujours|jamais)\b/i.test(text);
  const commitment = /\b(?:je vais|nous allons|je m['’]engage|on va)\b/i.test(text);
  const memoryClass = preference ? "preference" : commitment ? "commitment" : decision ? "decision" : "state";
  return {
    text,
    subjectKey: `${memoryClass}:${hash(lower.replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").slice(0, 8).join(" ")).slice(0, 24)}`,
    memoryClass,
    authorityRole: role === "user" ? "user_direct" : "assistant_proposal",
    features: {
      user_commitment: role === "user" && (decision || preference || commitment) ? 1 : 0,
      consequentiality: decision || commitment ? 0.9 : preference ? 0.75 : 0.1,
      future_utility: decision || preference || commitment ? 0.9 : 0.1,
      recurrence: 0.2,
      stability: decision || preference ? 0.9 : 0.3,
      reuse: 0,
      recency: 1
    }
  };
}

export async function deriveMemorySignalsFromCapture(capture, { workspaceId = "ws_owner_personal" } = {}) {
  if (capture?.schema !== "supermemory.personal-manager-capture.v1" || !capture.capture_id) fail("memory_signal_capture_invalid");
  const signals = [];
  for (const [index, message] of (capture.messages ?? []).entries()) {
    if (!['user', 'assistant'].includes(message?.role)) continue;
    const derived = inference(message.content, message.role);
    if (!derived.text) continue;
    signals.push(createMemorySignal({
      ownerId: capture.owner_id,
      workspaceId,
      sessionId: capture.session_id,
      episodeIds: [`episode:${capture.capture_id}:${index}`],
      evidenceIds: [`evidence:${capture.capture_id}:${index}`],
      occurredAt: capture.occurred_at,
      ...derived
    }));
  }
  for (const [index, receipt] of (capture.action_receipts ?? []).entries()) {
    signals.push(createMemorySignal({
      ownerId: capture.owner_id,
      workspaceId,
      sessionId: capture.session_id,
      episodeIds: [`episode:${capture.capture_id}:receipt:${index}`],
      evidenceIds: [`evidence:${capture.capture_id}:receipt:${index}`],
      subjectKey: `action:${receipt.connector}:${receipt.action}`,
      memoryClass: "action",
      authorityRole: "action_receipt",
      text: `${receipt.connector}.${receipt.action}:${receipt.status}`,
      occurredAt: capture.occurred_at,
      features: { user_commitment: 0, consequentiality: 0.4, future_utility: 0.2, recurrence: 0, stability: 0.2, reuse: 0, recency: 1 }
    }));
  }
  return Object.freeze(signals);
}

export function createMemorySignalStore({ vaultRoot, encryptionKey, clock = () => new Date().toISOString() } = {}) {
  const vault = path.resolve(vaultRoot ?? "");
  if (!fs.existsSync(vault) || fs.lstatSync(vault).isSymbolicLink() || !fs.statSync(vault).isDirectory()) fail("memory_signal_store_invalid");
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) fail("memory_signal_store_invalid");
  const directory = path.join(vault, "00_inbox", "supermemory-product");
  const target = path.join(directory, "memory-signals.json.aead");
  const read = () => {
    if (!fs.existsSync(target)) return { schema: "supermemory.memory-signals.v1", signals: {} };
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("memory_signal_store_invalid");
    const state = openJsonAead(JSON.parse(fs.readFileSync(target, "utf8")), { encryptionKey, expectedAad: AAD });
    if (state?.schema !== "supermemory.memory-signals.v1" || !state.signals) fail("memory_signal_store_invalid");
    return state;
  };
  const write = (state) => {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(sealJsonAead(state, { encryptionKey, aad: AAD }))}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
  };
  const mutate = (change) => withVaultMutationLock(vault, () => {
    const state = read();
    const result = change(state);
    write(state);
    return structuredClone(result);
  });
  const append = (signal) => mutate((state) => {
    if (signal?.schema !== "supermemory.memory-signal.v1" || !signal.signal_id) fail("memory_signal_invalid");
    if (state.signals[signal.signal_id]) return { status: "duplicate", signal_id: signal.signal_id };
    state.signals[signal.signal_id] = structuredClone(signal);
    return { status: "stored", signal_id: signal.signal_id };
  });
  const list = ({ ownerId = null, workspaceId = null, includeRevoked = true, signalIds = null } = {}) => {
    const wanted = signalIds ? new Set(signalIds) : null;
    return Object.values(read().signals).filter((signal) => (
      (!ownerId || signal.owner_id === ownerId) && (!workspaceId || signal.workspace_id === workspaceId) &&
      (includeRevoked || !signal.revoked_at) && (!wanted || wanted.has(signal.signal_id))
    )).sort((left, right) => left.occurred_at.localeCompare(right.occurred_at)).map((item) => structuredClone(item));
  };
  const revokeEvidence = ({ evidenceIds = [] } = {}) => mutate((state) => {
    const revoked = new Set(evidenceIds);
    let affected = 0;
    for (const signal of Object.values(state.signals)) {
      if (!signal.revoked_at && signal.evidence_ids.some((id) => revoked.has(id))) {
        signal.revoked_at = clock();
        affected += 1;
      }
    }
    return { affected };
  });
  return Object.freeze({ append, list, revokeEvidence, storePath: target });
}
