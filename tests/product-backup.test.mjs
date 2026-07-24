import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createProductBackupManager,
  ProductBackupError
} from "../scripts/lib/product-backup.mjs";

function writeFixture(vaultRoot, text = "Version initiale") {
  const stateDirectory = path.join(vaultRoot, "00_inbox", "supermemory-product");
  const memoryDirectory = path.join(vaultRoot, "20_professional", "product-memories");
  fs.mkdirSync(stateDirectory, { recursive: true });
  fs.mkdirSync(memoryDirectory, { recursive: true });
  const memoryPath = "20_professional/product-memories/memory-demo.md";
  fs.writeFileSync(path.join(vaultRoot, memoryPath), [
    "---",
    'hindsight_projection_status: "synced"',
    "---",
    "",
    text,
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(stateDirectory, "state.json"), JSON.stringify({
    version: 1,
    workspace: { workspaceId: "workspace:local" },
    sources: [],
    snapshots: [],
    candidates: [],
    memories: [{
      memoryId: "memory:demo",
      status: "active",
      memoryPath,
      projection: {
        documentId: "memory:demo",
        status: "synced",
        syncedAt: "2026-07-24T10:00:00.000Z",
        errorCode: null
      }
    }],
    deletions: []
  }, null, 2));
}

test("backup manager refuses a backup directory inside the canonical vault", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-backup-scope-"));
  const vaultRoot = path.join(root, "vault");
  fs.mkdirSync(vaultRoot);
  assert.throws(
    () => createProductBackupManager({
      vaultRoot,
      backupsRoot: path.join(vaultRoot, "backups")
    }),
    (error) => error instanceof ProductBackupError && error.code === "backup_inside_vault"
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("backup create, hash verification and atomic restore preserve a safety copy and queue rebuild", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-backup-"));
  const vaultRoot = path.join(root, "vault");
  const backupsRoot = path.join(root, "backups");
  writeFixture(vaultRoot);
  let tick = 0;
  const manager = createProductBackupManager({
    vaultRoot,
    backupsRoot,
    clock: () => `2026-07-24T10:00:0${tick++}.000Z`
  });

  const created = manager.create({ reason: "manual-test" });
  assert.equal(created.verified, true);
  assert.ok(created.files >= 2);
  assert.equal(manager.verify(created.backupId).verified, true);
  assert.equal(manager.list()[0].backupId, created.backupId);

  const memoryPath = path.join(vaultRoot, "20_professional", "product-memories", "memory-demo.md");
  fs.writeFileSync(memoryPath, "Version modifiée\n");
  assert.throws(
    () => manager.restore(created.backupId, "RESTORE wrong"),
    (error) => error.code === "restore_confirmation_invalid"
  );
  assert.match(fs.readFileSync(memoryPath, "utf8"), /Version modifiée/);

  const restored = manager.restore(created.backupId, `RESTORE ${created.backupId}`);
  assert.equal(restored.status, "restored");
  assert.equal(restored.backupId, created.backupId);
  assert.match(restored.safetyBackupId, /^backup-/);
  assert.equal(restored.queuedProjections, 1);
  assert.match(fs.readFileSync(memoryPath, "utf8"), /Version initiale/);
  assert.match(fs.readFileSync(memoryPath, "utf8"), /hindsight_projection_status: "queued"/);
  const state = JSON.parse(
    fs.readFileSync(path.join(vaultRoot, "00_inbox", "supermemory-product", "state.json"), "utf8")
  );
  assert.equal(state.memories[0].projection.status, "queued");
  assert.equal(state.memories[0].projection.errorCode, "restore_requires_rebuild");
  assert.equal(manager.verify(restored.safetyBackupId).verified, true);
  assert.equal(manager.list().length, 2);

  fs.rmSync(root, { recursive: true, force: true });
});

test("tampering is detected before restore and leaves the active vault unchanged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-backup-tamper-"));
  const vaultRoot = path.join(root, "vault");
  const backupsRoot = path.join(root, "backups");
  writeFixture(vaultRoot);
  const manager = createProductBackupManager({ vaultRoot, backupsRoot });
  const created = manager.create();
  const backedUpMemory = path.join(
    backupsRoot,
    created.backupId,
    "vault",
    "20_professional",
    "product-memories",
    "memory-demo.md"
  );
  fs.appendFileSync(backedUpMemory, "altération");
  const activeMemory = path.join(vaultRoot, "20_professional", "product-memories", "memory-demo.md");
  const before = fs.readFileSync(activeMemory, "utf8");

  assert.throws(
    () => manager.restore(created.backupId, `RESTORE ${created.backupId}`),
    (error) => error.code === "backup_integrity_failed"
  );
  assert.equal(fs.readFileSync(activeMemory, "utf8"), before);
  assert.equal(manager.list()[0].verified, false);

  fs.rmSync(root, { recursive: true, force: true });
});
