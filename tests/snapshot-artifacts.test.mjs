import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  materializeSnapshotArtifact,
  snapshotArtifactRelativePath
} from "../scripts/lib/snapshot-artifacts.mjs";

function hash(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-artifacts-"));
const vaultRoot = path.join(tmpRoot, "identity-vault");
const sourcePath = path.join(tmpRoot, "source.md");
fs.mkdirSync(vaultRoot, { recursive: true });

const original = "immutable source evidence\n";
const expectedHash = hash(original);
fs.writeFileSync(sourcePath, original);

assert.equal(
  snapshotArtifactRelativePath(expectedHash),
  `00_inbox/snapshots/sha256/${expectedHash.slice(7, 9)}/${expectedHash.slice(7)}.snapshot`
);

fs.writeFileSync(sourcePath, "changed after review\n");
assert.throws(
  () => materializeSnapshotArtifact({
    vaultRoot,
    originalRef: fs.realpathSync(sourcePath),
    contentHash: expectedHash,
    snapshotId: "snap:test:v1"
  }),
  /snapshot_source_changed_since_plan/
);

fs.writeFileSync(sourcePath, original);
const artifact = materializeSnapshotArtifact({
  vaultRoot,
  originalRef: fs.realpathSync(sourcePath),
  contentHash: expectedHash,
  snapshotId: "snap:test:v1"
});
assert.equal(artifact.created, true);
assert.equal(fs.readFileSync(artifact.path, "utf8"), original);
assert.equal((fs.statSync(artifact.path).mode & 0o777), 0o600);

const reused = materializeSnapshotArtifact({
  vaultRoot,
  originalRef: fs.realpathSync(sourcePath),
  contentHash: expectedHash,
  snapshotId: "snap:test:v1"
});
assert.equal(reused.created, false);
assert.equal(reused.path, artifact.path);

const symlinkVault = path.join(tmpRoot, "symlink-vault");
const externalInbox = path.join(tmpRoot, "external-inbox");
fs.mkdirSync(symlinkVault);
fs.mkdirSync(externalInbox);
fs.symlinkSync(externalInbox, path.join(symlinkVault, "00_inbox"));
assert.throws(
  () => materializeSnapshotArtifact({
    vaultRoot: symlinkVault,
    originalRef: fs.realpathSync(sourcePath),
    contentHash: expectedHash,
    snapshotId: "snap:test:symlink"
  }),
  /snapshot_artifact_directory_invalid/
);
assert.deepEqual(fs.readdirSync(externalInbox), []);

fs.rmSync(tmpRoot, { recursive: true, force: true });
