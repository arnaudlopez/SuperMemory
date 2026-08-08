import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function safe(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,300}$/.test(value)) fail("encrypted_ledger_path_invalid");
  return value;
}

function ensure(root, relative) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    safe(segment);
    const next = path.join(current, segment);
    if (!fs.existsSync(next)) fs.mkdirSync(next, { mode: 0o700 });
    const stat = fs.lstatSync(next);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("encrypted_ledger_path_invalid");
    fs.chmodSync(next, 0o700);
    current = fs.realpathSync(next);
    const rel = path.relative(root, current);
    if (rel.startsWith("..") || path.isAbsolute(rel)) fail("encrypted_ledger_path_invalid");
  }
  return current;
}

function appendSync(filePath, line) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, "a", 0o600);
    fs.writeFileSync(descriptor, `${line}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  fs.chmodSync(filePath, 0o600);
}

export function createEncryptedLedger({
  vaultRoot,
  encryptionKey,
  workspaceId,
  relativeRoot,
  fileName = "events.jsonl.aead",
  aadPrefix
} = {}) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) fail("encrypted_ledger_key_invalid");
  safe(workspaceId);
  safe(fileName);
  if (typeof aadPrefix !== "string" || !aadPrefix) fail("encrypted_ledger_aad_invalid");
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const root = ensure(vault, relativeRoot);
  const workspaceRoot = ensure(root, workspaceId);
  const filePath = path.join(workspaceRoot, fileName);
  const aad = `${aadPrefix}:${workspaceId}`;

  const read = () => {
    if (!fs.existsSync(filePath)) return [];
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("encrypted_ledger_corrupt");
    const content = fs.readFileSync(filePath, "utf8");
    if (content && !content.endsWith("\n")) fail("encrypted_ledger_truncated");
    const events = [];
    let sequence = 0;
    let tail = "sha256:genesis";
    for (const line of content.split("\n").filter(Boolean)) {
      let frame;
      try { frame = JSON.parse(line); } catch { fail("encrypted_ledger_corrupt"); }
      if (
        frame?.schema !== "supermemory.encrypted-ledger-frame.v1" ||
        frame.sequence !== sequence + 1 || frame.previous_frame_hash !== tail
      ) fail("encrypted_ledger_corrupt");
      const material = canonicalJson({
        schema: frame.schema,
        sequence: frame.sequence,
        previous_frame_hash: frame.previous_frame_hash,
        sealed: frame.sealed
      });
      if (frame.frame_hash !== hash(material)) fail("encrypted_ledger_corrupt");
      let event;
      try { event = openJsonAead(frame.sealed, { encryptionKey, expectedAad: aad }); } catch { fail("encrypted_ledger_corrupt"); }
      if (event.workspace_id !== workspaceId) fail("encrypted_ledger_corrupt");
      events.push(event);
      sequence = frame.sequence;
      tail = frame.frame_hash;
    }
    return events;
  };

  const append = (event) => withVaultMutationLock(vault, () => {
    if (event?.workspace_id !== workspaceId) fail("encrypted_ledger_scope_invalid");
    const events = read();
    const sequence = events.length + 1;
    let previous = "sha256:genesis";
    if (sequence > 1) {
      const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
      previous = JSON.parse(lines.at(-1)).frame_hash;
    }
    const sealed = sealJsonAead(event, { encryptionKey, aad });
    const material = canonicalJson({
      schema: "supermemory.encrypted-ledger-frame.v1", sequence,
      previous_frame_hash: previous, sealed
    });
    appendSync(filePath, canonicalJson({
      schema: "supermemory.encrypted-ledger-frame.v1", sequence,
      previous_frame_hash: previous, sealed, frame_hash: hash(material)
    }));
    return event;
  });

  return Object.freeze({ root: workspaceRoot, filePath, read, append });
}
