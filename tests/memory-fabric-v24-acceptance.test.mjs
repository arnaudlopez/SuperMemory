import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("v2.4 production artifacts keep Hermes on Home 101 and outside the Z2 stack", () => {
  const compose = fs.readFileSync("deploy/portainer/supermemory-ai-stack.yml", "utf8");
  const contract = JSON.parse(fs.readFileSync("deploy/runtime/runtime-contract.production.json", "utf8"));
  assert.doesNotMatch(compose, /^\s{2}hermes:/m);
  assert.doesNotMatch(compose, /SUPERMEMORY_AGENT_DEVICE/);
  assert.doesNotMatch(compose, /HERMES_MEMORY_PROVIDER:\s*hindsight/);
  assert.equal(contract.schema, "supermemory.codex-runtime.v8");
  assert.equal(contract.personal_manager.memory_provider, "supermemory-fabric");
  assert.equal(contract.personal_manager.runtime_host, "home101");
  assert.equal(contract.personal_manager.device_id, "device_home101");
  assert.equal(contract.personal_manager.transport, "ssh_local_forward");
  assert.equal(contract.personal_manager.endpoint, "http://127.0.0.1:18765");
  assert.equal(contract.deployment.canary, false);
  assert.equal(contract.deployment.progressive, false);
});

test("the v2.4 verifier is wired into package scripts", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts["verify:memory-fabric-v24"], /verify-memory-fabric-v24/);
});

test("Personal Manager portfolio recall derives a canonical working-set binding", () => {
  const daemon = fs.readFileSync("scripts/supermemoryd.mjs", "utf8");
  assert.match(daemon, /workingSetStore\.listWorkingSets\(\{[\s\S]*?workspaceId: project\.workspaceId,[\s\S]*?projectId: project\.projectId[\s\S]*?\}\)\.at\(-1\)/);
  assert.match(daemon, /working_set_id: workingSet\.manifest\.working_set_id/);
});
