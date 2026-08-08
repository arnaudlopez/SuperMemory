import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-redaction.mjs";

export class CodexLifecycleError extends Error {
  constructor(code) {
    super(code);
    this.name = "CodexLifecycleError";
    this.code = code;
  }
}

function fail(code) {
  throw new CodexLifecycleError(code);
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${canonicalJson(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function opaque(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

export function createCodexLifecycle({
  workspaceStore,
  archiveStore,
  clock = () => new Date().toISOString()
} = {}) {
  if (!workspaceStore?.workspaceId || !workspaceStore?.vaultRoot) fail("workspace_store_required");
  if (!archiveStore?.workspaceId) fail("archive_store_required");
  if (workspaceStore.workspaceId !== archiveStore.workspaceId) fail("scope_mismatch");
  const attestationRoot = path.join(
    workspaceStore.vaultRoot,
    "80_logs",
    "codex-deletion-attestations",
    workspaceStore.workspaceId
  );

  const attestation = (kind, target, details = {}) => {
    const completedAt = clock();
    const id = `del_${crypto.createHash("sha256")
      .update(canonicalJson({ kind, target, completedAt, details }))
      .digest("hex")}`;
    const record = {
      schema: "supermemory.deletion-attestation.v1",
      attestation_id: id,
      workspace_id: workspaceStore.workspaceId,
      target_kind: kind,
      target_fingerprint: opaque(target),
      completed_at: completedAt,
      ...details
    };
    atomicWrite(path.join(attestationRoot, `${id}.json`), record);
    return record;
  };

  const deleteMemory = async (memoryId, {
    confirmation,
    reason = "owner_requested",
    revokedBy = "local_owner"
  } = {}) => {
    if (confirmation !== `DELETE ${memoryId}`) fail("exact_confirmation_required");
    const before = workspaceStore.memoryEntry(memoryId);
    if (before.status === "purged") {
      return { status: "purged", idempotent: true, attestation_id: before.attestation_id };
    }
    await workspaceStore.revokeMemory(memoryId, { reason, revokedBy });
    const tombstone = workspaceStore.memoryEntry(memoryId);
    if (tombstone.projection.status !== "deleted") {
      return {
        status: "tombstone",
        recall_allowed: false,
        retry_required: true,
        projection: tombstone.projection
      };
    }
    const proof = attestation("memory", memoryId, {
      projection_delete_verified: true,
      memories_native_codex_covered: false
    });
    workspaceStore.markMemoryPurged(memoryId, { attestationId: proof.attestation_id });
    return { status: "purged", idempotent: false, attestation_id: proof.attestation_id };
  };

  const enforceRetention = ({ now = clock() } = {}) => {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) fail("retention_time_invalid");
    const results = [];
    for (const metadata of archiveStore.listMetadata({ status: null })) {
      if (metadata.retention_class === "legal_hold") {
        results.push({ archive_id: metadata.archive_id, status: "legal_hold" });
        continue;
      }
      if (!metadata.expires_at || Date.parse(metadata.expires_at) > nowMs) continue;
      const tombstone = archiveStore.tombstoneArchive(metadata.archive_id);
      const purged = archiveStore.purgeArchive(metadata.archive_id);
      const proof = attestation("archive", metadata.archive_id, {
        tombstoned_at: tombstone.tombstoned_at,
        ciphertext_purged: purged.status === "purged"
      });
      results.push({
        archive_id: metadata.archive_id,
        status: "purged",
        attestation_id: proof.attestation_id
      });
    }
    return results;
  };

  const deleteSession = async (sessionId, { confirmation } = {}) => {
    if (confirmation !== `DELETE SESSION ${sessionId}`) fail("exact_confirmation_required");
    const archives = archiveStore.listMetadata({ sessionId, status: null });
    if (archives.length === 0) return { status: "absent", idempotent: true };
    const archiveIds = new Set(archives.map((item) => item.archive_id));
    const candidates = workspaceStore.listCandidates().filter((candidate) => (
      archiveIds.has(candidate.archive_id)
    ));
    const memoryResults = [];
    for (const candidate of candidates) {
      if (candidate.memory_id) {
        memoryResults.push(await deleteMemory(candidate.memory_id, {
          confirmation: `DELETE ${candidate.memory_id}`,
          reason: "session_deleted"
        }));
      }
      if (!candidate.memory_id || memoryResults.at(-1)?.status === "purged") {
        workspaceStore.markCandidatePurged(candidate.candidate_id, {
          reason: "session_deleted"
        });
      }
    }
    const archiveResults = [];
    for (const archive of archives) {
      if (archive.retention_class === "legal_hold") {
        archiveResults.push({ archive_id: archive.archive_id, status: "legal_hold" });
        continue;
      }
      archiveStore.tombstoneArchive(archive.archive_id, { reason: "session_deleted" });
      archiveResults.push({
        archive_id: archive.archive_id,
        status: archiveStore.purgeArchive(archive.archive_id).status
      });
    }
    const partial = memoryResults.some((item) => item.status !== "purged") ||
      archiveResults.some((item) => item.status !== "purged");
    const proof = attestation("session", sessionId, {
      memories: memoryResults.length,
      archives: archiveResults.length,
      partial,
      memories_native_codex_covered: false
    });
    return {
      status: partial ? "partial" : "purged",
      retry_required: partial,
      attestation_id: proof.attestation_id,
      memories: memoryResults,
      archives: archiveResults
    };
  };

  return { deleteMemory, deleteSession, enforceRetention, attestationRoot };
}
