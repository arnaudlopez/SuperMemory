import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertPreparedCapture } from "./codex-event-envelope.mjs";
import { prepareCodexCapture } from "./codex-capture-store.mjs";
import { openJsonAead, sealJsonAead } from "./codex-redaction.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertKey(encryptionKey) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
    fail("capture_encryption_key_invalid");
  }
}

function safeSegment(value, prefix) {
  if (typeof value !== "string" || !value.startsWith(prefix) || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    fail("spool_scope_invalid");
  }
  return value;
}

function existingRealDirectory(requestedPath) {
  const resolved = path.resolve(requestedPath);
  if (!fs.existsSync(resolved)) fail("spool_runtime_root_missing");
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("spool_runtime_root_invalid");
  return fs.realpathSync(resolved);
}

function ensureDirectory(parent, segment) {
  const target = path.join(parent, segment);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("spool_path_invalid");
  } else {
    fs.mkdirSync(target, { mode: 0o700 });
  }
  fs.chmodSync(target, 0o700);
  return fs.realpathSync(target);
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
    // File fsync + rename remains the cross-platform durability baseline.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function entryFiles(directory) {
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".event.aead") || name.includes(".event.aead.lease."))
    .map((name) => path.join(directory, name))
    .sort();
}

function auditGap(auditDirectory, gap) {
  const occurredAt = gap.occurred_at.replace(/[^0-9A-Za-z]/g, "");
  const filePath = path.join(auditDirectory, `${occurredAt}-${crypto.randomUUID()}.capture-gap.json`);
  atomicWrite(filePath, `${JSON.stringify({
    schema: "supermemory.capture-gap.v1",
    ...gap
  })}\n`);
}

export function createCodexSpool({
  runtimeRoot,
  workspaceId,
  encryptionKey,
  maxBytes = 32 * 1024 * 1024,
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  leaseMs = 60_000,
  clock = () => new Date().toISOString()
} = {}) {
  assertKey(encryptionKey);
  safeSegment(workspaceId, "ws_");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail("spool_quota_invalid");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) fail("spool_ttl_invalid");
  const root = existingRealDirectory(runtimeRoot);
  const spoolRoot = ensureDirectory(root, "spool");
  const directory = ensureDirectory(spoolRoot, workspaceId);
  const auditRoot = ensureDirectory(root, "audit");
  const auditDirectory = ensureDirectory(auditRoot, "capture-gaps");
  const aad = `supermemory.spool.${workspaceId}`;

  const depth = () => {
    const files = entryFiles(directory);
    const stats = files.map((filePath) => fs.statSync(filePath));
    return {
      entries: files.length,
      bytes: stats.reduce((sum, stat) => sum + stat.size, 0),
      oldestAgeMs: stats.length === 0
        ? 0
        : Math.max(0, Date.parse(clock()) - Math.min(...stats.map((stat) => stat.mtimeMs)))
    };
  };

  const enqueuePrepared = (candidate) => {
    const prepared = assertPreparedCapture(candidate);
    if (prepared.envelope.workspace_id !== workspaceId) fail("spool_scope_mismatch");
    const createdAt = clock();
    const sealed = sealJsonAead({
      schema: "supermemory.spool-entry.v1",
      created_at: createdAt,
      prepared
    }, { encryptionKey, aad });
    const content = `${JSON.stringify(sealed)}\n`;
    const current = depth();
    if (current.bytes + Buffer.byteLength(content) > maxBytes) {
      auditGap(auditDirectory, {
        workspace_id: workspaceId,
        session_id: prepared.envelope.session_id,
        event_id: prepared.envelope.event_id,
        reason: "spool_full",
        occurred_at: createdAt
      });
      return {
        status: "dropped",
        reason: "spool_full",
        eventId: prepared.envelope.event_id,
        captureGap: true
      };
    }
    const filePath = path.join(
      directory,
      `${prepared.envelope.event_id}.${crypto.randomUUID()}.event.aead`
    );
    atomicWrite(filePath, content);
    return {
      status: "spooled",
      eventId: prepared.envelope.event_id,
      durable: true,
      filePath
    };
  };

  const enqueue = (input) => enqueuePrepared(prepareCodexCapture(input, {
    encryptionKey,
    observedAt: clock()
  }));

  const replay = async (ingestPrepared, { maxEntries = Number.POSITIVE_INFINITY } = {}) => {
    if (typeof ingestPrepared !== "function") fail("spool_ingest_callback_required");
    if (!(maxEntries === Number.POSITIVE_INFINITY || (Number.isSafeInteger(maxEntries) && maxEntries > 0))) {
      fail("spool_replay_limit_invalid");
    }
    const summary = {
      replayed: 0,
      duplicates: 0,
      expired: 0,
      retained: 0,
      failed: 0
    };
    let attempted = 0;
    for (const initialPath of entryFiles(directory)) {
      let leasePath = initialPath;
      const initialStat = fs.statSync(initialPath);
      const alreadyLeased = initialPath.includes(".event.aead.lease.");
      if (alreadyLeased && Date.now() - initialStat.mtimeMs < leaseMs) continue;
      if (attempted >= maxEntries) break;
      attempted += 1;
      if (!alreadyLeased) {
        leasePath = `${initialPath}.lease.${process.pid}.${crypto.randomUUID()}`;
        try {
          fs.renameSync(initialPath, leasePath);
          fsyncDirectory(directory);
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          throw error;
        }
      }
      const returnPath = alreadyLeased
        ? `${initialPath.split(".event.aead.lease.")[0]}.event.aead`
        : initialPath;
      try {
        const sealed = JSON.parse(fs.readFileSync(leasePath, "utf8"));
        const entry = openJsonAead(sealed, { encryptionKey, expectedAad: aad });
        if (entry?.schema !== "supermemory.spool-entry.v1") fail("spool_entry_invalid");
        const prepared = assertPreparedCapture(entry.prepared);
        if (prepared.envelope.workspace_id !== workspaceId) fail("spool_scope_mismatch");
        const now = Date.parse(clock());
        if (!Number.isFinite(now) || now - Date.parse(entry.created_at) > ttlMs) {
          auditGap(auditDirectory, {
            workspace_id: workspaceId,
            session_id: prepared.envelope.session_id,
            event_id: prepared.envelope.event_id,
            reason: "spool_ttl_expired",
            occurred_at: clock()
          });
          fs.rmSync(leasePath);
          fsyncDirectory(directory);
          summary.expired += 1;
          continue;
        }
        const result = await ingestPrepared(prepared);
        if (result?.durable !== true || !["applied", "duplicate"].includes(result.status)) {
          fail("spool_ack_not_durable");
        }
        fs.rmSync(leasePath);
        fsyncDirectory(directory);
        if (result.status === "duplicate") summary.duplicates += 1;
        else summary.replayed += 1;
      } catch {
        summary.failed += 1;
        if (fs.existsSync(leasePath)) {
          if (fs.existsSync(returnPath)) {
            summary.retained += 1;
          } else {
            fs.renameSync(leasePath, returnPath);
            fsyncDirectory(directory);
            summary.retained += 1;
          }
        }
      }
    }
    return summary;
  };

  return {
    runtimeRoot: root,
    workspaceId,
    directory,
    auditDirectory,
    enqueue,
    enqueuePrepared,
    replay,
    depth
  };
}
