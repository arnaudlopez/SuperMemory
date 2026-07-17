import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function writeAndSync(filePath, content, mode = 0o600) {
  const descriptor = fs.openSync(filePath, "w", mode);
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeJsonAtomic(filePath, value) {
  const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    writeAndSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmpPath, filePath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  }
}

function safeRemove(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

function transactionManifestPath(vaultRoot) {
  return path.join(vaultRoot, "00_inbox", ".supermemory-registry-transaction.json");
}

function assertRegularFile(filePath, errorCode) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(errorCode);
}

function expectedTransactionPaths(vaultRoot, transactionId) {
  const inbox = path.join(vaultRoot, "00_inbox");
  return {
    source_registry: path.join(inbox, "source_registry.md"),
    snapshot_registry: path.join(inbox, "snapshot_registry.md"),
    source_backup: path.join(inbox, `.source-registry.${transactionId}.bak`),
    snapshot_backup: path.join(inbox, `.snapshot-registry.${transactionId}.bak`),
    source_temp: path.join(inbox, `.source-registry.${transactionId}.tmp`),
    snapshot_temp: path.join(inbox, `.snapshot-registry.${transactionId}.tmp`)
  };
}

function validateTransactionManifest(vaultRoot, manifest) {
  if (!/^[0-9a-f-]{36}$/i.test(String(manifest?.transaction_id ?? ""))) {
    throw new Error("vault_registry_transaction_manifest_invalid");
  }
  if (!["prepared", "source_committed", "committed"].includes(manifest.state)) {
    throw new Error("vault_registry_transaction_manifest_invalid");
  }
  const expected = expectedTransactionPaths(vaultRoot, manifest.transaction_id);
  for (const [key, expectedPath] of Object.entries(expected)) {
    if (path.resolve(String(manifest[key] ?? "")) !== expectedPath) {
      throw new Error("vault_registry_transaction_manifest_invalid");
    }
  }
  return expected;
}

function validateRegistryTargets(vaultRoot, sourceRegistry, snapshotRegistry) {
  const inbox = path.join(vaultRoot, "00_inbox");
  const inboxStat = fs.lstatSync(inbox);
  if (inboxStat.isSymbolicLink() || !inboxStat.isDirectory() || fs.realpathSync(inbox) !== inbox) {
    throw new Error("vault_registry_scope_invalid");
  }
  const expected = expectedTransactionPaths(vaultRoot, "unused");
  assertRegularFile(sourceRegistry, "vault_registry_scope_invalid");
  assertRegularFile(snapshotRegistry, "vault_registry_scope_invalid");
  if (fs.realpathSync(sourceRegistry) !== expected.source_registry || fs.realpathSync(snapshotRegistry) !== expected.snapshot_registry) {
    throw new Error("vault_registry_scope_invalid");
  }
}

function cleanupTransaction(manifestPath, manifest) {
  for (const filePath of [
    manifest?.source_backup,
    manifest?.snapshot_backup,
    manifest?.source_temp,
    manifest?.snapshot_temp
  ]) safeRemove(filePath);
  safeRemove(manifestPath);
}

export function recoverRegistryTransaction(vaultRoot) {
  const vaultReal = fs.realpathSync(vaultRoot);
  const manifestPath = transactionManifestPath(vaultReal);
  if (!fs.existsSync(manifestPath)) return { recovered: false };

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("vault_registry_transaction_manifest_invalid");
  }
  const expected = validateTransactionManifest(vaultReal, manifest);
  validateRegistryTargets(vaultReal, expected.source_registry, expected.snapshot_registry);

  if (manifest.state === "committed") {
    cleanupTransaction(manifestPath, manifest);
    return { recovered: true, action: "completed_cleanup", transaction_id: manifest.transaction_id };
  }

  for (const [backup, target] of [
    [expected.source_backup, expected.source_registry],
    [expected.snapshot_backup, expected.snapshot_registry]
  ]) {
    if (!backup || !target || !fs.existsSync(backup)) {
      throw new Error("vault_registry_transaction_recovery_incomplete");
    }
    assertRegularFile(backup, "vault_registry_transaction_recovery_incomplete");
    fs.copyFileSync(backup, target);
  }
  cleanupTransaction(manifestPath, manifest);
  return { recovered: true, action: "rolled_back", transaction_id: manifest.transaction_id };
}

function acquireLock(vaultRoot) {
  const lockPath = path.join(vaultRoot, ".supermemory-operator.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      writeAndSync(path.join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
      return lockPath;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner = null;
      try {
        owner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"));
      } catch {
        // An incomplete lock directory is stale unless another process still owns it.
      }
      if (processIsRunning(owner?.pid)) throw new Error("vault_busy");
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  }
  throw new Error("vault_busy");
}

export function withVaultMutationLock(vaultRoot, callback) {
  const vaultReal = fs.realpathSync(vaultRoot);
  const lockPath = acquireLock(vaultReal);
  try {
    const recovery = recoverRegistryTransaction(vaultReal);
    return callback({ vaultRoot: vaultReal, recovery });
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

export function writeRegistryPairRecoverable({
  vaultRoot,
  sourceRegistry,
  snapshotRegistry,
  nextSourceRegistry,
  nextSnapshotRegistry,
  onAfterSourceCommit
}) {
  const vaultReal = fs.realpathSync(vaultRoot);
  validateRegistryTargets(vaultReal, sourceRegistry, snapshotRegistry);
  const transactionId = crypto.randomUUID();
  const manifestPath = transactionManifestPath(vaultReal);
  const transactionPaths = expectedTransactionPaths(vaultReal, transactionId);
  const manifest = {
    transaction_id: transactionId,
    state: "prepared",
    ...transactionPaths
  };

  if (fs.existsSync(manifestPath)) throw new Error("vault_registry_transaction_pending");
  fs.copyFileSync(sourceRegistry, manifest.source_backup);
  fs.copyFileSync(snapshotRegistry, manifest.snapshot_backup);
  writeAndSync(manifest.source_temp, nextSourceRegistry);
  writeAndSync(manifest.snapshot_temp, nextSnapshotRegistry);
  writeJsonAtomic(manifestPath, manifest);

  try {
    fs.renameSync(manifest.source_temp, sourceRegistry);
    manifest.state = "source_committed";
    writeJsonAtomic(manifestPath, manifest);
    if (onAfterSourceCommit) onAfterSourceCommit();

    fs.renameSync(manifest.snapshot_temp, snapshotRegistry);
    manifest.state = "committed";
    writeJsonAtomic(manifestPath, manifest);
    cleanupTransaction(manifestPath, manifest);
    return { transaction_id: transactionId, committed: true };
  } catch (error) {
    recoverRegistryTransaction(vaultReal);
    throw error;
  }
}
