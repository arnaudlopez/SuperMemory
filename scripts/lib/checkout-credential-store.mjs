import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const SCHEMA = "supermemory.checkout-credential-event.v1";
const PROJECT_ID = /^prj_[0-9a-f-]{36}$/i;
const WORKSPACE_ID = /^ws_[0-9a-f-]{36}$/i;
const CHECKOUT_ID = /^co_[0-9a-f-]{36}$/i;
const DEVICE_ID = /^device_[A-Za-z0-9._-]{8,180}$/;
const TOKEN = /^smco_[A-Za-z0-9_-]{43}$/;
const CAPABILITIES = new Set(["capture", "recall", "status", "history_import"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function safeRoot(value) {
  const root = path.resolve(value ?? "");
  if (!fs.existsSync(root)) fail("credential_vault_missing");
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("credential_vault_invalid");
  return fs.realpathSync(root);
}

function secureDirectory(parent, segment) {
  const target = path.join(parent, segment);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("credential_store_invalid");
  } else {
    fs.mkdirSync(target, { mode: 0o700 });
  }
  fs.chmodSync(target, 0o700);
  return target;
}

function storePath(vaultRoot, create = false) {
  const inbox = path.join(vaultRoot, "00_inbox");
  const product = path.join(inbox, "supermemory-product");
  if (create) {
    secureDirectory(vaultRoot, "00_inbox");
    secureDirectory(inbox, "supermemory-product");
  }
  return path.join(product, "checkout-credentials.jsonl");
}

function readEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    fail("credential_store_invalid");
  }
  return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line) => {
    try {
      const value = JSON.parse(line);
      if (value?.schema !== SCHEMA || typeof value.event_type !== "string") fail("credential_store_invalid");
      return value;
    } catch (error) {
      if (error?.code === "credential_store_invalid") throw error;
      fail("credential_store_invalid");
    }
  });
}

function reduce(events) {
  const records = new Map();
  const eventIds = new Set();
  for (const event of events) {
    if (!event.event_id || eventIds.has(event.event_id)) fail("credential_store_invalid");
    eventIds.add(event.event_id);
    if (event.event_type === "credential.issued") {
      if (
        !CHECKOUT_ID.test(event.checkout_id) || !PROJECT_ID.test(event.project_id) ||
        !WORKSPACE_ID.test(event.workspace_id) || !DEVICE_ID.test(event.device_id) ||
        typeof event.salt !== "string" || typeof event.token_hash !== "string" ||
        !Array.isArray(event.capabilities) || event.capabilities.some((value) => !CAPABILITIES.has(value))
      ) fail("credential_store_invalid");
      records.set(event.checkout_id, {
        schema: "supermemory.checkout-credential-record.v1",
        checkout_id: event.checkout_id,
        project_id: event.project_id,
        workspace_id: event.workspace_id,
        device_id: event.device_id,
        salt: event.salt,
        token_hash: event.token_hash,
        capabilities: [...event.capabilities],
        status: "active",
        created_at: event.occurred_at,
        rotated_at: null,
        revoked_at: null,
        last_used_at: null
      });
      continue;
    }
    const record = records.get(event.checkout_id);
    if (!record) fail("credential_store_invalid");
    if (event.event_type === "credential.rotated") {
      record.salt = event.salt;
      record.token_hash = event.token_hash;
      record.device_id = event.device_id;
      record.capabilities = [...event.capabilities];
      record.status = "active";
      record.rotated_at = event.occurred_at;
      record.revoked_at = null;
      continue;
    }
    if (event.event_type === "credential.revoked") {
      record.status = "revoked";
      record.revoked_at = event.occurred_at;
      continue;
    }
    fail("credential_store_invalid");
  }
  return records;
}

function hashToken(token, salt) {
  return crypto.scryptSync(token, Buffer.from(salt, "base64url"), 32).toString("base64url");
}

function credentialMaterial(randomBytes) {
  const token = `smco_${Buffer.from(randomBytes(32)).toString("base64url")}`;
  const salt = Buffer.from(randomBytes(16)).toString("base64url");
  return { token, salt, token_hash: hashToken(token, salt) };
}

function atomicWrite(filePath, content) {
  const directory = path.dirname(filePath);
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temp, filePath);
    fs.chmodSync(filePath, 0o600);
    try {
      const dir = fs.openSync(directory, "r");
      fs.fsyncSync(dir);
      fs.closeSync(dir);
    } catch {
      // File fsync + atomic rename is the portable baseline.
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

function cleanCapabilities(value) {
  const capabilities = [...new Set(value ?? ["capture", "recall", "status"])].sort();
  if (capabilities.length === 0 || capabilities.some((item) => !CAPABILITIES.has(item))) {
    fail("credential_capabilities_invalid");
  }
  return capabilities;
}

function validateBinding({ checkoutId, projectId, workspaceId, deviceId }) {
  if (
    !CHECKOUT_ID.test(String(checkoutId ?? "")) || !PROJECT_ID.test(String(projectId ?? "")) ||
    !WORKSPACE_ID.test(String(workspaceId ?? "")) || !DEVICE_ID.test(String(deviceId ?? ""))
  ) fail("credential_binding_invalid");
}

export function createCheckoutCredentialStore({
  vaultRoot,
  clock = () => new Date().toISOString(),
  randomBytes = crypto.randomBytes
} = {}) {
  const vault = safeRoot(vaultRoot);
  const target = storePath(vault);
  const event = (eventType, payload) => ({
    schema: SCHEMA,
    event_id: `cred_${crypto.randomUUID()}`,
    event_type: eventType,
    occurred_at: clock(),
    ...payload
  });
  const mutate = (build) => withVaultMutationLock(vault, () => {
    const filePath = storePath(vault, true);
    const events = readEvents(filePath);
    const additions = build(reduce(events));
    atomicWrite(filePath, [...events, ...additions].map((item) => `${JSON.stringify(item)}\n`).join(""));
    return reduce([...events, ...additions]);
  });

  const issue = ({ checkoutId, projectId, workspaceId, deviceId, capabilities } = {}) => {
    validateBinding({ checkoutId, projectId, workspaceId, deviceId });
    const allowed = cleanCapabilities(capabilities);
    const material = credentialMaterial(randomBytes);
    mutate((records) => {
      if (records.has(checkoutId)) fail("credential_already_exists");
      return [event("credential.issued", {
        checkout_id: checkoutId,
        project_id: projectId,
        workspace_id: workspaceId,
        device_id: deviceId,
        capabilities: allowed,
        salt: material.salt,
        token_hash: material.token_hash
      })];
    });
    return {
      schema: "supermemory.checkout-credential.v1",
      token: material.token,
      checkout_id: checkoutId,
      project_id: projectId,
      workspace_id: workspaceId,
      device_id: deviceId,
      capabilities: allowed
    };
  };

  const rotate = ({ checkoutId, deviceId, capabilities } = {}) => {
    if (!CHECKOUT_ID.test(String(checkoutId ?? "")) || !DEVICE_ID.test(String(deviceId ?? ""))) {
      fail("credential_binding_invalid");
    }
    const material = credentialMaterial(randomBytes);
    let record;
    mutate((records) => {
      record = records.get(checkoutId);
      if (!record || record.status !== "active") fail("credential_unknown");
      const allowed = cleanCapabilities(capabilities ?? record.capabilities);
      return [event("credential.rotated", {
        checkout_id: checkoutId,
        device_id: deviceId,
        capabilities: allowed,
        salt: material.salt,
        token_hash: material.token_hash
      })];
    });
    return {
      schema: "supermemory.checkout-credential.v1",
      token: material.token,
      checkout_id: checkoutId,
      project_id: record.project_id,
      workspace_id: record.workspace_id,
      device_id: deviceId,
      capabilities: cleanCapabilities(capabilities ?? record.capabilities)
    };
  };

  const revoke = ({ checkoutId } = {}) => {
    if (!CHECKOUT_ID.test(String(checkoutId ?? ""))) fail("credential_binding_invalid");
    mutate((records) => {
      const record = records.get(checkoutId);
      if (!record) fail("credential_unknown");
      if (record.status === "revoked") return [];
      return [event("credential.revoked", { checkout_id: checkoutId })];
    });
    return { schema: "supermemory.checkout-credential-revocation.v1", checkout_id: checkoutId, status: "revoked" };
  };

  const authenticate = ({ checkoutId, token, deviceId, capability } = {}) => {
    if (
      !CHECKOUT_ID.test(String(checkoutId ?? "")) || !TOKEN.test(String(token ?? "")) ||
      !DEVICE_ID.test(String(deviceId ?? "")) || (capability && !CAPABILITIES.has(capability))
    ) fail("not_authorized");
    const record = reduce(readEvents(target)).get(checkoutId);
    if (!record || record.status !== "active" || record.device_id !== deviceId) fail("not_authorized");
    if (capability && !record.capabilities.includes(capability)) fail("not_authorized");
    const actual = Buffer.from(hashToken(token, record.salt));
    const expected = Buffer.from(record.token_hash);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) fail("not_authorized");
    return Object.freeze({
      workspaceId: record.workspace_id,
      projectId: record.project_id,
      checkoutId: record.checkout_id,
      deviceId: record.device_id,
      capabilities: [...record.capabilities]
    });
  };

  const snapshot = () => [...reduce(readEvents(target)).values()].map((record) => ({
    ...record,
    salt: undefined,
    token_hash: undefined,
    capabilities: [...record.capabilities]
  }));

  return { issue, rotate, revoke, authenticate, snapshot, storePath: target };
}
