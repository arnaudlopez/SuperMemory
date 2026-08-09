import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCheckoutCredentialStore } from "../scripts/lib/checkout-credential-store.mjs";
import { createProjectRegistry } from "../scripts/lib/project-registry.mjs";
import { createRequestScopeResolver } from "../scripts/lib/request-scope-resolver.mjs";
import { createSuperMemoryDaemon } from "../scripts/lib/supermemory-daemon.mjs";

const OWNER_TOKEN = "owner-daemon-token-000000000000000000000000";

test("multi-project daemon resolves checkout scope server-side and rejects a copied credential", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-daemon-multi-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const registry = createProjectRegistry({ vaultRoot: vault });
  const binding = registry.registerRemoteBinding({
    displayName: "A",
    rootFingerprint: `sha256:${"a".repeat(64)}`,
    deviceFingerprint: "device_fixture-mac"
  });
  const credentials = createCheckoutCredentialStore({ vaultRoot: vault });
  const credential = credentials.issue({
    checkoutId: binding.checkoutId,
    projectId: binding.projectId,
    workspaceId: binding.workspaceId,
    deviceId: "device_fixture-mac"
  });
  const seen = [];
  const router = (scope) => ({
    status: async () => { seen.push(scope); return { workspace_id: scope.workspaceId, project_id: scope.projectId }; }
  });
  const supervisor = {
    forScope: router,
    forProject: router,
    recover: async () => ({ recovered: 1, failures: [] }),
    status: () => ({ active_contexts: 0 }),
    close: async () => {},
    notifySessionClosed: async () => {}
  };
  const compiler = { notifyCapture() {}, recover() {}, stop: async () => {}, stats: () => ({ status: "idle" }) };
  const daemon = createSuperMemoryDaemon({
    vaultRoot: vault,
    encryptionKey: Buffer.alloc(32, 9),
    authToken: OWNER_TOKEN,
    memoryCompiler: compiler,
    runtimeSupervisor: supervisor,
    requestScopeResolver: createRequestScopeResolver({ credentialStore: credentials }),
    projectRegistry: registry
  });
  t.after(() => daemon.stop());
  const address = await daemon.start();
  const headers = {
    authorization: `Bearer ${OWNER_TOKEN}`,
    "content-type": "application/json",
    "x-supermemory-checkout-id": binding.checkoutId,
    "x-supermemory-device-id": "device_fixture-mac",
    "x-supermemory-checkout-token": credential.token
  };
  const response = await fetch(`${address.url}/v1/memory/status`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).workspace_id, binding.workspaceId);
  assert.equal(seen[0].checkoutId, binding.checkoutId);
  const rejected = await fetch(`${address.url}/v1/memory/status`, {
    method: "POST",
    headers: { ...headers, "x-supermemory-checkout-token": `smco_${"x".repeat(43)}` },
    body: "{}"
  });
  assert.equal(rejected.status, 404);
  const projects = await fetch(`${address.url}/v1/projects`, {
    headers: { authorization: `Bearer ${OWNER_TOKEN}` }
  });
  assert.equal(projects.status, 200);
  assert.equal((await projects.json()).projects.length, 1);
});
