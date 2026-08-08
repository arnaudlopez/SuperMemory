import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";

const WORKSPACE = /^ws_[A-Za-z0-9._:-]{8,}$/;
const OPERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["pending", "processing", "completed", "failed", "cancelled"]);
const TYPES = new Set(["retain", "consolidation", "delete", "rebuild"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) fail("hindsight_receipt_key_invalid");
}

function safeSegment(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function createHindsightOperationReceiptStore({ vaultRoot, encryptionKey, workspaceId, clock = () => new Date().toISOString() } = {}) {
  assertKey(encryptionKey);
  const workspace = safeSegment(workspaceId, WORKSPACE, "hindsight_receipt_workspace_invalid");
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const root = path.join(vault, "20_professional", "memory-fabric", workspace, "hindsight-operations");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const fileFor = (operationId) => path.join(root, `${safeSegment(operationId, OPERATION, "hindsight_operation_id_invalid")}.aead.json`);
  const aadFor = (operationId) => `supermemory.hindsight-operation-receipt.v1\0${workspace}\0${operationId}`;

  const read = (operationId) => {
    const file = fileFor(operationId);
    if (!fs.existsSync(file)) return null;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("hindsight_receipt_file_insecure");
    const value = openJsonAead(JSON.parse(fs.readFileSync(file, "utf8")), {
      encryptionKey,
      expectedAad: aadFor(operationId)
    });
    if (value?.workspace_id !== workspace || value?.operation_id !== operationId) fail("hindsight_receipt_scope_invalid");
    return value;
  };

  const put = ({ operationId, documentId, operationType = "retain", payloadHash, status = "pending", error = null } = {}) => {
    safeSegment(operationId, OPERATION, "hindsight_operation_id_invalid");
    if (!STATUSES.has(status)) fail("hindsight_operation_status_invalid");
    if (!TYPES.has(operationType)) fail("hindsight_operation_type_invalid");
    if (typeof documentId !== "string" || !documentId || documentId.length > 512) fail("hindsight_document_id_invalid");
    if (typeof payloadHash !== "string" || !/^[0-9a-f]{64}$/i.test(payloadHash)) fail("hindsight_payload_hash_invalid");
    const previous = read(operationId);
    if (previous && (previous.document_id !== documentId || previous.payload_hash !== payloadHash)) {
      fail("hindsight_operation_replay_conflict");
    }
    const now = clock();
    const receipt = {
      schema: "supermemory.hindsight-operation-receipt.v1",
      workspace_id: workspace,
      operation_id: operationId,
      operation_type: operationType,
      document_id: documentId,
      payload_hash: payloadHash.toLowerCase(),
      status,
      error,
      created_at: previous?.created_at ?? now,
      updated_at: now
    };
    atomicWrite(fileFor(operationId), `${canonicalJson(sealJsonAead(receipt, {
      encryptionKey,
      aad: aadFor(operationId)
    }))}\n`);
    return receipt;
  };

  const list = () => fs.readdirSync(root)
    .filter((name) => name.endsWith(".aead.json"))
    .sort()
    .map((name) => read(name.slice(0, -".aead.json".length)));

  return Object.freeze({ workspaceId: workspace, root, read, put, list });
}
