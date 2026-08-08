import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-redaction.mjs";
import { generateUuidV7 } from "./project-registry.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";
import {
  createMemoryAdmissionPolicy,
  verifyAdmissionDecision
} from "./memory-admission-policy.mjs";

const PROJECT_ID = /^prj_[0-9a-f-]{36}$/i;
const WORKSPACE_ID = /^ws_[0-9a-f-]{36}$/i;
const CANDIDATE_ID = /^cand_[0-9a-f-]{36}$/i;
const MEMORY_ID = /^(?:mem_[0-9a-f-]{36}|memory:[0-9a-f]{64})$/i;
const ACTIVE_CONSUMERS = new Set(["supermemory", "codex"]);

export class CodexWorkspaceStoreError extends Error {
  constructor(code) {
    super(code);
    this.name = "CodexWorkspaceStoreError";
    this.code = code;
  }
}

function fail(code) {
  throw new CodexWorkspaceStoreError(code);
}

function assertId(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

function existingDirectory(requested, code) {
  const resolved = path.resolve(requested);
  if (!fs.existsSync(resolved)) fail(`${code}_missing`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${code}_invalid`);
  return fs.realpathSync(resolved);
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    const target = path.join(current, segment);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("workspace_store_path_invalid");
    } else {
      fs.mkdirSync(target, { mode: 0o700 });
    }
    fs.chmodSync(target, 0o700);
    current = fs.realpathSync(target);
  }
  return current;
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
    // File fsync and atomic rename are the portable durability baseline.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function atomicWrite(filePath, value, { immutable = false } = {}) {
  const content = `${canonicalJson(value)}\n`;
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("workspace_store_path_invalid");
    if (immutable) {
      if (fs.readFileSync(filePath, "utf8") !== content) fail("immutable_artifact_conflict");
      return false;
    }
  }
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
  return true;
}

function initialState(workspaceId, projectId, now) {
  return {
    schema: "supermemory.codex-workspace-state.v2",
    workspace_id: workspaceId,
    project_id: projectId,
    created_at: now,
    updated_at: now,
    candidates: {},
    memories: {}
  };
}

function validateState(value, workspaceId, projectId) {
  if (
    value?.schema !== "supermemory.codex-workspace-state.v2" ||
    value.workspace_id !== workspaceId ||
    value.project_id !== projectId ||
    !value.candidates || Array.isArray(value.candidates) ||
    !value.memories || Array.isArray(value.memories)
  ) fail("workspace_state_invalid");
  return value;
}

function readJson(filePath, code) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(code);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail(code);
  }
}

function boundedText(value, code, maximum = 128 * 1024) {
  const text = String(value ?? "").trim();
  if (!text || Buffer.byteLength(text) > maximum) fail(code);
  return text;
}

function projectionView(value = {}) {
  return {
    engine: "hindsight",
    document_id: value.document_id ?? null,
    status: value.status ?? "queued",
    attempts: Number(value.attempts ?? 0),
    last_error: value.last_error ?? null,
    synced_at: value.synced_at ?? null
  };
}

function evidenceIntegrityHash(value) {
  const unsigned = structuredClone(value);
  delete unsigned.integrity_hash;
  return `sha256:${crypto.createHash("sha256")
    .update(canonicalJson(unsigned))
    .digest("hex")}`;
}

export function createCodexWorkspaceStore({
  vaultRoot,
  workspaceId,
  projectId,
  projection = null,
  admissionMode = "legacy_manual",
  admissionPolicy = null,
  clock = () => new Date().toISOString()
} = {}) {
  assertId(workspaceId, WORKSPACE_ID, "scope_unresolved");
  assertId(projectId, PROJECT_ID, "project_scope_invalid");
  const vault = existingDirectory(vaultRoot, "workspace_store_vault");
  const stateRoot = ensureDirectory(
    vault,
    `00_inbox/supermemory-product/codex-workspaces/${workspaceId}`
  );
  const candidateRoot = ensureDirectory(vault, `50_review/codex-candidates/${workspaceId}`);
  const memoryRoot = ensureDirectory(vault, `20_professional/product-memories/${workspaceId}`);
  const admissionRoot = ensureDirectory(vault, `20_professional/admissions/${workspaceId}`);
  const legacyEvidenceRoot = ensureDirectory(
    vault,
    `00_inbox/snapshots/legacy/${workspaceId}`
  );
  const statePath = path.join(stateRoot, "state.json");
  const legacyStatePath = path.join(vault, "00_inbox", "supermemory-product", "state.json");
  if (!["legacy_manual", "automatic"].includes(admissionMode)) fail("admission_mode_invalid");
  const policy = admissionPolicy ?? createMemoryAdmissionPolicy({ clock });

  const readState = () => {
    if (!fs.existsSync(statePath)) return initialState(workspaceId, projectId, clock());
    return validateState(readJson(statePath, "workspace_state_invalid"), workspaceId, projectId);
  };

  const mutate = (operation) => withVaultMutationLock(vault, () => {
    const state = readState();
    const result = operation(state);
    state.updated_at = clock();
    validateState(state, workspaceId, projectId);
    atomicWrite(statePath, state);
    return result;
  });

  const candidatePath = (candidateId) => path.join(candidateRoot, `${candidateId}.json`);
  const memoryPath = (memoryId) => path.join(memoryRoot, `${memoryId}.json`);
  const admissionPath = (admissionId) => path.join(admissionRoot, `${admissionId}.json`);
  const candidateEvidenceIds = (candidate) => [
    ...candidate.event_ids,
    candidate.turn_snapshot_id,
    ...candidate.source_snapshot_ids
  ].filter(Boolean).sort();

  const expireTtlMemories = () => {
    const now = Date.parse(clock());
    const state = readState();
    const expired = Object.values(state.memories).filter((entry) => {
      if (entry.status !== "active") return false;
      const memory = readJson(memoryPath(entry.memory_id), "memory_artifact_invalid");
      return memory.valid_until && Date.parse(memory.valid_until) <= now;
    });
    if (expired.length === 0) return;
    mutate((current) => {
      for (const item of expired) {
        const entry = current.memories[item.memory_id];
        if (entry?.status !== "active") continue;
        entry.status = "expired";
        entry.expired_at = clock();
        entry.projection.status = "revocation_pending";
      }
    });
  };

  const createCandidate = (input) => {
    if (input?.workspace_id !== workspaceId || input?.project_id !== projectId) {
      fail("candidate_scope_mismatch");
    }
    const dedupeMaterial = input.dedupe_key
      ? {
        workspace_id: workspaceId,
        project_id: projectId,
        caller_key: boundedText(input.dedupe_key, "candidate_dedupe_key_invalid", 512)
      }
      : {
        workspace_id: workspaceId,
        project_id: projectId,
        archive_id: input.archive_id,
        event_ids: input.event_ids,
        turn_snapshot_id: input.turn_snapshot_id,
        source_snapshot_ids: input.source_snapshot_ids,
        title: input.title,
        proposed_text: input.proposed_text,
        extractor: input.extractor
      };
    const dedupeKey = crypto.createHash("sha256")
      .update(canonicalJson(dedupeMaterial))
      .digest("hex");
    let result;
    mutate((state) => {
      const duplicate = Object.values(state.candidates).find((item) => item.dedupe_key === dedupeKey);
      if (duplicate) {
        result = { ...readJson(candidatePath(duplicate.candidate_id), "candidate_artifact_invalid") };
        return;
      }
      const candidateId = `cand_${generateUuidV7()}`;
      const createdAt = clock();
      const candidate = {
        schema: "supermemory.memory-candidate.v2",
        workspace_id: workspaceId,
        project_id: projectId,
        candidate_id: candidateId,
        archive_id: input.archive_id,
        event_ids: [...input.event_ids],
        turn_snapshot_id: input.turn_snapshot_id,
        source_snapshot_ids: [...input.source_snapshot_ids],
        title: boundedText(input.title, "candidate_title_required", 16 * 1024),
        proposed_text: boundedText(input.proposed_text, "candidate_text_required"),
        type: boundedText(input.type ?? "durable_fact", "candidate_type_required", 120),
        confidence: Number(input.confidence),
        uncertainty: String(input.uncertainty ?? "").slice(0, 16 * 1024),
        sensitivity: input.sensitivity ?? "standard",
        status: "pending",
        extractor: {
          model: boundedText(input.extractor?.model, "candidate_extractor_required", 240),
          prompt_version: boundedText(
            input.extractor?.prompt_version,
            "candidate_extractor_required",
            240
          )
        },
        created_at: createdAt,
        immutable: true
      };
      if (
        !Number.isFinite(candidate.confidence) ||
        candidate.confidence < 0 ||
        candidate.confidence > 1 ||
        !["standard", "restricted"].includes(candidate.sensitivity)
      ) fail("candidate_metadata_invalid");
      atomicWrite(candidatePath(candidateId), candidate, { immutable: true });
      state.candidates[candidateId] = {
        candidate_id: candidateId,
        status: "pending",
        dedupe_key: dedupeKey,
        reviewed_at: null,
        decision: null,
        memory_id: null
      };
      result = candidate;
    });
    return result;
  };

  const listCandidates = ({ status = null } = {}) => {
    const state = readState();
    return Object.values(state.candidates)
      .filter((entry) => !status || entry.status === status)
      .filter((entry) => entry.status !== "purged")
      .map((entry) => ({
        ...readJson(candidatePath(entry.candidate_id), "candidate_artifact_invalid"),
        status: entry.status,
        reviewed_at: entry.reviewed_at,
        decision: entry.decision,
        memory_id: entry.memory_id
      }))
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  };

  const getCandidate = (candidateId) => {
    assertId(candidateId, CANDIDATE_ID, "candidate_id_invalid");
    const state = readState();
    const entry = state.candidates[candidateId];
    if (!entry) fail("candidate_not_found");
    return {
      ...readJson(candidatePath(candidateId), "candidate_artifact_invalid"),
      status: entry.status,
      reviewed_at: entry.reviewed_at,
      decision: entry.decision,
      memory_id: entry.memory_id
    };
  };

  const getMemory = (memoryId, { includeInactive = false } = {}) => {
    assertId(memoryId, MEMORY_ID, "memory_id_invalid");
    expireTtlMemories();
    const state = readState();
    const entry = state.memories[memoryId];
    if (!entry || (!includeInactive && entry.status !== "active")) fail("memory_not_active");
    const memory = readJson(memoryPath(memoryId), "memory_artifact_invalid");
    return { ...memory, status: entry.status, projection: projectionView(entry.projection) };
  };

  const listActiveMemories = ({ consumer = "supermemory" } = {}) => {
    if (!ACTIVE_CONSUMERS.has(consumer)) fail("consumer_invalid");
    expireTtlMemories();
    const state = readState();
    return Object.values(state.memories)
      .filter((entry) => entry.status === "active")
      .map((entry) => ({
        ...readJson(memoryPath(entry.memory_id), "memory_artifact_invalid"),
        status: entry.status,
        projection: projectionView(entry.projection)
      }))
      .filter((memory) => (
        (!memory.valid_until || Date.parse(memory.valid_until) > Date.parse(clock())) &&
        memory.sensitivity !== "restricted" &&
        memory.allowed_consumers.includes(consumer)
      ))
      .sort((left, right) => right.approved_at.localeCompare(left.approved_at));
  };

  const projectMemory = async (memory) => {
    if (!projection || typeof projection.project !== "function") return;
    let projectionResult;
    try {
      projectionResult = await projection.project(memory);
    } catch (error) {
      projectionResult = { status: "queued", error: error?.code ?? "projection_unavailable" };
    }
    mutate((state) => {
      const entry = state.memories[memory.memory_id];
      if (!entry || entry.status !== "active") return;
      entry.projection.attempts += 1;
      entry.projection.status = projectionResult?.status === "synced" ? "synced" : "queued";
      entry.projection.document_id = projectionResult?.documentId ?? memory.memory_id;
      entry.projection.synced_at = entry.projection.status === "synced" ? clock() : null;
      entry.projection.last_error = entry.projection.status === "queued"
        ? String(projectionResult?.error ?? "projection_pending").slice(0, 240)
        : null;
    });
  };

  const admitCandidate = async (candidateId, { verification } = {}) => {
    assertId(candidateId, CANDIDATE_ID, "candidate_id_invalid");
    if (admissionMode !== "automatic") fail("automatic_admission_disabled");
    let activated = null;
    let response;
    mutate((state) => {
      const entry = state.candidates[candidateId];
      if (!entry) fail("candidate_not_found");
      if (entry.admission_id && entry.status !== "quarantined") {
        const admission = readJson(admissionPath(entry.admission_id), "admission_artifact_invalid");
        const candidate = readJson(candidatePath(candidateId), "candidate_artifact_invalid");
        if (!verifyAdmissionDecision(admission, {
          candidateId,
          workspaceId,
          policyVersion: policy.policyVersion,
          evidenceIds: candidateEvidenceIds(candidate)
        })) fail("admission_artifact_invalid");
        response = {
          status: admission.decision,
          candidate: { ...readJson(candidatePath(candidateId), "candidate_artifact_invalid"), ...entry },
          admission,
          memory: entry.memory_id ? {
            ...readJson(memoryPath(entry.memory_id), "memory_artifact_invalid"),
            status: state.memories[entry.memory_id]?.status,
            projection: projectionView(state.memories[entry.memory_id]?.projection)
          } : null
        };
        return;
      }
      if (!["pending", "pending_verification", "quarantined"].includes(entry.status)) {
        fail("candidate_already_admitted");
      }
      const candidate = readJson(candidatePath(candidateId), "candidate_artifact_invalid");
      const result = policy.evaluate({ candidate, verification });
      if (result.status === "pending_verification") {
        entry.status = "pending_verification";
        entry.decision = null;
        response = { ...result, candidate: { ...candidate, ...entry }, memory: null };
        return;
      }
      if (!verifyAdmissionDecision(result.admission, {
        candidateId,
        workspaceId,
        policyVersion: policy.policyVersion,
        evidenceIds: candidateEvidenceIds(candidate)
      })) fail("admission_artifact_invalid");
      atomicWrite(admissionPath(result.admission.admission_id), result.admission, { immutable: true });
      entry.status = result.decision === "quarantine" ? "quarantined" : result.decision;
      entry.admission_id = result.admission.admission_id;
      entry.admission_history = [...new Set([...(entry.admission_history ?? []), entry.admission_id])];
      entry.decision = { action: result.decision, decided_by: result.admission.decided_by };
      entry.reviewed_at = null;
      if (!result.recall_allowed) {
        response = { ...result, candidate: { ...candidate, ...entry }, memory: null };
        return;
      }
      const memoryId = entry.memory_id ?? `mem_${generateUuidV7()}`;
      const memory = {
        schema: "supermemory.active-memory.v2",
        memory_id: memoryId,
        workspace_id: workspaceId,
        project_id: projectId,
        candidate_id: candidateId,
        admission_id: result.admission.admission_id,
        admission_decision: result.decision,
        policy_version: result.admission.policy_version,
        evidence: [...candidate.event_ids, candidate.turn_snapshot_id, ...candidate.source_snapshot_ids],
        title: candidate.title,
        text: candidate.proposed_text,
        sensitivity: candidate.sensitivity,
        allowed_consumers: ["supermemory", "codex"],
        approved_by: result.admission.decided_by,
        approved_at: result.admission.decided_at,
        valid_from: result.admission.decided_at,
        valid_until: result.admission.expires_at,
        status: "active",
        immutable: true
      };
      atomicWrite(memoryPath(memoryId), memory, { immutable: true });
      entry.memory_id = memoryId;
      state.memories[memoryId] = {
        memory_id: memoryId,
        candidate_id: candidateId,
        admission_id: result.admission.admission_id,
        status: "active",
        projection: projectionView({ document_id: memoryId, status: "queued" }),
        revoked_at: null,
        revocation_reason: null
      };
      activated = memory;
      response = { ...result, candidate: { ...candidate, ...entry }, admission: result.admission, memory };
    });
    if (activated) {
      await projectMemory(activated);
      response.memory = getMemory(activated.memory_id);
      response.candidate = getCandidate(candidateId);
    }
    return response;
  };

  const reviewCandidate = async (candidateId, {
    action,
    approvedBy = "local_owner",
    title = null,
    text = null,
    allowedConsumers = ["supermemory", "codex"],
    verification = null
  } = {}) => {
    assertId(candidateId, CANDIDATE_ID, "candidate_id_invalid");
    if (!["approve", "reject"].includes(action)) fail("review_action_invalid");
    if (admissionMode === "automatic") {
      const candidate = getCandidate(candidateId);
      if (candidate.status !== "quarantined") fail("review_reserved_for_quarantine");
      const resolved = await admitCandidate(candidateId, { verification });
      const accepted = ["auto_activate", "activate_ttl"].includes(resolved.decision);
      if ((action === "approve" && !accepted) || (action === "reject" && resolved.decision !== "discard")) {
        fail("quarantine_resolution_not_verified");
      }
      return resolved;
    }
    if (
      !Array.isArray(allowedConsumers) ||
      allowedConsumers.length === 0 ||
      allowedConsumers.some((consumer) => !ACTIVE_CONSUMERS.has(consumer))
    ) fail("memory_consumers_invalid");
    let memory = null;
    let reviewedCandidate;
    mutate((state) => {
      const entry = state.candidates[candidateId];
      if (!entry) fail("candidate_not_found");
      if (entry.status !== "pending") fail("candidate_already_reviewed");
      const candidate = readJson(candidatePath(candidateId), "candidate_artifact_invalid");
      const reviewedAt = clock();
      entry.status = action === "approve" ? "approved" : "rejected";
      entry.reviewed_at = reviewedAt;
      entry.decision = { action, approved_by: approvedBy };
      if (action === "reject") {
        reviewedCandidate = { ...candidate, ...entry };
        return;
      }
      const memoryId = `mem_${generateUuidV7()}`;
      memory = {
        schema: "supermemory.active-memory.v2",
        memory_id: memoryId,
        workspace_id: workspaceId,
        project_id: projectId,
        candidate_id: candidateId,
        evidence: [
          ...candidate.event_ids,
          candidate.turn_snapshot_id,
          ...candidate.source_snapshot_ids
        ],
        title: boundedText(title ?? candidate.title, "memory_title_required", 16 * 1024),
        text: boundedText(text ?? candidate.proposed_text, "memory_text_required"),
        sensitivity: candidate.sensitivity,
        allowed_consumers: [...new Set(allowedConsumers)],
        approved_by: approvedBy,
        approved_at: reviewedAt,
        valid_from: reviewedAt,
        valid_until: null,
        status: "active",
        immutable: true
      };
      // The canonical memory is durable before state makes it active or projection can run.
      atomicWrite(memoryPath(memoryId), memory, { immutable: true });
      entry.memory_id = memoryId;
      state.memories[memoryId] = {
        memory_id: memoryId,
        candidate_id: candidateId,
        status: "active",
        projection: projectionView({ document_id: memoryId, status: "queued" }),
        revoked_at: null,
        revocation_reason: null
      };
      reviewedCandidate = { ...candidate, ...entry };
    });
    if (!memory) return { status: "rejected", candidate: reviewedCandidate, memory: null };

    await projectMemory(memory);
    return {
      status: "approved",
      candidate: getCandidate(candidateId),
      memory: getMemory(memory.memory_id)
    };
  };

  const revokeMemory = async (memoryId, {
    reason,
    revokedBy = "local_owner"
  } = {}) => {
    assertId(memoryId, MEMORY_ID, "memory_id_invalid");
    const revocationReason = boundedText(reason, "revocation_reason_required", 2_000);
    let revoked;
    mutate((state) => {
      const entry = state.memories[memoryId];
      if (!entry) fail("memory_not_found");
      if (entry.status === "revoked") {
        revoked = {
          ...readJson(memoryPath(memoryId), "memory_artifact_invalid"),
          status: entry.status,
          projection: projectionView(entry.projection)
        };
        return;
      }
      if (!["active", "stale"].includes(entry.status)) fail("memory_not_active");
      entry.status = "revoked";
      entry.revoked_at = clock();
      entry.revocation_reason = revocationReason;
      entry.revoked_by = revokedBy;
      entry.projection.status = "revocation_pending";
      revoked = {
        ...readJson(memoryPath(memoryId), "memory_artifact_invalid"),
        status: "revoked"
      };
    });
    // Logical revocation is already durable; projection deletion is best effort.
    if (projection && typeof projection.delete === "function") {
      try {
        await projection.delete(revoked);
        mutate((state) => {
          const entry = state.memories[memoryId];
          if (entry?.status === "revoked") entry.projection.status = "deleted";
        });
      } catch (error) {
        mutate((state) => {
          const entry = state.memories[memoryId];
          if (entry?.status === "revoked") {
            entry.projection.status = "revocation_pending";
            entry.projection.last_error = String(error?.code ?? "delete_unavailable").slice(0, 240);
          }
        });
      }
    }
    return getMemory(memoryId, { includeInactive: true });
  };

  const invalidateEvidence = async ({
    snapshotIds,
    reason = "source_changed"
  } = {}) => {
    if (
      !Array.isArray(snapshotIds) ||
      snapshotIds.length === 0 ||
      snapshotIds.some((id) => !/^snap_[0-9a-f]{64}$/.test(String(id)))
    ) fail("snapshot_ids_invalid");
    const invalidated = new Set(snapshotIds);
    const stale = [];
    mutate((state) => {
      for (const entry of Object.values(state.candidates)) {
        if (!["pending", "approved"].includes(entry.status)) continue;
        const candidate = readJson(
          candidatePath(entry.candidate_id),
          "candidate_artifact_invalid"
        );
        if (!candidate.source_snapshot_ids.some((id) => invalidated.has(id))) continue;
        entry.previous_status = entry.status;
        entry.status = "superseded";
        entry.superseded_at = clock();
        entry.superseded_reason = String(reason).slice(0, 120);
      }
      for (const entry of Object.values(state.memories)) {
        if (entry.status !== "active") continue;
        const memory = readJson(memoryPath(entry.memory_id), "memory_artifact_invalid");
        if (!memory.evidence.some((id) => invalidated.has(id))) continue;
        entry.status = "stale";
        entry.stale_at = clock();
        entry.stale_reason = String(reason).slice(0, 120);
        entry.projection.status = "revocation_pending";
        entry.projection.last_error = null;
        stale.push(memory);
      }
    });
    for (const memory of stale) {
      if (!projection || typeof projection.delete !== "function") continue;
      try {
        await projection.delete(memory);
        mutate((state) => {
          const entry = state.memories[memory.memory_id];
          if (entry?.status === "stale") {
            entry.projection.status = "deleted";
            entry.projection.last_error = null;
            entry.projection.synced_at = clock();
          }
        });
      } catch (error) {
        mutate((state) => {
          const entry = state.memories[memory.memory_id];
          if (entry?.status === "stale") {
            entry.projection.status = "revocation_pending";
            entry.projection.attempts += 1;
            entry.projection.last_error = String(
              error?.code ?? "delete_unavailable"
            ).slice(0, 240);
          }
        });
      }
    }
    return {
      status: "invalidated",
      stale_memories: stale.length,
      snapshot_ids: [...invalidated],
      recall_allowed: false
    };
  };

  const markMemoryPurged = (memoryId, { attestationId } = {}) => {
    assertId(memoryId, MEMORY_ID, "memory_id_invalid");
    const id = boundedText(attestationId, "attestation_id_required", 160);
    return mutate((state) => {
      const entry = state.memories[memoryId];
      if (!entry) fail("memory_not_found");
      if (entry.status === "purged") return { ...entry };
      if (entry.status !== "revoked") fail("memory_tombstone_required");
      if (entry.projection.status !== "deleted") fail("projection_delete_unverified");
      const target = memoryPath(memoryId);
      if (fs.existsSync(target)) fs.rmSync(target);
      entry.status = "purged";
      entry.purged_at = clock();
      entry.attestation_id = id;
      return { ...entry };
    });
  };

  const memoryEntry = (memoryId) => {
    assertId(memoryId, MEMORY_ID, "memory_id_invalid");
    const entry = readState().memories[memoryId];
    if (!entry) fail("memory_not_found");
    return { ...entry, projection: projectionView(entry.projection) };
  };

  const resolveCitation = (candidate) => {
    if (candidate.workspace_id !== workspaceId) fail("candidate_scope_mismatch");
    if (candidate.turn_snapshot_id) {
      return {
        kind: "turn_snapshot",
        turn_snapshot_id: candidate.turn_snapshot_id
      };
    }
    const legacyIds = candidate.source_snapshot_ids.filter((id) => (
      /^lev_[0-9a-f]{64}$/.test(String(id))
    ));
    if (legacyIds.length === 0) fail("citation_unresolved");
    const artifacts = legacyIds.map((evidenceId) => {
      const target = path.join(legacyEvidenceRoot, `${evidenceId}.json`);
      if (!fs.existsSync(target)) fail("citation_unresolved");
      const value = readJson(target, "citation_unresolved");
      if (
        value?.schema !== "supermemory.legacy-migration-evidence.v1" ||
        value.evidence_id !== evidenceId ||
        value.workspace_id !== workspaceId ||
        value.project_id !== projectId ||
        value.immutable !== true ||
        value.integrity_hash !== evidenceIntegrityHash(value)
      ) fail("citation_unresolved");
      return {
        evidence_id: evidenceId,
        source_id: value.source_id ?? null,
        legacy_snapshot_id: value.legacy_snapshot_id ?? null,
        legacy_state_hash: value.legacy_state_hash,
        backup_id: value.backup_id
      };
    });
    return {
      kind: "legacy_migration_evidence",
      evidence_ids: legacyIds,
      artifacts
    };
  };

  const markCandidatePurged = (candidateId, { reason = "retention_expired" } = {}) => {
    assertId(candidateId, CANDIDATE_ID, "candidate_id_invalid");
    return mutate((state) => {
      const entry = state.candidates[candidateId];
      if (!entry) fail("candidate_not_found");
      if (entry.status === "purged") return { ...entry };
      const target = candidatePath(candidateId);
      if (fs.existsSync(target)) fs.rmSync(target);
      entry.previous_status = entry.status;
      entry.status = "purged";
      entry.purged_at = clock();
      entry.purge_reason = String(reason).slice(0, 120);
      return { ...entry };
    });
  };

  const importLegacyApprovedMemory = ({
    memoryId,
    legacyCandidateId,
    title,
    text,
    evidence = [],
    approvedAt,
    sensitivity = "standard",
    sourceMapping = null
  } = {}) => {
    assertId(memoryId, MEMORY_ID, "memory_id_invalid");
    let imported;
    mutate((state) => {
      if (state.memories[memoryId]) {
        const entry = state.memories[memoryId];
        imported = {
          ...readJson(memoryPath(memoryId), "memory_artifact_invalid"),
          status: entry.status,
          projection: projectionView(entry.projection)
        };
        return;
      }
      const candidateId = `cand_${generateUuidV7()}`;
      const candidate = {
        schema: "supermemory.memory-candidate.v2",
        workspace_id: workspaceId,
        project_id: projectId,
        candidate_id: candidateId,
        archive_id: null,
        event_ids: [],
        turn_snapshot_id: null,
        source_snapshot_ids: [...evidence],
        title: boundedText(title, "candidate_title_required", 16 * 1024),
        proposed_text: boundedText(text, "candidate_text_required"),
        type: "legacy_approved_memory",
        confidence: 1,
        uncertainty: "Imported from owner-reviewed product-store v1.",
        sensitivity,
        status: "pending",
        extractor: { model: "deterministic-migration", prompt_version: "v1" },
        legacy_candidate_id: legacyCandidateId ?? null,
        source_mapping: sourceMapping,
        created_at: approvedAt ?? clock(),
        immutable: true
      };
      const memory = {
        schema: "supermemory.active-memory.v2",
        memory_id: memoryId,
        workspace_id: workspaceId,
        project_id: projectId,
        candidate_id: candidateId,
        evidence: [...evidence],
        title: candidate.title,
        text: candidate.proposed_text,
        sensitivity,
        allowed_consumers: ["supermemory", "codex"],
        approved_by: "legacy_local_owner",
        approved_at: approvedAt ?? clock(),
        valid_from: approvedAt ?? clock(),
        valid_until: null,
        status: "active",
        immutable: true,
        legacy_import: true
      };
      atomicWrite(candidatePath(candidateId), candidate, { immutable: true });
      atomicWrite(memoryPath(memoryId), memory, { immutable: true });
      state.candidates[candidateId] = {
        candidate_id: candidateId,
        status: "approved",
        dedupe_key: `legacy:${memoryId}`,
        reviewed_at: memory.approved_at,
        decision: { action: "approve", approved_by: "legacy_local_owner" },
        memory_id: memoryId
      };
      state.memories[memoryId] = {
        memory_id: memoryId,
        candidate_id: candidateId,
        status: "active",
        projection: projectionView({ document_id: memoryId, status: "queued" }),
        revoked_at: null,
        revocation_reason: null
      };
      imported = memory;
    });
    return imported;
  };

  const legacyCompatibility = () => {
    if (!fs.existsSync(legacyStatePath)) return { status: "absent", path: null };
    const stat = fs.lstatSync(legacyStatePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("legacy_product_state_invalid");
    const bytes = fs.readFileSync(legacyStatePath);
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("legacy_product_state_invalid");
    }
    return {
      status: value?.version === 1 ? "preserved_v1" : "unsupported",
      path: legacyStatePath,
      content_hash: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
      workspace_id: value?.workspace?.workspaceId ?? null,
      mutated: false
    };
  };

  return {
    vaultRoot: vault,
    workspaceId,
    projectId,
    paths: { statePath, candidateRoot, memoryRoot, admissionRoot, legacyEvidenceRoot },
    createCandidate,
    listCandidates,
    getCandidate,
    admitCandidate,
    reviewCandidate,
    getMemory,
    listActiveMemories,
    revokeMemory,
    invalidateEvidence,
    markMemoryPurged,
    markCandidatePurged,
    importLegacyApprovedMemory,
    memoryEntry,
    resolveCitation,
    legacyCompatibility
  };
}
