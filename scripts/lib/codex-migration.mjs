import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-redaction.mjs";
import { createCodexWorkspaceStore } from "./codex-workspace-store.mjs";
import { createProductBackupManager } from "./product-backup.mjs";

export class CodexMigrationError extends Error {
  constructor(code) {
    super(code);
    this.name = "CodexMigrationError";
    this.code = code;
  }
}

function fail(code) {
  throw new CodexMigrationError(code);
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function withoutHash(value) {
  const clone = structuredClone(value);
  delete clone.plan_hash;
  return clone;
}

function planHash(value) {
  return hash(canonicalJson(withoutHash(value)));
}

function legacyId(source) {
  return hash(canonicalJson({
    source_path: source.relativePath ?? source.relative_path ?? "",
    legacy_record_id: source.sourceId ?? source.source_id ?? "",
    content_hash: source.contentHash ?? source.content_hash ?? ""
  }));
}

function similarityKey(value) {
  return String(value ?? "").toLocaleLowerCase("fr").replace(/[^a-z0-9]/g, "");
}

function deterministicMemoryId(value) {
  const hex = crypto.createHash("sha256").update(String(value)).digest("hex");
  return `mem_${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function legacyEvidenceId(mapping, legacyStateHash, workspaceId) {
  return `lev_${crypto.createHash("sha256").update(canonicalJson({
    legacy_id: mapping.legacy_id,
    canonical_source_id: mapping.canonical_source_id,
    active_snapshot_id: mapping.active_snapshot_id,
    legacy_state_hash: legacyStateHash,
    workspace_id: workspaceId
  })).digest("hex")}`;
}

function legacyMemoryEvidenceId(legacyMemoryId, legacyStateHash, workspaceId) {
  return `lev_${crypto.createHash("sha256").update(canonicalJson({
    legacy_memory_id: legacyMemoryId,
    legacy_state_hash: legacyStateHash,
    workspace_id: workspaceId
  })).digest("hex")}`;
}

function signedEvidence(body, evidenceId) {
  const value = { ...body, evidence_id: evidenceId };
  return {
    ...value,
    integrity_hash: hash(canonicalJson(value))
  };
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${canonicalJson(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function immutableJson(filePath, value) {
  const content = `${canonicalJson(value)}\n`;
  if (fs.existsSync(filePath)) {
    if (fs.readFileSync(filePath, "utf8") !== content) fail("migration_evidence_conflict");
    return false;
  }
  atomicJson(filePath, value);
  return true;
}

function redactLegacyText(value) {
  const original = String(value ?? "");
  const redacted = original
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED:API_KEY]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[REDACTED:PRIVATE_KEY]")
    .replace(/\b(api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  return { text: redacted, redacted: redacted !== original };
}

export function createCodexMigration({
  vaultRoot,
  backupsRoot,
  clock = () => new Date().toISOString(),
  deleteSacrificialBank = async () => ({ deleted: true })
} = {}) {
  const vault = path.resolve(vaultRoot);
  const legacyPath = path.join(vault, "00_inbox", "supermemory-product", "state.json");

  const plan = ({ projectId = null, workspaceId = null } = {}) => {
    if (!fs.existsSync(legacyPath)) {
      const result = {
        schema: "supermemory.codex-migration-plan.v1",
        migration_id: "mig_none",
        generated_at: clock(),
        mode: "dry_run",
        writes_performed: false,
        status: "nothing_to_migrate",
        project_id: projectId,
        workspace_id: workspaceId,
        legacy_state_hash: null,
        mappings: { sources: [], memories: [] },
        collisions: []
      };
      return { ...result, plan_hash: planHash(result) };
    }
    const bytes = fs.readFileSync(legacyPath);
    let state;
    try {
      state = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("legacy_state_invalid");
    }
    if (state?.version !== 1) fail("legacy_state_unsupported");
    const stateHash = hash(bytes);
    const migrationId = `mig_${crypto.createHash("sha256")
      .update(`${stateHash}\0${projectId ?? ""}\0${workspaceId ?? ""}`)
      .digest("hex")}`;
    const sources = (state.sources ?? []).map((source) => {
      const id = legacyId(source);
      const mapping = {
        legacy_source_id: source.sourceId ?? source.source_id,
        legacy_id: id,
        canonical_source_id: `src_${id.slice("sha256:".length)}`,
        path_fingerprint: hash(source.relativePath ?? source.relative_path ?? ""),
        active_snapshot_id: source.activeSnapshotId ?? source.active_snapshot_id ?? null
      };
      return {
        ...mapping,
        migration_evidence_id: workspaceId
          ? legacyEvidenceId(mapping, stateHash, workspaceId)
          : null
      };
    });
    const groups = new Map();
    for (const source of sources) {
      const legacySource = (state.sources ?? []).find((candidate) => (
        (candidate.sourceId ?? candidate.source_id) === source.legacy_source_id
      ));
      const key = similarityKey(
        legacySource?.relativePath ?? legacySource?.relative_path
      );
      const items = groups.get(key) ?? [];
      items.push(source.legacy_source_id);
      groups.set(key, items);
    }
    const collisions = [...groups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([similarity_key, legacy_source_ids]) => ({
        similarity_key,
        legacy_source_ids,
        action: "owner_review_required"
      }));
    const memoryMappings = (state.memories ?? []).map((memory) => ({
      legacy_memory_id: memory.memoryId ?? memory.memory_id,
      canonical_memory_id: /^mem_[0-9a-f-]{36}$/i
        .test(String(memory.memoryId ?? memory.memory_id))
        ? memory.memoryId ?? memory.memory_id
        : deterministicMemoryId(memory.memoryId ?? memory.memory_id),
      status: memory.status,
      scope_status: memory.sourceId ?? memory.source_id ? "mapped" : "scope_review"
    }));
    const result = {
      schema: "supermemory.codex-migration-plan.v1",
      migration_id: migrationId,
      generated_at: clock(),
      mode: "dry_run",
      writes_performed: false,
      status: !projectId || !workspaceId
        ? "legacy_unbound"
        : collisions.length > 0
          ? "review_required"
          : "ready",
      project_id: projectId,
      workspace_id: workspaceId,
      legacy_workspace_id: state.workspace?.workspaceId ?? null,
      legacy_state_hash: stateHash,
      mappings: { sources, memories: memoryMappings },
      collisions,
      counts: {
        sources: sources.length,
        candidates: (state.candidates ?? []).length,
        memories: memoryMappings.length,
        snapshots: (state.snapshots ?? []).length,
        scope_review_memories: memoryMappings.filter((entry) => (
          entry.scope_status === "scope_review"
        )).length
      },
      native_memories: {
        authoritative: false,
        covered_by_migration_or_deletion: false
      }
    };
    return { ...result, plan_hash: planHash(result) };
  };

  const apply = (migrationPlan, { confirmation } = {}) => {
    if (planHash(migrationPlan) !== migrationPlan.plan_hash) fail("migration_plan_tampered");
    if (confirmation !== `APPLY ${migrationPlan.migration_id}`) fail("exact_confirmation_required");
    if (migrationPlan.status === "legacy_unbound") fail("legacy_unbound");
    if (migrationPlan.status === "review_required") fail("migration_collision_review_required");
    if (migrationPlan.status !== "ready") fail("migration_not_ready");
    const current = plan({
      projectId: migrationPlan.project_id,
      workspaceId: migrationPlan.workspace_id
    });
    if (
      current.legacy_state_hash !== migrationPlan.legacy_state_hash ||
      current.migration_id !== migrationPlan.migration_id
    ) fail("migration_source_changed");
    const checkpointPath = path.join(
      vault,
      "00_inbox",
      "supermemory-product",
      "codex-migrations",
      `${migrationPlan.migration_id}.json`
    );
    if (fs.existsSync(checkpointPath)) {
      const existing = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
      return { ...existing, idempotent: true };
    }
    const backups = createProductBackupManager({ vaultRoot: vault, backupsRoot, clock });
    const backup = backups.create({ reason: `codex-migration:${migrationPlan.migration_id}` });
    backups.verify(backup.backupId);
    const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
    const store = createCodexWorkspaceStore({
      vaultRoot: vault,
      workspaceId: migrationPlan.workspace_id,
      projectId: migrationPlan.project_id,
      clock
    });
    const sourceMap = new Map(migrationPlan.mappings.sources.map((entry) => [
      entry.legacy_source_id,
      entry
    ]));
    const memoryMap = new Map(migrationPlan.mappings.memories.map((entry) => [
      entry.legacy_memory_id,
      entry.canonical_memory_id
    ]));
    let imported = 0;
    let redacted = 0;
    const legacyEvidenceRoot = path.join(
      vault,
      "00_inbox",
      "snapshots",
      "legacy",
      migrationPlan.workspace_id
    );
    for (const source of migrationPlan.mappings.sources) {
      const evidenceId = source.migration_evidence_id;
      if (!/^lev_[0-9a-f]{64}$/.test(String(evidenceId))) {
        fail("migration_evidence_invalid");
      }
      const body = {
        schema: "supermemory.legacy-migration-evidence.v1",
        workspace_id: migrationPlan.workspace_id,
        project_id: migrationPlan.project_id,
        source_id: source.canonical_source_id,
        legacy_id: source.legacy_id,
        legacy_source_fingerprint: hash(source.legacy_source_id ?? ""),
        source_path_fingerprint: source.path_fingerprint,
        legacy_snapshot_id: source.active_snapshot_id,
        legacy_state_hash: migrationPlan.legacy_state_hash,
        backup_id: backup.backupId,
        immutable: true
      };
      immutableJson(
        path.join(legacyEvidenceRoot, `${evidenceId}.json`),
        signedEvidence(body, evidenceId)
      );
    }
    for (const memory of legacy.memories ?? []) {
      if (memory.status !== "active") continue;
      const legacyMemoryId = memory.memoryId ?? memory.memory_id;
      const memoryMapping = migrationPlan.mappings.memories.find((entry) => (
        entry.legacy_memory_id === legacyMemoryId
      ));
      if (memoryMapping?.scope_status === "scope_review") continue;
      const source = sourceMap.get(memory.sourceId ?? memory.source_id) ?? null;
      const migratedTitle = redactLegacyText(memory.title);
      const migratedText = redactLegacyText(memory.text);
      if (migratedTitle.redacted || migratedText.redacted) redacted += 1;
      const evidenceId = source?.migration_evidence_id ?? legacyMemoryEvidenceId(
        legacyMemoryId,
        migrationPlan.legacy_state_hash,
        migrationPlan.workspace_id
      );
      if (!source) {
        const body = {
          schema: "supermemory.legacy-migration-evidence.v1",
          workspace_id: migrationPlan.workspace_id,
          project_id: migrationPlan.project_id,
          source_id: null,
          legacy_id: null,
          legacy_memory_fingerprint: hash(legacyMemoryId ?? ""),
          source_path_fingerprint: null,
          legacy_snapshot_id: memory.snapshotId ?? memory.snapshot_id ?? null,
          legacy_state_hash: migrationPlan.legacy_state_hash,
          backup_id: backup.backupId,
          immutable: true
        };
        immutableJson(
          path.join(legacyEvidenceRoot, `${evidenceId}.json`),
          signedEvidence(body, evidenceId)
        );
      }
      store.importLegacyApprovedMemory({
        memoryId: memoryMap.get(legacyMemoryId),
        legacyCandidateId: memory.candidateId ?? memory.candidate_id,
        title: migratedTitle.text,
        text: migratedText.text,
        evidence: [evidenceId],
        approvedAt: memory.approvedAt ?? memory.approved_at ?? clock(),
        sensitivity: memory.sensitivity === "restricted" ? "restricted" : "standard",
        sourceMapping: source
      });
      imported += 1;
    }
    const checkpoint = {
      schema: "supermemory.codex-migration-checkpoint.v1",
      migration_id: migrationPlan.migration_id,
      status: "cutover_codex_complete",
      completed_at: clock(),
      project_id: migrationPlan.project_id,
      workspace_id: migrationPlan.workspace_id,
      backup_id: backup.backupId,
      backup_verified: true,
      imported_active_memories: imported,
      redacted_legacy_memories: redacted,
      source_mappings: migrationPlan.mappings.sources.length,
      scope_review_memories: migrationPlan.mappings.memories.filter((entry) => (
        entry.scope_status === "scope_review"
      )).length,
      legacy_state_preserved_for_product_compatibility: true,
      native_memories_authoritative: false,
      idempotent: false
    };
    atomicJson(checkpointPath, checkpoint);
    return checkpoint;
  };

  const rollback = async (checkpoint, { confirmation } = {}) => {
    if (confirmation !== `ROLLBACK ${checkpoint.migration_id}`) {
      fail("exact_confirmation_required");
    }
    const backups = createProductBackupManager({ vaultRoot: vault, backupsRoot, clock });
    const restored = backups.restore(
      checkpoint.backup_id,
      `RESTORE ${checkpoint.backup_id}`
    );
    await deleteSacrificialBank(checkpoint.workspace_id);
    return {
      status: "migration_rolled_back",
      migration_id: checkpoint.migration_id,
      restored_backup_id: checkpoint.backup_id,
      safety_backup_id: restored.safetyBackupId,
      new_vault_preserved_in_safety_backup: true,
      legacy_reactivated: true,
      dual_capture_enabled: false
    };
  };

  return { plan, apply, rollback };
}
