import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgentCredentialStore } from "../scripts/lib/agent-credential-store.mjs";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-agent-credential-"));
}

test("agent credentials are owner-bound, capability-scoped, rotatable and revocable", () => {
  const vaultRoot = fixture();
  const store = createAgentCredentialStore({ vaultRoot, clock: () => "2026-08-10T10:00:00.000Z" });
  const issued = store.issue({
    agentId: "agent_personal_manager",
    ownerId: "owner_personal",
    deviceId: "device_z2",
    audience: "supermemoryd",
    capabilities: ["pm:context", "pm:recall", "pm:write"]
  });
  assert.match(issued.token, /^sma_[A-Za-z0-9_-]{43}$/);
  const authenticated = store.authenticate({
    agentId: issued.agent_id,
    deviceId: issued.device_id,
    audience: "supermemoryd",
    token: issued.token,
    capability: "pm:write"
  });
  assert.equal(authenticated.ownerId, "owner_personal");
  assert.equal(authenticated.agentId, "agent_personal_manager");
  assert.throws(() => store.authenticate({
    agentId: issued.agent_id,
    deviceId: issued.device_id,
    audience: "supermemoryd",
    token: issued.token,
    capability: "pm:resolve"
  }), { message: "not_authorized" });

  const rotated = store.rotate({ agentId: issued.agent_id, deviceId: issued.device_id });
  assert.notEqual(rotated.token, issued.token);
  assert.throws(() => store.authenticate({
    agentId: issued.agent_id,
    deviceId: issued.device_id,
    audience: "supermemoryd",
    token: issued.token,
    capability: "pm:recall"
  }), { message: "not_authorized" });
  store.revoke({ agentId: issued.agent_id });
  assert.throws(() => store.authenticate({
    agentId: issued.agent_id,
    deviceId: issued.device_id,
    audience: "supermemoryd",
    token: rotated.token,
    capability: "pm:recall"
  }), { message: "not_authorized" });
  assert.equal(store.snapshot()[0].token_hash, undefined);
});

test("a checkout token cannot authenticate as the Personal Manager", () => {
  const store = createAgentCredentialStore({ vaultRoot: fixture() });
  assert.throws(() => store.authenticate({
    agentId: "agent_personal_manager",
    deviceId: "device_z2",
    audience: "supermemoryd",
    token: `smco_${crypto.randomBytes(32).toString("base64url")}`,
    capability: "pm:recall"
  }), { message: "not_authorized" });
});

test("an operator can adopt a pre-mounted token without exposing it in the receipt", () => {
  const store = createAgentCredentialStore({ vaultRoot: fixture() });
  const issued = store.issue({
    agentId: "agent_personal_manager",
    ownerId: "owner_personal",
    deviceId: "device_z2",
    capabilities: ["pm:recall"]
  });
  const replacement = `sma_${crypto.randomBytes(32).toString("base64url")}`;
  const receipt = store.rotateTo({
    token: replacement,
    agentId: issued.agent_id,
    deviceId: issued.device_id
  });
  assert.equal(receipt.status, "rotated");
  assert.equal(receipt.token, undefined);
  assert.equal(store.authenticate({
    agentId: issued.agent_id,
    deviceId: issued.device_id,
    audience: "supermemoryd",
    token: replacement,
    capability: "pm:recall"
  }).agentId, issued.agent_id);
  store.revoke({ agentId: issued.agent_id });
  const restored = `sma_${crypto.randomBytes(32).toString("base64url")}`;
  store.rotateTo({ token: restored, agentId: issued.agent_id, deviceId: issued.device_id });
  assert.equal(store.authenticate({
    agentId: issued.agent_id,
    deviceId: issued.device_id,
    audience: "supermemoryd",
    token: restored,
    capability: "pm:recall"
  }).agentId, issued.agent_id);
});

test("credential CLI rebinds the Personal Manager to Home 101 explicitly", () => {
  const vaultRoot = fixture();
  const store = createAgentCredentialStore({ vaultRoot });
  store.issue({
    agentId: "agent_personal_manager",
    ownerId: "owner_personal",
    deviceId: "device_z2",
    capabilities: ["pm:recall"]
  });
  const tokenFile = path.join(vaultRoot, "home101-agent-token");
  const token = `sma_${crypto.randomBytes(32).toString("base64url")}`;
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  const result = spawnSync(process.execPath, [
    "scripts/personal-manager-credential.mjs",
    "--vault-root", vaultRoot,
    "--rotate-from-file",
    "--agent-token-file", tokenFile,
    "--device-id", "device_home101",
    "--confirm", "ROTATE personal-manager credential"
  ], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.device_id, "device_home101");
  assert.equal(receipt.token, undefined);
  const reopened = createAgentCredentialStore({ vaultRoot });
  assert.equal(reopened.authenticate({
    agentId: "agent_personal_manager",
    deviceId: "device_home101",
    audience: "supermemoryd",
    token,
    capability: "pm:recall"
  }).agentId, "agent_personal_manager");
});
