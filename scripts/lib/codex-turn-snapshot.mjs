import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, hmacFingerprint } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function realDirectory(requested) {
  const resolved = path.resolve(requested);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("snapshot_vault_invalid");
  return fs.realpathSync(resolved);
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/")) {
    const target = path.join(current, segment);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("snapshot_path_invalid");
    } else fs.mkdirSync(target, { mode: 0o700 });
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
    // File fsync plus atomic rename is the portable baseline.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function immutableWrite(filePath, value) {
  const content = `${canonicalJson(value)}\n`;
  if (fs.existsSync(filePath)) {
    if (fs.readFileSync(filePath, "utf8") !== content) fail("snapshot_immutable_conflict");
    return false;
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
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
  return true;
}

function assertHash(value) {
  if (value !== null && !/^sha256:[0-9a-f]{64}$/.test(String(value))) fail("snapshot_hash_invalid");
  return value;
}

export function createTurnSnapshotStore({ vaultRoot, fingerprintKey } = {}) {
  if (!Buffer.isBuffer(fingerprintKey) || fingerprintKey.length !== 32) {
    fail("snapshot_fingerprint_key_invalid");
  }
  const vault = realDirectory(vaultRoot);
  const snapshotRoot = ensureDirectory(vault, "00_inbox/snapshots");
  const filesRoot = ensureDirectory(snapshotRoot, "files");
  const turnsRoot = ensureDirectory(snapshotRoot, "turns");
  const sourceIndexPath = path.join(snapshotRoot, "source-index.json");

  const readSourceIndex = () => {
    if (!fs.existsSync(sourceIndexPath)) {
      return { schema: "supermemory.codex-source-index.v1", sources: {} };
    }
    const stat = fs.lstatSync(sourceIndexPath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("source_index_invalid");
    let value;
    try {
      value = JSON.parse(fs.readFileSync(sourceIndexPath, "utf8"));
    } catch {
      fail("source_index_invalid");
    }
    if (
      value?.schema !== "supermemory.codex-source-index.v1" ||
      !value.sources ||
      Array.isArray(value.sources)
    ) fail("source_index_invalid");
    return value;
  };

  const writeSourceIndex = (value) => {
    const temporary = `${sourceIndexPath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${canonicalJson(value)}\n`, { mode: 0o600 });
    const descriptor = fs.openSync(temporary, "r");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, sourceIndexPath);
    fs.chmodSync(sourceIndexPath, 0o600);
    fsyncDirectory(snapshotRoot);
  };

  const createFileSnapshot = ({
    workspaceId,
    turnId,
    itemId,
    filePath,
    renamedFromPath = null,
    beforeHash = null,
    afterHash = null,
    reason = "app_server_hash_only"
  }) => {
    if (!workspaceId || !turnId || !itemId || !filePath) fail("file_snapshot_input_invalid");
    assertHash(beforeHash);
    assertHash(afterHash);
    return withVaultMutationLock(vault, () => {
      const index = readSourceIndex();
      const pathFingerprint = hmacFingerprint(filePath, fingerprintKey, "file-path");
      const previousFingerprint = renamedFromPath
        ? hmacFingerprint(renamedFromPath, fingerprintKey, "file-path")
        : null;
      const entries = Object.values(index.sources).filter((entry) => (
        entry.workspace_id === workspaceId
      ));
      const current = entries.find((entry) => (
        entry.active_path_fingerprint === pathFingerprint ||
        entry.alias_fingerprints?.includes(pathFingerprint)
      ));
      const renamed = previousFingerprint
        ? entries.find((entry) => (
          entry.active_path_fingerprint === previousFingerprint ||
          entry.alias_fingerprints?.includes(previousFingerprint)
        ))
        : null;
      let source = current ?? null;
      let continuity = current ? "continued" : "new";
      if (renamedFromPath) {
        if (renamed && (!current || current.source_id === renamed.source_id)) {
          source = renamed;
          continuity = "renamed_strong";
        } else {
          continuity = "review_required";
        }
      } else if (!current && afterHash && entries.some((entry) => (
        entry.active_hash === afterHash
      ))) {
        continuity = "review_required";
      }
      if (!source) {
        const sourceId = `src_${crypto.randomUUID()}`;
        source = {
          source_id: sourceId,
          workspace_id: workspaceId,
          active_path_fingerprint: pathFingerprint,
          alias_fingerprints: [],
          active_snapshot_id: null,
          active_hash: null,
          continuity_status: continuity
        };
        index.sources[sourceId] = source;
      }
      if (
        current &&
        !renamedFromPath &&
        source.active_snapshot_id &&
        source.active_hash === afterHash
      ) {
        const activeHash = source.active_snapshot_id.slice("snap_".length);
        const activePath = path.join(
          filesRoot,
          activeHash.slice(0, 2),
          `${source.active_snapshot_id}.json`
        );
        if (fs.existsSync(activePath)) {
          const active = JSON.parse(fs.readFileSync(activePath, "utf8"));
          if (
            active.turn_id === turnId &&
            active.item_id === itemId &&
            active.path_fingerprint === pathFingerprint &&
            active.before_hash === beforeHash &&
            active.after_hash === afterHash
          ) {
            return {
              snapshotId: active.snapshot_id,
              sourceId: source.source_id,
              continuity: active.continuity,
              invalidatedSnapshotIds: [],
              created: false,
              path: activePath
            };
          }
        }
      }
      if (
        continuity === "renamed_strong" &&
        source.active_path_fingerprint !== pathFingerprint
      ) {
        source.alias_fingerprints = [...new Set([
          ...(source.alias_fingerprints ?? []),
          source.active_path_fingerprint
        ])];
        source.active_path_fingerprint = pathFingerprint;
      }
      const previousSnapshotId = source.active_snapshot_id;
      const contentChanged = Boolean(
        previousSnapshotId &&
        source.active_hash !== afterHash
      );
      const body = {
        schema: "supermemory.file-snapshot.v1",
        workspace_id: workspaceId,
        source_id: source.source_id,
        turn_id: turnId,
        item_id: itemId,
        path_fingerprint: pathFingerprint,
        before_hash: beforeHash,
        after_hash: afterHash,
        supersedes_snapshot_id: contentChanged ? previousSnapshotId : null,
        continuity,
        capture: "hash_only",
        reason,
        immutable: true
      };
      const hash = sha256(canonicalJson(body));
      const snapshotId = `snap_${hash}`;
      const directory = ensureDirectory(filesRoot, hash.slice(0, 2));
      const target = path.join(directory, `${snapshotId}.json`);
      const created = immutableWrite(target, { ...body, snapshot_id: snapshotId });
      source.active_snapshot_id = snapshotId;
      source.active_hash = afterHash;
      source.continuity_status = continuity;
      writeSourceIndex(index);
      return {
        snapshotId,
        sourceId: source.source_id,
        continuity,
        invalidatedSnapshotIds: contentChanged ? [previousSnapshotId] : [],
        created,
        path: target
      };
    });
  };

  const createTurnSnapshot = ({
    workspaceId,
    turnId,
    eventIds,
    fileSnapshotIds = [],
    gitHeadBefore = null,
    gitHeadAfter = null,
    completion = "complete",
    completedAt
  }) => {
    if (
      !workspaceId ||
      !turnId ||
      !Array.isArray(eventIds) ||
      eventIds.some((id) => !/^evt_[0-9a-f]{64}$/.test(id)) ||
      fileSnapshotIds.some((id) => !/^snap_[0-9a-f]{64}$/.test(id)) ||
      !["complete", "partial"].includes(completion) ||
      !Number.isFinite(Date.parse(completedAt))
    ) fail("turn_snapshot_input_invalid");
    const manifest = {
      schema: "supermemory.turn-snapshot.v1",
      workspace_id: workspaceId,
      turn_id: turnId,
      event_ids: [...eventIds],
      file_snapshot_ids: [...fileSnapshotIds],
      git_head_before: gitHeadBefore,
      git_head_after: gitHeadAfter,
      completion,
      completed_at: completedAt,
      immutable: true
    };
    const manifestHash = `sha256:${sha256(canonicalJson(manifest))}`;
    const turnSnapshotId = `tsnap_${manifestHash.slice("sha256:".length)}`;
    const directory = ensureDirectory(turnsRoot, manifestHash.slice("sha256:".length, "sha256:".length + 2));
    const target = path.join(directory, `${turnSnapshotId}.json`);
    const value = {
      ...manifest,
      turn_snapshot_id: turnSnapshotId,
      manifest_hash: manifestHash
    };
    const created = immutableWrite(target, value);
    return { turnSnapshotId, manifestHash, created, path: target, value };
  };

  const readTurnSnapshot = (turnSnapshotId) => {
    if (!/^tsnap_[0-9a-f]{64}$/.test(String(turnSnapshotId))) fail("turn_snapshot_id_invalid");
    const hash = turnSnapshotId.slice("tsnap_".length);
    const target = path.join(turnsRoot, hash.slice(0, 2), `${turnSnapshotId}.json`);
    const value = JSON.parse(fs.readFileSync(target, "utf8"));
    const manifest = { ...value };
    delete manifest.turn_snapshot_id;
    delete manifest.manifest_hash;
    const expected = `sha256:${sha256(canonicalJson(manifest))}`;
    if (expected !== value.manifest_hash || `tsnap_${expected.slice(7)}` !== turnSnapshotId) {
      fail("turn_snapshot_integrity_failed");
    }
    return value;
  };

  return { createFileSnapshot, createTurnSnapshot, readTurnSnapshot };
}
