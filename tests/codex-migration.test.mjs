import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexMigration } from "../scripts/lib/codex-migration.mjs";
import { createCodexWorkspaceStore } from "../scripts/lib/codex-workspace-store.mjs";

const PROJECT = "prj_018f1234-5678-7abc-8def-0123456789a1";
const WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789a2";
const MEMORY = `memory:${"a".repeat(64)}`;
const NOW = "2026-07-24T20:00:00.000Z";

function fixture(t, { collision = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-migration-"));
  const vault = path.join(root, "vault");
  const backups = path.join(root, "backups");
  const stateRoot = path.join(vault, "00_inbox", "supermemory-product");
  fs.mkdirSync(stateRoot, { recursive: true });
  const sources = [{
    sourceId: "source:legacy:a",
    relativePath: collision ? "Foo-Bar.md" : "architecture.md",
    contentHash: `sha256:${"1".repeat(64)}`,
    activeSnapshotId: "snap:legacy:a"
  }, ...(collision ? [{
    sourceId: "source:legacy:b",
    relativePath: "foobar.md",
    contentHash: `sha256:${"2".repeat(64)}`,
    activeSnapshotId: "snap:legacy:b"
  }] : [])];
  const token = ["sk", "-", "fixturelegacyvalue"].join("");
  const state = {
    version: 1,
    workspace: { workspaceId: "workspace:local", createdAt: NOW, updatedAt: NOW },
    sources,
    snapshots: [{ snapshotId: "snap:legacy:a", sourceId: "source:legacy:a" }],
    candidates: [{ candidateId: "candidate:legacy:a", sourceId: "source:legacy:a" }],
    memories: [{
      memoryId: MEMORY,
      candidateId: "candidate:legacy:a",
      sourceId: "source:legacy:a",
      snapshotId: "snap:legacy:a",
      title: "Legacy decision",
      text: `Use PostgreSQL. temporary credential ${token}`,
      status: "active",
      sensitivity: "standard",
      approvedAt: NOW
    }],
    deletions: []
  };
  const statePath = path.join(stateRoot, "state.json");
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault, backups, statePath, token };
}

test("dry-run is read-only and refuses workspace:local without owner mapping", (t) => {
  const { vault, backups, statePath } = fixture(t);
  const before = fs.readFileSync(statePath);
  const migration = createCodexMigration({
    vaultRoot: vault,
    backupsRoot: backups,
    clock: () => NOW
  });
  const unbound = migration.plan();
  assert.equal(unbound.status, "legacy_unbound");
  assert.equal(unbound.writes_performed, false);
  assert.deepEqual(fs.readFileSync(statePath), before);
  assert.equal(fs.existsSync(backups), false);
  assert.throws(() => migration.apply(unbound, {
    confirmation: `APPLY ${unbound.migration_id}`
  }), (error) => error.code === "legacy_unbound");
});

test("migration is backed up, redacted, idempotent and rollback preserves a safety copy", async (t) => {
  const { vault, backups, token } = fixture(t);
  const migration = createCodexMigration({
    vaultRoot: vault,
    backupsRoot: backups,
    clock: () => NOW
  });
  const plan = migration.plan({ projectId: PROJECT, workspaceId: WORKSPACE });
  assert.equal(plan.status, "ready");
  assert.equal(plan.mappings.sources[0].canonical_source_id.startsWith("src_"), true);
  assert.throws(() => migration.apply(plan), (error) => (
    error.code === "exact_confirmation_required"
  ));
  const applied = migration.apply(plan, {
    confirmation: `APPLY ${plan.migration_id}`
  });
  assert.equal(applied.backup_verified, true);
  assert.equal(applied.imported_active_memories, 1);
  assert.equal(applied.redacted_legacy_memories, 1);
  const repeated = migration.apply(plan, {
    confirmation: `APPLY ${plan.migration_id}`
  });
  assert.equal(repeated.idempotent, true);

  const store = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE,
    projectId: PROJECT
  });
  const canonicalMemoryId = plan.mappings.memories[0].canonical_memory_id;
  assert.match(canonicalMemoryId, /^mem_/);
  const imported = store.getMemory(canonicalMemoryId);
  assert.equal(imported.text.includes(token), false);
  assert.match(imported.text, /\[REDACTED:API_KEY\]/);
  const citation = store.resolveCitation(store.getCandidate(imported.candidate_id));
  assert.equal(citation.kind, "legacy_migration_evidence");
  assert.equal(citation.artifacts.length, 1);
  assert.equal(citation.artifacts[0].legacy_state_hash, plan.legacy_state_hash);
  const evidencePath = path.join(
    vault,
    "00_inbox",
    "snapshots",
    "legacy",
    WORKSPACE,
    `${plan.mappings.sources[0].migration_evidence_id}.json`
  );
  const tampered = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  tampered.backup_id = "backup_tampered";
  fs.writeFileSync(evidencePath, `${JSON.stringify(tampered)}\n`);
  assert.throws(
    () => store.resolveCitation(store.getCandidate(imported.candidate_id)),
    (error) => error.code === "citation_unresolved"
  );

  const rollback = await migration.rollback(applied, {
    confirmation: `ROLLBACK ${applied.migration_id}`
  });
  assert.equal(rollback.status, "migration_rolled_back");
  assert.equal(rollback.new_vault_preserved_in_safety_backup, true);
  assert.equal(rollback.dual_capture_enabled, false);
  assert.ok(fs.existsSync(path.join(backups, rollback.safety_backup_id)));
});

test("similar legacy slugs require review and are never auto-merged", (t) => {
  const { vault, backups } = fixture(t, { collision: true });
  const migration = createCodexMigration({
    vaultRoot: vault,
    backupsRoot: backups,
    clock: () => NOW
  });
  const plan = migration.plan({ projectId: PROJECT, workspaceId: WORKSPACE });
  assert.equal(plan.status, "review_required");
  assert.equal(plan.collisions.length, 1);
  assert.throws(() => migration.apply(plan, {
    confirmation: `APPLY ${plan.migration_id}`
  }), (error) => error.code === "migration_collision_review_required");
  assert.equal(fs.existsSync(backups), false);
});

test("legacy global memory remains scope_review and is never broadcast into a workspace", (t) => {
  const { vault, backups } = fixture(t);
  const legacyPath = path.join(vault, "00_inbox", "supermemory-product", "state.json");
  const state = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  delete state.memories[0].sourceId;
  fs.writeFileSync(legacyPath, `${JSON.stringify(state)}\n`);
  const migration = createCodexMigration({
    vaultRoot: vault,
    backupsRoot: backups,
    clock: () => NOW
  });
  const plan = migration.plan({ projectId: PROJECT, workspaceId: WORKSPACE });
  assert.equal(plan.mappings.memories[0].scope_status, "scope_review");
  assert.equal(plan.counts.scope_review_memories, 1);
  const applied = migration.apply(plan, {
    confirmation: `APPLY ${plan.migration_id}`
  });
  assert.equal(applied.imported_active_memories, 0);
  assert.equal(applied.scope_review_memories, 1);
});
