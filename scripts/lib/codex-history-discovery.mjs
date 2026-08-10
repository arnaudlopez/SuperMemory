import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_ALLOWED_SOURCES = Object.freeze(["vscode", "cli"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function firstJsonLine(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const chunks = [];
    let offset = 0;
    while (offset < 1024 * 1024) {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const length = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (!length) break;
      chunks.push(buffer.subarray(0, length));
      const bytes = Buffer.concat(chunks);
      const newline = bytes.indexOf(10);
      if (newline >= 0) return JSON.parse(bytes.subarray(0, newline).toString("utf8"));
      offset += length;
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    fs.closeSync(descriptor);
  }
}

export function fingerprintCodexHistoryFile(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  const digest = crypto.createHash("sha256");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (true) {
      const length = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (!length) break;
      digest.update(buffer.subarray(0, length));
      offset += length;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${digest.digest("hex")}`;
}

export function codexSessionSourceKind(value) {
  if (typeof value === "string" && value.trim()) return value.trim().toLocaleLowerCase("en");
  if (value && typeof value === "object" && value.subagent) return "subagent";
  return "unknown";
}

export function discoverCodexHistory({
  root,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  allowedSources = DEFAULT_ALLOWED_SOURCES,
  excludedSessionIds = []
} = {}) {
  const requested = path.resolve(root ?? "");
  if (!fs.existsSync(requested)) return { root: requested, sessions: [], excluded: [], unsupported: [] };
  const stat = fs.lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("history_root_invalid");
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1024 * 1024) fail("history_file_limit_invalid");
  const accepted = new Set((allowedSources ?? []).map((value) => String(value).toLocaleLowerCase("en")));
  const excludedIds = new Set((excludedSessionIds ?? []).map(String));
  if (!accepted.size) fail("history_source_filter_required");
  const canonicalRoot = fs.realpathSync(requested);
  const sessions = [];
  const excluded = [];
  const unsupported = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        unsupported.push({ file: target, reason: "symlink_rejected" });
        continue;
      }
      if (entry.isDirectory()) {
        walk(target);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const fileStat = fs.statSync(target);
      if (fileStat.size > maxFileBytes) {
        unsupported.push({ file: target, reason: "file_too_large", bytes: fileStat.size });
        continue;
      }
      try {
        const first = firstJsonLine(target);
        if (
          first?.type !== "session_meta" || first?.payload?.id === undefined ||
          typeof first.payload.cwd !== "string" || !Number.isFinite(Date.parse(first.timestamp))
        ) {
          unsupported.push({ file: target, reason: "unsupported_schema" });
          continue;
        }
        const sourceKind = codexSessionSourceKind(first.payload.source);
        if (excludedIds.has(String(first.payload.id))) {
          excluded.push({
            file: target,
            bytes: fileStat.size,
            session_id: String(first.payload.id),
            cwd: first.payload.cwd,
            started_at: first.timestamp,
            source_kind: sourceKind,
            reason: "active_session"
          });
          continue;
        }
        if (!accepted.has(sourceKind)) {
          excluded.push({
            file: target,
            bytes: fileStat.size,
            session_id: String(first.payload.id),
            cwd: first.payload.cwd,
            started_at: first.timestamp,
            source_kind: sourceKind,
            reason: ["exec", "subagent"].includes(sourceKind) ? "internal_session" : "source_not_allowed"
          });
          continue;
        }
        sessions.push({
          schema: "supermemory.codex-history-source.v2",
          file: target,
          source_hash: fingerprintCodexHistoryFile(target),
          bytes: fileStat.size,
          session_id: String(first.payload.id),
          cwd: first.payload.cwd,
          started_at: first.timestamp,
          source_kind: sourceKind,
          cli_version: first.payload.cli_version ?? null,
          model_provider: first.payload.model_provider ?? null,
          format: "codex-rollout-jsonl.v1"
        });
      } catch {
        unsupported.push({ file: target, reason: "unsupported_schema" });
      }
    }
  };
  walk(canonicalRoot);
  const order = (left, right) => left.started_at.localeCompare(right.started_at) || left.file.localeCompare(right.file);
  sessions.sort(order);
  excluded.sort(order);
  return { root: canonicalRoot, sessions, excluded, unsupported };
}

export const CODEX_HISTORY_DISCOVERY_DEFAULTS = Object.freeze({
  max_file_bytes: DEFAULT_MAX_FILE_BYTES,
  allowed_sources: DEFAULT_ALLOWED_SOURCES
});
