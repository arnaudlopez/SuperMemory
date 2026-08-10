import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const SCHEMA = "supermemory.agent-credential-event.v1";
const AGENT_ID = /^agent_[A-Za-z0-9._-]{3,180}$/;
const OWNER_ID = /^owner_[A-Za-z0-9._-]{3,180}$/;
const DEVICE_ID = /^device_[A-Za-z0-9._-]{2,180}$/;
const TOKEN = /^sma_[A-Za-z0-9_-]{43}$/;
const CAPABILITIES = new Set(["pm:context", "pm:recall", "pm:capture", "pm:write", "pm:resolve"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function root(value) {
  const resolved = path.resolve(value ?? "");
  if (!fs.existsSync(resolved) || fs.lstatSync(resolved).isSymbolicLink() || !fs.statSync(resolved).isDirectory()) {
    fail("agent_credential_vault_invalid");
  }
  return fs.realpathSync(resolved);
}

function target(vault, create = false) {
  const directory = path.join(vault, "00_inbox", "supermemory-product");
  if (create) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(vault, "00_inbox"), 0o700);
    fs.chmodSync(directory, 0o700);
  }
  return path.join(directory, "agent-credentials.jsonl");
}

function hashToken(token, salt) {
  return crypto.scryptSync(token, Buffer.from(salt, "base64url"), 32).toString("base64url");
}

function material(randomBytes) {
  const token = `sma_${Buffer.from(randomBytes(32)).toString("base64url")}`;
  const salt = Buffer.from(randomBytes(16)).toString("base64url");
  return { token, salt, token_hash: hashToken(token, salt) };
}

function capabilities(value) {
  const result = [...new Set(value ?? ["pm:context", "pm:recall", "pm:capture"])].sort();
  if (!result.length || result.some((item) => !CAPABILITIES.has(item))) fail("agent_capabilities_invalid");
  return result;
}

function read(file) {
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("agent_credential_store_invalid");
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    try {
      const event = JSON.parse(line);
      if (event.schema !== SCHEMA || !event.event_id || !event.event_type) fail("agent_credential_store_invalid");
      return event;
    } catch (error) {
      if (error?.code) throw error;
      fail("agent_credential_store_invalid");
    }
  });
}

function reduce(events) {
  const records = new Map();
  const ids = new Set();
  for (const event of events) {
    if (ids.has(event.event_id)) fail("agent_credential_store_invalid");
    ids.add(event.event_id);
    if (event.event_type === "credential.issued") {
      records.set(event.agent_id, {
        schema: "supermemory.agent-credential-record.v1",
        agent_id: event.agent_id,
        owner_id: event.owner_id,
        device_id: event.device_id,
        audience: event.audience,
        capabilities: [...event.capabilities],
        salt: event.salt,
        token_hash: event.token_hash,
        status: "active",
        issued_at: event.occurred_at,
        rotated_at: null,
        revoked_at: null
      });
      continue;
    }
    const record = records.get(event.agent_id);
    if (!record) fail("agent_credential_store_invalid");
    if (event.event_type === "credential.rotated") {
      Object.assign(record, { salt: event.salt, token_hash: event.token_hash, device_id: event.device_id, capabilities: [...event.capabilities], status: "active", rotated_at: event.occurred_at, revoked_at: null });
    } else if (event.event_type === "credential.revoked") {
      Object.assign(record, { status: "revoked", revoked_at: event.occurred_at });
    } else fail("agent_credential_store_invalid");
  }
  return records;
}

function write(file, events) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, events.map((item) => `${JSON.stringify(item)}\n`).join(""), { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

export function createAgentCredentialStore({ vaultRoot, clock = () => new Date().toISOString(), randomBytes = crypto.randomBytes } = {}) {
  const vault = root(vaultRoot);
  const file = target(vault);
  const event = (type, payload) => ({ schema: SCHEMA, event_id: `agentcred_${crypto.randomUUID()}`, event_type: type, occurred_at: clock(), ...payload });
  const mutate = (build) => withVaultMutationLock(vault, () => {
    const destination = target(vault, true);
    const events = read(destination);
    const additions = build(reduce(events));
    write(destination, [...events, ...additions]);
    return reduce([...events, ...additions]);
  });
  const validate = ({ agentId, ownerId, deviceId, audience }) => {
    if (!AGENT_ID.test(String(agentId ?? "")) || (ownerId !== undefined && !OWNER_ID.test(String(ownerId))) || !DEVICE_ID.test(String(deviceId ?? "")) || (audience !== undefined && audience !== "supermemoryd")) fail("agent_credential_binding_invalid");
  };
  const issue = ({ agentId, ownerId, deviceId, audience = "supermemoryd", capabilities: requested } = {}) => {
    validate({ agentId, ownerId, deviceId, audience });
    const allowed = capabilities(requested);
    const issuedMaterial = material(randomBytes);
    mutate((records) => {
      if (records.has(agentId)) fail("agent_credential_already_exists");
      return [event("credential.issued", { agent_id: agentId, owner_id: ownerId, device_id: deviceId, audience, capabilities: allowed, salt: issuedMaterial.salt, token_hash: issuedMaterial.token_hash })];
    });
    return { schema: "supermemory.agent-credential.v1", token: issuedMaterial.token, agent_id: agentId, owner_id: ownerId, device_id: deviceId, audience, capabilities: allowed };
  };
  const provision = ({ token, agentId, ownerId, deviceId, audience = "supermemoryd", capabilities: requested } = {}) => {
    validate({ agentId, ownerId, deviceId, audience });
    if (!TOKEN.test(String(token ?? ""))) fail("agent_credential_binding_invalid");
    const allowed = capabilities(requested);
    const salt = Buffer.from(randomBytes(16)).toString("base64url");
    let existing = false;
    mutate((records) => {
      const record = records.get(agentId);
      if (record) {
        existing = true;
        if (
          record.status !== "active" || record.owner_id !== ownerId || record.device_id !== deviceId ||
          record.audience !== audience || record.capabilities.join("\0") !== allowed.join("\0") ||
          hashToken(token, record.salt) !== record.token_hash
        ) fail("agent_credential_already_exists");
        return [];
      }
      return [event("credential.issued", { agent_id: agentId, owner_id: ownerId, device_id: deviceId, audience, capabilities: allowed, salt, token_hash: hashToken(token, salt) })];
    });
    return { schema: "supermemory.agent-credential.v1", status: existing ? "existing" : "provisioned", agent_id: agentId, owner_id: ownerId, device_id: deviceId, audience, capabilities: allowed };
  };
  const rotate = ({ agentId, deviceId, capabilities: requested } = {}) => {
    validate({ agentId, deviceId });
    const rotatedMaterial = material(randomBytes);
    let record;
    mutate((records) => {
      record = records.get(agentId);
      if (!record || record.status !== "active") fail("agent_credential_unknown");
      const allowed = capabilities(requested ?? record.capabilities);
      return [event("credential.rotated", { agent_id: agentId, device_id: deviceId, capabilities: allowed, salt: rotatedMaterial.salt, token_hash: rotatedMaterial.token_hash })];
    });
    return { schema: "supermemory.agent-credential.v1", token: rotatedMaterial.token, agent_id: agentId, owner_id: record.owner_id, device_id: deviceId, audience: record.audience, capabilities: capabilities(requested ?? record.capabilities) };
  };
  const rotateTo = ({ token, agentId, deviceId, capabilities: requested } = {}) => {
    validate({ agentId, deviceId });
    if (!TOKEN.test(String(token ?? ""))) fail("agent_credential_binding_invalid");
    const salt = Buffer.from(randomBytes(16)).toString("base64url");
    let record;
    let allowed;
    mutate((records) => {
      record = records.get(agentId);
      if (!record) fail("agent_credential_unknown");
      allowed = capabilities(requested ?? record.capabilities);
      return [event("credential.rotated", {
        agent_id: agentId,
        device_id: deviceId,
        capabilities: allowed,
        salt,
        token_hash: hashToken(token, salt)
      })];
    });
    return { schema: "supermemory.agent-credential.v1", status: "rotated", agent_id: agentId, owner_id: record.owner_id, device_id: deviceId, audience: record.audience, capabilities: allowed };
  };
  const revoke = ({ agentId } = {}) => {
    if (!AGENT_ID.test(String(agentId ?? ""))) fail("agent_credential_binding_invalid");
    mutate((records) => {
      const record = records.get(agentId);
      if (!record) fail("agent_credential_unknown");
      return record.status === "revoked" ? [] : [event("credential.revoked", { agent_id: agentId })];
    });
    return { agent_id: agentId, status: "revoked" };
  };
  const authenticate = ({ agentId, deviceId, audience, token, capability } = {}) => {
    if (!AGENT_ID.test(String(agentId ?? "")) || !DEVICE_ID.test(String(deviceId ?? "")) || audience !== "supermemoryd" || !TOKEN.test(String(token ?? "")) || (capability && !CAPABILITIES.has(capability))) fail("not_authorized");
    const record = reduce(read(file)).get(agentId);
    if (!record || record.status !== "active" || record.device_id !== deviceId || record.audience !== audience || (capability && !record.capabilities.includes(capability))) fail("not_authorized");
    const actual = Buffer.from(hashToken(token, record.salt));
    const expected = Buffer.from(record.token_hash);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) fail("not_authorized");
    return Object.freeze({ ownerId: record.owner_id, agentId: record.agent_id, deviceId: record.device_id, audience: record.audience, capabilities: [...record.capabilities] });
  };
  const snapshot = () => [...reduce(read(file)).values()].map(({ salt, token_hash, ...record }) => ({ ...record, capabilities: [...record.capabilities] }));
  return Object.freeze({ issue, provision, rotate, rotateTo, revoke, authenticate, snapshot, storePath: file });
}
