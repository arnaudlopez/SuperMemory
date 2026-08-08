import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  openJsonAead,
  sealJsonAead
} from "./codex-redaction.mjs";
import { generateUuidV7 } from "./project-registry.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const WORKSPACE_ID = /^ws_[0-9a-f-]{36}$/i;
const PROJECT_ID = /^prj_[0-9a-f-]{36}$/i;
const ARCHIVE_ID = /^arc_[0-9a-f-]{36}$/i;
const EVENT_ID = /^evt_[0-9a-f]{64}$/;
const TURN_SNAPSHOT_ID = /^tsnap_[0-9a-f]{64}$/;

export class CodexArchiveError extends Error {
  constructor(code) {
    super(code);
    this.name = "CodexArchiveError";
    this.code = code;
  }
}

function fail(code) {
  throw new CodexArchiveError(code);
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail("archive_key_required");
}

function assertScope(workspaceId, projectId) {
  if (!WORKSPACE_ID.test(String(workspaceId)) || !PROJECT_ID.test(String(projectId))) {
    fail("scope_unresolved");
  }
}

function existingDirectory(requested) {
  const resolved = path.resolve(requested);
  if (!fs.existsSync(resolved)) fail("archive_vault_missing");
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("archive_vault_invalid");
  return fs.realpathSync(resolved);
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    const target = path.join(current, segment);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("archive_path_invalid");
    } else {
      fs.mkdirSync(target, { mode: 0o700 });
    }
    fs.chmodSync(target, 0o700);
    current = fs.realpathSync(target);
  }
  return current;
}

function atomicWrite(filePath, bytes) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function readJson(filePath, code) {
  if (!fs.existsSync(filePath)) fail(code);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(code);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail(code);
  }
}

function safeSessionSegment(sessionId) {
  return crypto.createHash("sha256").update(String(sessionId)).digest("hex");
}

export function createCodexArchiveStore({
  vaultRoot,
  workspaceId,
  projectId,
  encryptionKey,
  encryptionKeys = null,
  currentKeyId = null,
  clock = () => new Date().toISOString()
} = {}) {
  assertScope(workspaceId, projectId);
  const keyIdFor = (key) => `key_${crypto.createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 24)}`;
  const keyring = new Map();
  if (encryptionKeys && typeof encryptionKeys === "object") {
    for (const [keyId, key] of Object.entries(encryptionKeys)) {
      assertKey(key);
      keyring.set(keyId, key);
    }
  }
  if (encryptionKey) {
    assertKey(encryptionKey);
    keyring.set(keyIdFor(encryptionKey), encryptionKey);
  }
  if (keyring.size === 0) fail("archive_key_required");
  const writeKeyId = currentKeyId ?? (encryptionKey ? keyIdFor(encryptionKey) : [...keyring.keys()][0]);
  const writeKey = keyring.get(writeKeyId);
  if (!writeKey) fail("archive_current_key_missing");
  const vault = existingDirectory(vaultRoot);
  const workspaceRoot = ensureDirectory(vault, `00_inbox/codex-archives/${workspaceId}`);

  const locate = (archiveId) => {
    if (!ARCHIVE_ID.test(String(archiveId))) fail("archive_id_invalid");
    const stack = [workspaceRoot];
    while (stack.length > 0) {
      const directory = stack.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) fail("archive_path_invalid");
        if (entry.isDirectory()) stack.push(target);
        else if (entry.isFile() && entry.name === `${archiveId}.meta.json`) {
          return {
            metadataPath: target,
            contentPath: path.join(directory, `${archiveId}.json.aead`)
          };
        }
      }
    }
    fail("archive_not_found");
  };

  const createArchive = ({
    sessionId,
    turnId,
    visibleMessages = [],
    toolEvents = [],
    turnSnapshotId,
    classification = "standard",
    retentionClass = "standard",
    expiresAt = null
  } = {}) => {
    if (
      typeof sessionId !== "string" || sessionId.length === 0 ||
      typeof turnId !== "string" || turnId.length === 0 ||
      !Array.isArray(visibleMessages) ||
      !Array.isArray(toolEvents) ||
      toolEvents.some((eventId) => !EVENT_ID.test(String(eventId))) ||
      !TURN_SNAPSHOT_ID.test(String(turnSnapshotId)) ||
      !["standard", "restricted", "quarantined"].includes(classification) ||
      !["short", "standard", "legal_hold"].includes(retentionClass) ||
      (expiresAt !== null && !Number.isFinite(Date.parse(expiresAt)))
    ) fail("archive_input_invalid");
    const content = {
      schema: "supermemory.conversation-archive-content.v1",
      visible_messages: visibleMessages,
      tool_events: toolEvents
    };
    const contentHash = `sha256:${crypto.createHash("sha256")
      .update(canonicalJson(content))
      .digest("hex")}`;
    const sessionRoot = ensureDirectory(workspaceRoot, safeSessionSegment(sessionId));
    let result;
    withVaultMutationLock(vault, () => {
      for (const entry of fs.readdirSync(sessionRoot)) {
        if (!entry.endsWith(".meta.json")) continue;
        const metadata = readJson(path.join(sessionRoot, entry), "archive_metadata_invalid");
        if (
          metadata.content_hash === contentHash &&
          metadata.turn_id === turnId &&
          metadata.turn_snapshot_id === turnSnapshotId
        ) {
          result = metadata;
          return;
        }
      }
      const archiveId = `arc_${generateUuidV7()}`;
      const createdAt = clock();
      const aad = `supermemory.archive.v1.${workspaceId}.${archiveId}`;
      const sealed = sealJsonAead(content, { encryptionKey: writeKey, aad });
      const metadata = {
        schema: "supermemory.conversation-archive.v1",
        archive_id: archiveId,
        workspace_id: workspaceId,
        project_id: projectId,
        session_id: sessionId,
        turn_id: turnId,
        tool_event_ids: [...toolEvents],
        turn_snapshot_id: turnSnapshotId,
        classification,
        retention_class: retentionClass,
        expires_at: expiresAt,
        encryption_key_id: writeKeyId,
        content_hash: contentHash,
        created_at: createdAt,
        status: "active"
      };
      const contentPath = path.join(sessionRoot, `${archiveId}.json.aead`);
      const metadataPath = path.join(sessionRoot, `${archiveId}.meta.json`);
      // Ciphertext is durable before its non-secret metadata becomes discoverable.
      atomicWrite(contentPath, `${JSON.stringify(sealed)}\n`);
      atomicWrite(metadataPath, `${canonicalJson(metadata)}\n`);
      result = metadata;
    });
    return result;
  };

  const getMetadata = (archiveId) => {
    const { metadataPath } = locate(archiveId);
    const metadata = readJson(metadataPath, "archive_metadata_invalid");
    if (
      metadata?.schema !== "supermemory.conversation-archive.v1" ||
      metadata.workspace_id !== workspaceId ||
      metadata.project_id !== projectId
    ) fail("archive_scope_mismatch");
    return metadata;
  };

  const openArchive = (archiveId) => {
    const metadata = getMetadata(archiveId);
    const { contentPath } = locate(archiveId);
    const sealed = readJson(contentPath, "archive_ciphertext_invalid");
    const readKey = keyring.get(metadata.encryption_key_id);
    if (!readKey) fail("archive_key_unavailable");
    const content = openJsonAead(sealed, {
      encryptionKey: readKey,
      expectedAad: `supermemory.archive.v1.${workspaceId}.${archiveId}`
    });
    const hash = `sha256:${crypto.createHash("sha256")
      .update(canonicalJson(content))
      .digest("hex")}`;
    if (hash !== metadata.content_hash) fail("archive_integrity_failed");
    return { metadata, content };
  };

  const listMetadata = ({ sessionId = null, status = "active" } = {}) => {
    const results = [];
    const stack = [workspaceRoot];
    while (stack.length > 0) {
      const directory = stack.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) fail("archive_path_invalid");
        if (entry.isDirectory()) stack.push(target);
        else if (entry.isFile() && entry.name.endsWith(".meta.json")) {
          const metadata = readJson(target, "archive_metadata_invalid");
          if (
            metadata.workspace_id === workspaceId &&
            (!sessionId || metadata.session_id === sessionId) &&
            (!status || metadata.status === status)
          ) results.push(metadata);
        }
      }
    }
    return results.sort((left, right) => left.created_at.localeCompare(right.created_at));
  };

  const updateMetadata = (archiveId, operation) => {
    let result;
    withVaultMutationLock(vault, () => {
      const { metadataPath } = locate(archiveId);
      const metadata = getMetadata(archiveId);
      result = operation(metadata) ?? metadata;
      atomicWrite(metadataPath, `${canonicalJson(result)}\n`);
    });
    return result;
  };

  const tombstoneArchive = (archiveId, { reason = "retention_expired" } = {}) =>
    updateMetadata(archiveId, (metadata) => {
      if (metadata.status === "purged" || metadata.status === "tombstone") return metadata;
      return {
        ...metadata,
        status: "tombstone",
        tombstoned_at: clock(),
        tombstone_reason: String(reason).slice(0, 120)
      };
    });

  const purgeArchive = (archiveId) => {
    let result;
    withVaultMutationLock(vault, () => {
      const located = locate(archiveId);
      const metadata = getMetadata(archiveId);
      if (metadata.retention_class === "legal_hold") fail("archive_legal_hold");
      if (metadata.status !== "tombstone" && metadata.status !== "purged") {
        fail("archive_tombstone_required");
      }
      if (metadata.status === "purged") {
        result = metadata;
        return;
      }
      if (fs.existsSync(located.contentPath)) fs.rmSync(located.contentPath);
      result = {
        ...metadata,
        status: "purged",
        purged_at: clock(),
        content_hash: null
      };
      atomicWrite(located.metadataPath, `${canonicalJson(result)}\n`);
    });
    return result;
  };

  return {
    workspaceId,
    projectId,
    archiveRoot: workspaceRoot,
    createArchive,
    getMetadata,
    openArchive,
    listMetadata,
    tombstoneArchive,
    purgeArchive,
    keyIds: [...keyring.keys()],
    currentKeyId: writeKeyId
  };
}
