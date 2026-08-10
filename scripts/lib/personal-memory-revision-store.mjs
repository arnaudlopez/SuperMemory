import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const AAD = "supermemory.personal-memory-revisions.v1";
const MEMORY_ID = /^mem_[A-Za-z0-9_-]{12,180}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function initialState() {
  return {
    schema: "supermemory.personal-memory-revision-store.v1",
    memories: {},
    receipts: {},
    nonces: {},
    forget_plans: {},
    operations: {}
  };
}

function ensureVault(value) {
  const resolved = path.resolve(value ?? "");
  if (!fs.existsSync(resolved) || fs.lstatSync(resolved).isSymbolicLink() || !fs.statSync(resolved).isDirectory()) {
    fail("personal_memory_vault_invalid");
  }
  return fs.realpathSync(resolved);
}

function statePath(vault, create = false) {
  const directory = path.join(vault, "00_inbox", "supermemory-product");
  if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, "personal-memory-revisions.json.aead");
}

function readState(file, encryptionKey) {
  if (!fs.existsSync(file)) return initialState();
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("personal_memory_store_invalid");
  try {
    const state = openJsonAead(JSON.parse(fs.readFileSync(file, "utf8")), { encryptionKey, expectedAad: AAD });
    if (state?.schema !== "supermemory.personal-memory-revision-store.v1") fail("personal_memory_store_invalid");
    state.memories ??= {};
    state.receipts ??= {};
    state.nonces ??= {};
    state.forget_plans ??= {};
    state.operations ??= {};
    return state;
  } catch (error) {
    if (error?.code === "personal_memory_store_invalid") throw error;
    fail("personal_memory_store_invalid");
  }
}

function writeState(file, state, encryptionKey) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const sealed = sealJsonAead(state, { encryptionKey, aad: AAD });
  fs.writeFileSync(temporary, `${JSON.stringify(sealed)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function currentRevision(record) {
  return record?.revisions?.at(-1) ?? null;
}

const LONGITUDINAL_FIELDS = Object.freeze([
  "pinned", "memory_class", "salience_score", "salience_policy_version",
  "last_reinforced_at", "reinforcement_count", "source_episode_ids", "evidence_ids",
  "consolidation_receipt_ids", "recall_priority", "deemphasized_at", "freshness_class",
  "subject_key", "last_confirmed_at", "temporal_class"
]);

function longitudinalPatch(patch = {}, previous = {}) {
  const value = {};
  for (const field of LONGITUDINAL_FIELDS) {
    if (Object.hasOwn(patch, field)) value[field] = clone(patch[field]);
    else if (Object.hasOwn(previous, field)) value[field] = clone(previous[field]);
  }
  value.pinned ??= false;
  return value;
}

export function createPersonalMemoryRevisionStore({ vaultRoot, encryptionKey, clock = () => new Date().toISOString() } = {}) {
  const vault = ensureVault(vaultRoot);
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) fail("personal_memory_encryption_key_invalid");
  const file = statePath(vault);

  const inspect = (select) => select(readState(file, encryptionKey));
  const mutate = (change) => withVaultMutationLock(vault, () => {
    const destination = statePath(vault, true);
    const state = readState(destination, encryptionKey);
    const result = change(state);
    writeState(destination, state, encryptionKey);
    return clone(result);
  });

  const create = ({ memoryId, scope, patch, provenance } = {}) => mutate((state) => {
    if (!MEMORY_ID.test(String(memoryId ?? "")) || state.memories[memoryId]) fail("personal_memory_target_invalid");
    if (!patch?.text || !patch?.domain) fail("personal_memory_patch_invalid");
    const occurredAt = clock();
    const revision = {
      revision: 1,
      valid_from: occurredAt,
      valid_until: null,
      status: "active",
      domain: String(patch.domain),
      title: String(patch.title ?? "").trim(),
      text: String(patch.text),
      scope: clone(scope),
      provenance: clone(provenance ?? {}),
      ...longitudinalPatch(patch)
    };
    state.memories[memoryId] = { memory_id: memoryId, revisions: [revision] };
    return { memory_id: memoryId, ...revision };
  });

  const revise = ({ memoryId, expectedRevision, patch, provenance, status } = {}) => mutate((state) => {
    const record = state.memories[memoryId];
    const previous = currentRevision(record);
    if (!record || !previous) fail("personal_memory_not_found");
    if (!Number.isInteger(expectedRevision) || previous.revision !== expectedRevision) fail("revision_conflict");
    if (!patch || (Object.keys(patch).length === 0 && !status)) fail("personal_memory_patch_invalid");
    const occurredAt = clock();
    previous.valid_until = occurredAt;
    const revision = {
      revision: previous.revision + 1,
      valid_from: occurredAt,
      valid_until: null,
      status: status ?? previous.status,
      domain: String(patch.domain ?? previous.domain),
      title: String(patch.title ?? previous.title),
      text: String(patch.text ?? previous.text),
      scope: clone(previous.scope),
      provenance: clone(provenance ?? {}),
      ...longitudinalPatch(patch, previous)
    };
    record.revisions.push(revision);
    return { memory_id: memoryId, ...revision };
  });

  const current = ({ memoryId } = {}) => inspect((state) => {
    const revision = currentRevision(state.memories[memoryId]);
    return revision ? clone({ memory_id: memoryId, ...revision }) : null;
  });

  const asOf = ({ memoryId, asOf: instant } = {}) => inspect((state) => {
    const timestamp = Date.parse(instant);
    if (!Number.isFinite(timestamp)) fail("personal_memory_as_of_invalid");
    const revision = state.memories[memoryId]?.revisions?.find((item) => {
      const start = Date.parse(item.valid_from);
      const end = item.valid_until ? Date.parse(item.valid_until) : Number.POSITIVE_INFINITY;
      return start <= timestamp && timestamp < end;
    });
    return revision ? clone({ memory_id: memoryId, ...revision }) : null;
  });

  const revoke = ({ memoryId, expectedRevision, provenance } = {}) => revise({
    memoryId,
    expectedRevision: expectedRevision ?? current({ memoryId })?.revision,
    patch: {},
    provenance,
    status: "do_not_use"
  });

  const pin = ({ memoryId, expectedRevision, pinned = true, provenance } = {}) => {
    if (typeof pinned !== "boolean") fail("personal_memory_pin_invalid");
    return revise({
      memoryId,
      expectedRevision: expectedRevision ?? current({ memoryId })?.revision,
      patch: { pinned, recall_priority: pinned ? 1 : current({ memoryId })?.salience_score ?? 0.5 },
      provenance: { ...(provenance ?? {}), operation: pinned ? "pin" : "unpin" }
    });
  };

  const receipt = (key) => inspect((state) => clone(state.receipts[key]));
  const recordReceipt = (key, value) => mutate((state) => {
    if (state.receipts[key]) fail("idempotency_conflict");
    state.receipts[key] = clone(value);
    return value;
  });
  const hasNonce = (nonce) => inspect((state) => Boolean(state.nonces[nonce]));
  const recordNonce = (nonce, commandId) => mutate((state) => {
    if (state.nonces[nonce]) fail("intent_replayed");
    state.nonces[nonce] = commandId;
    return true;
  });
  const putForgetPlan = (plan) => mutate((state) => {
    state.forget_plans[plan.plan_id] = clone(plan);
    return plan;
  });
  const getForgetPlan = (planId) => inspect((state) => clone(state.forget_plans[planId]));
  const markForgetPlanApplied = (planId) => mutate((state) => {
    const plan = state.forget_plans[planId];
    if (!plan) fail("forget_plan_not_found");
    plan.applied = true;
    return plan;
  });
  const search = ({ query = "", projectIds = [], ownerId = null, includeOwner = false, asOf = null, limit = 20 } = {}) => inspect((state) => {
    const requested = new Set(String(query).toLocaleLowerCase("fr").match(/[\p{L}\p{N}]{2,}/gu) ?? []);
    const instant = asOf ? Date.parse(asOf) : null;
    if (asOf && !Number.isFinite(instant)) fail("personal_memory_as_of_invalid");
    const results = [];
    for (const record of Object.values(state.memories)) {
      const revision = asOf
        ? record.revisions.find((item) => Date.parse(item.valid_from) <= instant && (!item.valid_until || instant < Date.parse(item.valid_until)))
        : currentRevision(record);
      const authorizedScope = projectIds.includes(revision?.scope?.project_id) || (
        includeOwner && revision?.scope?.kind === "owner" && revision.scope.owner_id === ownerId
      );
      if (!revision || revision.status !== "active" || !authorizedScope) continue;
      const corpus = new Set(`${revision.title} ${revision.text}`.toLocaleLowerCase("fr").match(/[\p{L}\p{N}]{2,}/gu) ?? []);
      const overlap = [...requested].filter((token) => corpus.has(token)).length;
      const semanticScore = requested.size === 0 ? 0.5 : overlap / requested.size;
      if (semanticScore <= 0) continue;
      const priority = revision.pinned ? 1 : Number(revision.recall_priority ?? revision.salience_score ?? 0.5);
      const score = Number((semanticScore * 0.8 + Math.max(0, Math.min(1, priority)) * 0.2).toFixed(6));
      results.push({
        memory_id: record.memory_id,
        text: revision.text,
        title: revision.title,
        status: revision.status,
        authority: "current",
        revision: revision.revision,
        score,
        semantic_score: semanticScore,
        recall_priority: priority,
        pinned: revision.pinned === true,
        project_id: revision.scope.project_id ?? null,
        scope: revision.scope.kind,
        citations: [{ memory_id: record.memory_id, revision: revision.revision, valid_from: revision.valid_from, provenance: revision.provenance }]
      });
    }
    return results.sort((left, right) => right.score - left.score).slice(0, limit);
  });
  const putOperation = (operation) => mutate((state) => {
    state.operations[operation.operation_id] = clone(operation);
    return operation;
  });
  const getOperation = (operationId) => inspect((state) => clone(state.operations[operationId]));
  const listOperations = ({ statuses = null, limit = 500 } = {}) => inspect((state) => Object.values(state.operations)
    .filter((operation) => !statuses || statuses.includes(operation.projection_status))
    .slice(0, limit)
    .map(clone));
  const list = ({ projectIds = [], ownerId = null, includeOwner = false, status = null, limit = 500 } = {}) => inspect((state) => Object.values(state.memories)
    .map((record) => ({ memory_id: record.memory_id, ...currentRevision(record) }))
    .filter((memory) => memory.revision && (
      projectIds.includes(memory.scope?.project_id) || (includeOwner && memory.scope?.kind === "owner" && memory.scope.owner_id === ownerId)
    ) && (!status || memory.status === status))
    .sort((left, right) => String(right.valid_from).localeCompare(String(left.valid_from)))
    .slice(0, limit)
    .map(clone));

  return Object.freeze({
    create,
    revise,
    current,
    asOf,
    revoke,
    pin,
    receipt,
    recordReceipt,
    hasNonce,
    recordNonce,
    putForgetPlan,
    getForgetPlan,
    markForgetPlanApplied,
    search,
    putOperation,
    getOperation,
    listOperations,
    list,
    storePath: file
  });
}
