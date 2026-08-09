import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function firstJsonLine(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, length).toString("utf8").split("\n", 1)[0];
    return JSON.parse(line);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fingerprint(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

export function discoverCodexHistory({ root, maxFileBytes = 64 * 1024 * 1024 } = {}) {
  const requested = path.resolve(root ?? "");
  if (!fs.existsSync(requested)) return { root: requested, sessions: [], unsupported: [] };
  const stat = fs.lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("history_root_invalid");
  const canonicalRoot = fs.realpathSync(requested);
  const sessions = [];
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
        sessions.push({
          schema: "supermemory.codex-history-source.v1",
          file: target,
          source_hash: fingerprint(target),
          bytes: fileStat.size,
          session_id: String(first.payload.id),
          cwd: first.payload.cwd,
          started_at: first.timestamp,
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
  sessions.sort((left, right) => left.started_at.localeCompare(right.started_at) || left.file.localeCompare(right.file));
  return { root: canonicalRoot, sessions, unsupported };
}
