import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recoverRegistryTransaction,
  withVaultMutationLock,
  writeRegistryPairRecoverable
} from "../scripts/lib/registry-transaction.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "registry-transaction-"));
const vaultRoot = path.join(tmpRoot, "identity-vault");
const inbox = path.join(vaultRoot, "00_inbox");
const sourceRegistry = path.join(inbox, "source_registry.md");
const snapshotRegistry = path.join(inbox, "snapshot_registry.md");
fs.mkdirSync(inbox, { recursive: true });
fs.writeFileSync(sourceRegistry, "source-v1\n");
fs.writeFileSync(snapshotRegistry, "snapshot-v1\n");

withVaultMutationLock(vaultRoot, () => {
  assert.throws(() => withVaultMutationLock(vaultRoot, () => {}), /vault_busy/);
  const transaction = writeRegistryPairRecoverable({
    vaultRoot,
    sourceRegistry,
    snapshotRegistry,
    nextSourceRegistry: "source-v2\n",
    nextSnapshotRegistry: "snapshot-v2\n"
  });
  assert.equal(transaction.committed, true);
});
assert.equal(fs.readFileSync(sourceRegistry, "utf8"), "source-v2\n");
assert.equal(fs.readFileSync(snapshotRegistry, "utf8"), "snapshot-v2\n");

assert.throws(() => withVaultMutationLock(vaultRoot, () => {
  writeRegistryPairRecoverable({
    vaultRoot,
    sourceRegistry,
    snapshotRegistry,
    nextSourceRegistry: "source-v3\n",
    nextSnapshotRegistry: "snapshot-v3\n",
    onAfterSourceCommit() {
      throw new Error("simulated_failure");
    }
  });
}), /simulated_failure/);
assert.equal(fs.readFileSync(sourceRegistry, "utf8"), "source-v2\n");
assert.equal(fs.readFileSync(snapshotRegistry, "utf8"), "snapshot-v2\n");
assert.equal(fs.existsSync(path.join(inbox, ".supermemory-registry-transaction.json")), false);
assert.equal(fs.existsSync(path.join(vaultRoot, ".supermemory-operator.lock")), false);

const interruptedId = "11111111-1111-4111-8111-111111111111";
const interruptedManifest = {
  transaction_id: interruptedId,
  state: "source_committed",
  source_registry: fs.realpathSync(sourceRegistry),
  snapshot_registry: fs.realpathSync(snapshotRegistry),
  source_backup: path.join(fs.realpathSync(inbox), `.source-registry.${interruptedId}.bak`),
  snapshot_backup: path.join(fs.realpathSync(inbox), `.snapshot-registry.${interruptedId}.bak`),
  source_temp: path.join(fs.realpathSync(inbox), `.source-registry.${interruptedId}.tmp`),
  snapshot_temp: path.join(fs.realpathSync(inbox), `.snapshot-registry.${interruptedId}.tmp`)
};
fs.copyFileSync(sourceRegistry, interruptedManifest.source_backup);
fs.copyFileSync(snapshotRegistry, interruptedManifest.snapshot_backup);
fs.writeFileSync(interruptedManifest.source_temp, "source-v-interrupted\n");
fs.writeFileSync(interruptedManifest.snapshot_temp, "snapshot-v-interrupted\n");
fs.writeFileSync(sourceRegistry, "source-v-interrupted\n");
fs.writeFileSync(path.join(inbox, ".supermemory-registry-transaction.json"), JSON.stringify(interruptedManifest));
withVaultMutationLock(vaultRoot, ({ recovery }) => {
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.action, "rolled_back");
  assert.equal(fs.readFileSync(sourceRegistry, "utf8"), "source-v2\n");
  assert.equal(fs.readFileSync(snapshotRegistry, "utf8"), "snapshot-v2\n");
});
assert.equal(fs.existsSync(path.join(inbox, ".supermemory-registry-transaction.json")), false);

const externalTarget = path.join(tmpRoot, "external-target.md");
fs.writeFileSync(externalTarget, "must-not-change\n");
fs.writeFileSync(path.join(inbox, ".supermemory-registry-transaction.json"), JSON.stringify({
  transaction_id: "00000000-0000-4000-8000-000000000000",
  state: "prepared",
  source_registry: externalTarget,
  snapshot_registry: snapshotRegistry,
  source_backup: sourceRegistry,
  snapshot_backup: snapshotRegistry,
  source_temp: sourceRegistry,
  snapshot_temp: snapshotRegistry
}));
assert.throws(() => recoverRegistryTransaction(vaultRoot), /vault_registry_transaction_manifest_invalid/);
assert.equal(fs.readFileSync(externalTarget, "utf8"), "must-not-change\n");
fs.rmSync(path.join(inbox, ".supermemory-registry-transaction.json"));

fs.rmSync(tmpRoot, { recursive: true, force: true });
