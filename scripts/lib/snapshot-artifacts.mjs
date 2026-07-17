import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hashBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function hashHex(contentHash) {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(String(contentHash ?? ""));
  if (!match) throw new Error("snapshot_content_hash_invalid");
  return match[1].toLowerCase();
}

export function snapshotArtifactRelativePath(contentHash) {
  const hex = hashHex(contentHash);
  return path.posix.join("00_inbox", "snapshots", "sha256", hex.slice(0, 2), `${hex}.snapshot`);
}

function verifyExistingArtifact(artifactPath, expectedHash) {
  const stat = fs.lstatSync(artifactPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("snapshot_artifact_invalid");
  const existing = fs.readFileSync(artifactPath);
  if (hashBytes(existing) !== expectedHash) throw new Error("snapshot_artifact_hash_conflict");
  fs.chmodSync(artifactPath, 0o600);
}

function ensureSafeArtifactDirectory(vaultReal, relativeDirectory) {
  let current = vaultReal;
  for (const segment of relativeDirectory.split("/")) {
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("snapshot_artifact_directory_invalid");
    } else {
      fs.mkdirSync(next, { mode: 0o700 });
    }
    const nextReal = fs.realpathSync(next);
    if (!isPathInside(vaultReal, nextReal)) throw new Error("snapshot_artifact_scope_escape");
    current = nextReal;
  }
  return current;
}

export function materializeSnapshotArtifact({ vaultRoot, originalRef, contentHash, snapshotId }) {
  const vaultReal = fs.realpathSync(vaultRoot);
  const expectedSource = path.resolve(originalRef);
  if (!fs.existsSync(expectedSource) || !fs.statSync(expectedSource).isFile()) {
    throw new Error("snapshot_source_unreadable");
  }
  const sourceReal = fs.realpathSync(expectedSource);
  if (sourceReal !== expectedSource) throw new Error("snapshot_source_identity_changed");

  const bytes = fs.readFileSync(sourceReal);
  if (hashBytes(bytes) !== contentHash) throw new Error("snapshot_source_changed_since_plan");

  const relativePath = snapshotArtifactRelativePath(contentHash);
  const relativeDirectory = path.posix.dirname(relativePath);
  const artifactDirReal = ensureSafeArtifactDirectory(vaultReal, relativeDirectory);
  const artifactPath = path.join(artifactDirReal, path.posix.basename(relativePath));

  let created = false;
  if (fs.existsSync(artifactPath)) {
    verifyExistingArtifact(artifactPath, contentHash);
  } else {
    let descriptor;
    try {
      descriptor = fs.openSync(artifactPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      verifyExistingArtifact(artifactPath, contentHash);
    }
    if (descriptor !== undefined) {
      try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
        created = true;
      } catch (error) {
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.rmSync(artifactPath, { force: true });
        throw error;
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
    }
  }

  return {
    snapshot_id: snapshotId,
    content_hash: contentHash,
    relative_path: relativePath,
    path: fs.realpathSync(artifactPath),
    created,
    immutable: true
  };
}
