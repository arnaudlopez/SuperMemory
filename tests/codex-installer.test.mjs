import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexInstaller } from "../scripts/lib/codex-installer.mjs";
import {
  createFullDeploymentRuntimeV4,
  normalizeCodexRuntimeConfig
} from "../scripts/lib/codex-runtime-config.mjs";

const pluginSource = path.resolve("plugins/supermemory");
const hookScript = path.resolve("scripts/supermemory-hook.mjs");
const mcpScript = path.resolve("scripts/supermemory-mcp.mjs");
const NOW = "2026-07-24T21:00:00.000Z";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-installer-"));
  const codexHome = path.join(root, "codex-home");
  const project = path.join(root, "project");
  const vault = path.join(root, "vault");
  const runtime = path.join(root, "runtime");
  const backups = path.join(root, "backups");
  for (const directory of [codexHome, project, vault, runtime]) fs.mkdirSync(directory);
  const keyFile = path.join(root, "capture.key");
  const tokenFile = path.join(root, "daemon.token");
  fs.writeFileSync(keyFile, Buffer.alloc(32, 0x71), { mode: 0o600 });
  fs.writeFileSync(tokenFile, "fixture-daemon-token-value\n", { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installer = createCodexInstaller({
    codexHome,
    projectRoot: project,
    pluginSource,
    vaultRoot: vault,
    runtimeRoot: runtime,
    keyFile,
    tokenFile,
    hookScript,
    mcpScript,
    backupsRoot: backups,
    clock: () => NOW
  });
  return { root, codexHome, project, vault, runtime, backups, installer };
}

test("install plan is redacted/read-only and apply requires its exact hash", (t) => {
  const { root, codexHome, project, installer } = fixture(t);
  const before = fs.readdirSync(codexHome);
  const plan = installer.plan();
  assert.equal(plan.writes_performed, false);
  assert.equal(JSON.stringify(plan).includes(root), false);
  assert.deepEqual(fs.readdirSync(codexHome), before);
  assert.throws(() => installer.apply(plan), (error) => (
    error.code === "exact_confirmation_required"
  ));
  const installed = installer.apply(plan, {
    confirmation: `APPLY ${plan.plan_hash}`
  });
  assert.equal(installed.status, "installed");
  assert.equal(installed.backup_verified, true);
  assert.equal(installed.config_toml_modified, false);
  assert.equal(fs.existsSync(path.join(codexHome, "plugins", "supermemory", ".mcp.json")), true);
  assert.equal(fs.existsSync(path.join(project, "plugins", "supermemory", ".mcp.json")), true);
  assert.equal(fs.existsSync(path.join(project, ".codex", "supermemory", "mcp-runtime.json")), true);
  const runtimeContract = JSON.parse(fs.readFileSync(
    path.join(project, ".codex", "supermemory", "runtime-contract.json"),
    "utf8"
  ));
  assert.equal(runtimeContract.schema, "supermemory.codex-runtime.v4");
  assert.equal(runtimeContract.deployment.strategy, "full");
  assert.equal(runtimeContract.deployment.canary, false);
  assert.equal(runtimeContract.deployment.progressive, false);
  assert.equal(runtimeContract.deployment.activation, "disabled");
  assert.equal(runtimeContract.working_memory.enabled, false);
  const marketplace = JSON.parse(fs.readFileSync(
    path.join(project, ".agents", "plugins", "marketplace.json"),
    "utf8"
  ));
  const entry = marketplace.plugins.find((plugin) => plugin.name === "supermemory");
  assert.equal(entry.source.path, "./plugins/supermemory");
  assert.equal(entry.policy.installation, "INSTALLED_BY_DEFAULT");
  assert.equal(fs.existsSync(path.join(codexHome, "config.toml")), false);
});

test("v1/v2/v3 migrate flags-off and explicit v4 activation is one complete deployment contract", () => {
  for (const schema of ["supermemory.hook-runtime.v1", "supermemory.codex-runtime.v2", "supermemory.codex-runtime.v3"]) {
    const migrated = normalizeCodexRuntimeConfig({ schema });
    assert.equal(migrated.schema, "supermemory.codex-runtime.v4");
    assert.equal(migrated.migration.source_schema, schema);
    assert.equal(migrated.migration.compatibility_flags_off, true);
    assert.equal(migrated.working_memory.enabled, false);
    assert.equal(migrated.memory_router.enabled, false);
    assert.equal(migrated.knowledge_graph.enabled, false);
    assert.equal(migrated.continuous_improvement.enabled, false);
    assert.equal(migrated.admission.mode, "legacy_manual");
  }
  const full = createFullDeploymentRuntimeV4({
    graphEndpoint: "http://127.0.0.1:8787",
    graphTokenFile: "/secure/graphd_token"
  });
  assert.equal(full.deployment.activation, "full");
  assert.equal(full.deployment.canary, false);
  assert.equal(full.deployment.progressive, false);
  assert.equal(full.working_memory.enabled, true);
  assert.equal(full.working_memory.offload.enabled, true);
  assert.equal(full.memory_router.enabled, true);
  assert.equal(full.knowledge_graph.enabled, true);
  assert.equal(full.knowledge_graph.driver, "graphd-neo4j");
  assert.equal(full.hindsight.enabled, true);
  assert.equal(full.hindsight.minimum_version, "0.9.0");
  assert.equal(full.hindsight.reflect.enabled, true);
  assert.equal(full.continuous_improvement.enabled, true);
  assert.equal(full.admission.human_review_default, false);
  assert.equal(full.migration.immutable_vault_rewrite, false);
});

test("rollback restores previous plugin state and always preserves the vault", (t) => {
  const { codexHome, vault, installer } = fixture(t);
  const oldPlugin = path.join(codexHome, "plugins", "supermemory");
  fs.mkdirSync(oldPlugin, { recursive: true });
  fs.writeFileSync(path.join(oldPlugin, "old-marker.txt"), "previous");
  const plan = installer.plan();
  const installed = installer.apply(plan, {
    confirmation: `APPLY ${plan.plan_hash}`
  });
  assert.equal(fs.existsSync(path.join(oldPlugin, "old-marker.txt")), false);
  assert.throws(() => installer.rollback(installed), (error) => (
    error.code === "exact_confirmation_required"
  ));
  const rolledBack = installer.rollback(installed, {
    confirmation: `ROLLBACK ${installed.install_id}`
  });
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.vault_preserved, true);
  assert.equal(rolledBack.dual_capture_enabled, false);
  assert.equal(fs.readFileSync(path.join(oldPlugin, "old-marker.txt"), "utf8"), "previous");
  assert.equal(fs.existsSync(vault), true);
});

test("existing duplicate handlers block apply and native memories remain explicitly non-authoritative", (t) => {
  const { codexHome, installer } = fixture(t);
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "features.memories = true",
    "[[hooks.SessionStart]]",
    "[[hooks.SessionStart.hooks]]",
    "type = \"command\"",
    "command = \"node /opt/supermemory/scripts/hook.mjs\"",
    "[[hooks.Stop]]",
    "[[hooks.Stop.hooks]]",
    "type = \"command\"",
    "command = 'node /opt/SuperMemory/scripts/hook.mjs'"
  ].join("\n"));
  const plan = installer.plan();
  assert.equal(plan.checks.native_memories_enabled, true);
  assert.equal(plan.checks.native_memories_authoritative, false);
  assert.ok(plan.checks.duplicate_hook_count > 1);
  assert.throws(() => installer.apply(plan, {
    confirmation: `APPLY ${plan.plan_hash}`
  }), (error) => error.code === "duplicate_hooks_detected");
});

test("project names containing SuperMemory are not misclassified as duplicate hooks", (t) => {
  const { codexHome, project, installer } = fixture(t);
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    `[projects."${project}/SuperMemory"]`,
    'trust_level = "trusted"',
    "",
    "[[hooks.SessionStart]]",
    "[[hooks.SessionStart.hooks]]",
    'type = "command"',
    'command = "node /opt/claude-memory-compiler/session-start.js"'
  ].join("\n"));
  const plan = installer.plan();
  assert.equal(plan.checks.duplicate_hook_count, 0);
});

test("marketplace merge preserves unrelated entries and rollback restores it byte-for-byte", (t) => {
  const { project, installer } = fixture(t);
  const marketplacePath = path.join(project, ".agents", "plugins", "marketplace.json");
  fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
  const original = `${JSON.stringify({
    name: "owner-marketplace",
    interface: { displayName: "Owner tools" },
    plugins: [{
      name: "other-tool",
      source: { source: "local", path: "./plugins/other-tool" },
      policy: { installation: "AVAILABLE", authentication: "ON_USE" },
      category: "Developer Tools"
    }]
  }, null, 2)}\n`;
  fs.writeFileSync(marketplacePath, original);
  const plan = installer.plan();
  const installed = installer.apply(plan, {
    confirmation: `APPLY ${plan.plan_hash}`
  });
  const merged = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
  assert.equal(merged.interface.displayName, "Owner tools");
  assert.deepEqual(merged.plugins.map((entry) => entry.name), [
    "other-tool",
    "supermemory"
  ]);
  installer.rollback(installed, {
    confirmation: `ROLLBACK ${installed.install_id}`
  });
  assert.equal(fs.readFileSync(marketplacePath, "utf8"), original);
});

test("rollback refuses to overwrite a target changed after install", (t) => {
  const { codexHome, installer } = fixture(t);
  const plan = installer.plan();
  const installed = installer.apply(plan, {
    confirmation: `APPLY ${plan.plan_hash}`
  });
  fs.writeFileSync(
    path.join(codexHome, "plugins", "supermemory", "operator-change.txt"),
    "preserve me\n"
  );
  assert.throws(() => installer.rollback(installed, {
    confirmation: `ROLLBACK ${installed.install_id}`
  }), (error) => error.code === "install_rollback_target_changed");
});
