import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { configureZ2Client } from "../scripts/configure-z2-client.mjs";
import { createProjectRegistry } from "../scripts/lib/project-registry.mjs";

test("Mac mini M4 Pro config is a remote-only Z2 client with a persistent tunnel", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-z2-client-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const vault = path.join(root, "vault");
  const runtime = path.join(root, "runtime");
  const configs = path.join(root, "configs");
  const agent = path.join(root, "com.supermemory.z2-tunnel.plist");
  fs.mkdirSync(project);
  fs.mkdirSync(vault);
  fs.mkdirSync(runtime);
  assert.equal(spawnSync("git", ["init", "-q", project]).status, 0);
  const binding = createProjectRegistry({ vaultRoot: vault }).initProject({ projectRoot: project });
  const key = path.join(root, "archive.key");
  const token = path.join(root, "daemon.token");
  const graphToken = path.join(root, "graphd.token");
  fs.writeFileSync(key, Buffer.alloc(32, 1), { mode: 0o600 });
  fs.writeFileSync(token, "daemon-token-0000000000000000000000000000", { mode: 0o600 });
  fs.writeFileSync(graphToken, "graph-token-00000000000000000000000000000", { mode: 0o600 });

  const options = {
    projectRoot: project,
    runtimeRoot: runtime,
    keyFile: key,
    tokenFile: token,
    graphTokenFile: graphToken,
    configRoot: configs,
    launchAgentPath: agent,
    sshHost: "z2"
  };
  const plan = configureZ2Client(options);
  assert.equal(plan.applied, false);
  assert.equal(fs.existsSync(configs), false);

  const applied = configureZ2Client({ ...options, apply: true });
  assert.equal(applied.applied, true);
  const hook = JSON.parse(fs.readFileSync(applied.files.hook_runtime, "utf8"));
  const mcp = JSON.parse(fs.readFileSync(applied.files.mcp_runtime, "utf8"));
  const contract = JSON.parse(fs.readFileSync(applied.files.runtime_contract, "utf8"));
  assert.equal(hook.client_mode, "remote");
  assert.equal(mcp.client_mode, "remote");
  assert.equal("vault_root" in hook, false);
  assert.equal("vault_root" in mcp, false);
  assert.equal(hook.expected_workspace_id, binding.workspaceId);
  assert.equal(mcp.expected_project_id, binding.projectId);
  assert.equal(contract.deployment.activation, "full");
  assert.equal(contract.schema, "supermemory.codex-runtime.v5");
  assert.equal(contract.deployment.canary, false);
  assert.equal(contract.deployment.progressive, false);
  assert.equal(contract.topic_continuity.enabled, true);
  assert.equal(contract.temporal_retrieval.max_rounds, 3);
  assert.equal(contract.authority.mode, "quiet");
  const tunnel = fs.readFileSync(agent, "utf8");
  for (const forward of [
    "4310:127.0.0.1:4310",
    "8765:127.0.0.1:8765",
    "9999:127.0.0.1:9999",
    "8888:127.0.0.1:8888",
    "8787:127.0.0.1:8787"
  ]) assert.match(tunnel, new RegExp(forward.replaceAll(".", "\\.")));
  assert.match(tunnel, /ExitOnForwardFailure=yes/);
  assert.match(tunnel, /ServerAliveInterval=30/);
});
