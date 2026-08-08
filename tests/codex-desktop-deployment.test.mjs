import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCodexDesktopDeployment,
  createSuperMemoryLaunchAgentPlist,
  inspectCodexHooksFeatureFlag,
  inspectLegacyCodexHooks,
  migrateCodexHooksFeatureFlag,
  removeLegacyCodexHooks
} from "../scripts/lib/codex-desktop-deployment.mjs";
import { createProjectRegistry } from "../scripts/lib/project-registry.mjs";

const pluginSource = path.resolve("plugins/supermemory");
const hookScript = path.resolve("scripts/supermemory-hook.mjs");
const mcpScript = path.resolve("scripts/supermemory-mcp.mjs");
const daemonScript = path.resolve("scripts/supermemoryd.mjs");

const LEGACY_CONFIG = [
  'model = "gpt-test"',
  "",
  "[features]",
  "codex_hooks = true",
  "",
  "[[hooks.SessionStart]]",
  'matcher = "startup|resume"',
  "",
  "[[hooks.SessionStart.hooks]]",
  'type = "command"',
  'command = "/usr/bin/node /opt/claude-memory-compiler/session-start.js"',
  "timeout = 3",
  "",
  "[[hooks.Stop]]",
  "",
  "[[hooks.Stop.hooks]]",
  'type = "command"',
  "command = '/usr/bin/node /opt/claude-memory-compiler/stop.js'",
  "",
  "[hooks.state]",
  "",
  '[hooks.state."/tmp/config.toml:session_start:0:0"]',
  'trusted_hash = "legacy-start"',
  "",
  '[hooks.state."/tmp/config.toml:stop:0:0"]',
  'trusted_hash = "legacy-stop"',
  "",
  "[[hooks.PreToolUse]]",
  'matcher = "Bash"',
  "",
  "[[hooks.PreToolUse.hooks]]",
  'type = "command"',
  'command = "/usr/bin/python3 /opt/policy/check.py"',
  "",
  "[mcp_servers.keep_me]",
  'command = "keep-me"',
  ""
].join("\n");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-desktop-deploy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex-home");
  const project = path.join(root, "project");
  const vault = path.join(root, "vault");
  const runtime = path.join(root, "private-runtime");
  const installBackups = path.join(root, "install-backups");
  const desktopBackups = path.join(root, "desktop-backups");
  const launchAgent = path.join(root, "Library", "LaunchAgents", "com.supermemory.codex-daemon.plist");
  for (const directory of [codexHome, project, vault]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), LEGACY_CONFIG, { mode: 0o600 });
  const productRoot = path.join(vault, "00_inbox", "supermemory-product");
  fs.mkdirSync(productRoot, { recursive: true });
  fs.writeFileSync(path.join(productRoot, "state.json"), `${JSON.stringify({
    version: 1,
    workspace: { workspaceId: "workspace:local", displayName: "Legacy fixture" }
  })}\n`);
  let plugin = {
    found: true,
    installed: false,
    enabled: false,
    plugin_id: "supermemory@fixture",
    marketplace: "fixture",
    install_policy: "INSTALLED_BY_DEFAULT"
  };
  const hooks = () => ({
    count: plugin.installed ? 7 : 0,
    trusted: false,
    statuses: plugin.installed ? ["untrusted"] : [],
    events: plugin.installed ? ["sessionStart", "stop", "userPromptSubmit"] : [],
    definition_hashes: plugin.installed ? ["sha256:fixture"] : []
  });
  const appServerController = {
    async inspect() {
      return { plugin: { ...plugin }, hooks: hooks() };
    },
    async install() {
      const before = { ...plugin };
      plugin = { ...plugin, installed: true, enabled: true };
      return { before, plugin: { ...plugin }, hooks: hooks() };
    },
    async uninstall(pluginId) {
      assert.equal(pluginId, plugin.plugin_id);
      plugin = { ...plugin, installed: false, enabled: false };
      return { plugin: { ...plugin } };
    }
  };
  let loaded = false;
  const launchctlController = {
    status() {
      return { loaded };
    },
    install() {
      loaded = true;
      return { loaded: true };
    },
    uninstall() {
      loaded = false;
      return { loaded: false };
    }
  };
  const deployment = createCodexDesktopDeployment({
    codexHome,
    projectRoot: project,
    pluginSource,
    vaultRoot: vault,
    runtimeRoot: runtime,
    keyFile: path.join(runtime, "archive.key"),
    tokenFile: path.join(runtime, "daemon.token"),
    hookScript,
    mcpScript,
    daemonScript,
    nodePath: process.execPath,
    codexExecutable: path.join(root, "ChatGPT.app", "codex"),
    installBackupsRoot: installBackups,
    desktopBackupsRoot: desktopBackups,
    launchAgentPath: launchAgent,
    daemonEndpoint: "http://127.0.0.1:8765",
    projectName: "Fixture",
    adoptLegacyWorkspace: true,
    appServerController,
    launchctlController,
    daemonHealth: async () => ({ ready: true }),
    spawnSyncImpl: () => ({
      status: 0,
      stdout: "codex-cli 0.146.0-alpha.fixture\n",
      stderr: ""
    }),
    clock: () => "2026-07-25T12:00:00.000Z"
  });
  return {
    root,
    codexHome,
    project,
    vault,
    runtime,
    desktopBackups,
    launchAgent,
    deployment,
    pluginState: () => ({ ...plugin }),
    serviceState: () => loaded
  };
}

test("legacy hook cutover is structural and preserves unrelated config byte content", () => {
  const inspected = inspectLegacyCodexHooks(LEGACY_CONFIG);
  assert.equal(inspected.legacy_hook_count, 2);
  assert.deepEqual(inspected.events, ["SessionStart", "Stop"]);
  assert.equal(inspected.legacy_state_count, 2);
  const cutover = removeLegacyCodexHooks(LEGACY_CONFIG);
  assert.equal(cutover.changed, true);
  assert.equal(cutover.text.includes("claude-memory-compiler"), false);
  assert.equal(cutover.text.includes("legacy-start"), false);
  assert.equal(cutover.text.includes("/opt/policy/check.py"), true);
  assert.equal(cutover.text.includes('[mcp_servers.keep_me]'), true);
  assert.equal(inspectLegacyCodexHooks(cutover.text).legacy_hook_count, 0);
});

test("deprecated hooks feature migration is structural and preserves unrelated bytes", () => {
  const migrated = migrateCodexHooksFeatureFlag(LEGACY_CONFIG);
  assert.equal(migrated.changed, true);
  assert.equal(migrated.text.includes("codex_hooks ="), false);
  assert.equal(migrated.text.includes("hooks = true"), true);
  assert.equal(migrated.text.includes("/opt/policy/check.py"), true);
  const inspected = inspectCodexHooksFeatureFlag(migrated.text);
  assert.equal(inspected.canonical_enabled, true);
  assert.equal(inspected.deprecated_alias_count, 0);

  const withBoth = [
    "[features]",
    "codex_hooks = true # old",
    "hooks = true # canonical",
    "",
    "[mcp_servers.keep]",
    'command = "keep"'
  ].join("\r\n");
  const deduplicated = migrateCodexHooksFeatureFlag(withBoth);
  assert.equal(deduplicated.text.includes("codex_hooks"), false);
  assert.equal(deduplicated.text.includes("hooks = true # canonical"), true);
  assert.equal(deduplicated.text.includes("\r\n"), true);
  assert.equal(deduplicated.text.includes('[mcp_servers.keep]'), true);

  const added = migrateCodexHooksFeatureFlag('model = "gpt-test"\n');
  assert.match(added.text, /\[features\]\nhooks = true\n$/);
  assert.throws(
    () => migrateCodexHooksFeatureFlag(
      "[features]\ncodex_hooks = false\nhooks = true\n"
    ),
    (error) => error.code === "codex_hooks_feature_conflict"
  );
});

test("a mixed legacy and unrelated hook group fails closed", () => {
  const mixed = [
    "[[hooks.Stop]]",
    "[[hooks.Stop.hooks]]",
    'command = "/opt/claude-memory-compiler/stop.js"',
    "[[hooks.Stop.hooks]]",
    'command = "/opt/another-handler.js"'
  ].join("\n");
  assert.throws(
    () => inspectLegacyCodexHooks(mixed),
    (error) => error.code === "legacy_hook_group_mixed"
  );
});

test("LaunchAgent uses absolute paths, loopback and private log destinations", () => {
  const plist = createSuperMemoryLaunchAgentPlist({
    nodePath: "/usr/local/bin/node",
    daemonScript: "/opt/SuperMemory/scripts/supermemoryd.mjs",
    projectRoot: "/opt/SuperMemory",
    vaultRoot: "/opt/SuperMemory/identity-vault",
    keyFile: "/Users/test/.supermemory/archive.key",
    tokenFile: "/Users/test/.supermemory/daemon.token",
    runtimeRoot: "/Users/test/.supermemory/runtime",
    host: "127.0.0.1",
    port: 8765
  });
  assert.match(plist, /com\.supermemory\.codex-daemon/);
  assert.match(plist, /127\.0\.0\.1/);
  assert.match(plist, /--runtime-root/);
  assert.match(plist, /<integer>63<\/integer>/);
  assert.match(plist, /daemon\.stderr\.log/);
  assert.throws(() => createSuperMemoryLaunchAgentPlist({
    nodePath: "/usr/local/bin/node",
    daemonScript: "/tmp/daemon.mjs",
    projectRoot: "/tmp/project",
    vaultRoot: "/tmp/vault",
    keyFile: "/tmp/key",
    tokenFile: "/tmp/token",
    runtimeRoot: "/tmp/runtime",
    host: "0.0.0.0",
    port: 8765
  }), (error) => error.code === "launch_agent_host_not_loopback");
});

test("plan is read-only and apply requires the reviewed current state", async (t) => {
  const { codexHome, runtime, launchAgent, deployment } = fixture(t);
  const before = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const plan = await deployment.plan();
  assert.equal(plan.writes_performed, false);
  assert.equal(plan.ready_to_apply, true);
  assert.equal(plan.observed.legacy.hook_count, 2);
  assert.equal(plan.observed.codex_version, "codex-cli 0.146.0-alpha.fixture");
  assert.equal(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"), before);
  assert.equal(fs.existsSync(runtime), false);
  assert.equal(fs.existsSync(launchAgent), false);
  await assert.rejects(
    deployment.apply(plan, { confirmation: "DEPLOY wrong" }),
    (error) => error.code === "exact_confirmation_required"
  );
  fs.appendFileSync(path.join(codexHome, "config.toml"), "# drift\n");
  await assert.rejects(
    deployment.apply(plan, { confirmation: `DEPLOY ${plan.plan_hash}` }),
    (error) => error.code === "desktop_plan_stale"
  );
});

test("apply cuts over, binds, starts and activates; rollback restores profile and preserves vault", async (t) => {
  const {
    codexHome,
    project,
    vault,
    runtime,
    launchAgent,
    deployment,
    pluginState,
    serviceState
  } = fixture(t);
  const originalConfig = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const plan = await deployment.plan();
  const installed = await deployment.apply(plan, {
    confirmation: `DEPLOY ${plan.plan_hash}`
  });
  assert.equal(installed.status, "installed_trust_required");
  assert.equal(installed.legacy_codex_hooks_active, 0);
  assert.equal(installed.daemon_ready, true);
  assert.equal(pluginState().installed, true);
  assert.equal(serviceState(), true);
  assert.equal(fs.existsSync(launchAgent), true);
  assert.equal(fs.statSync(path.join(runtime, "archive.key")).mode & 0o077, 0);
  assert.equal(fs.statSync(path.join(runtime, "daemon.token")).mode & 0o077, 0);
  const activeConfig = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  assert.equal(activeConfig.includes("claude-memory-compiler"), false);
  assert.equal(activeConfig.includes("codex_hooks ="), false);
  assert.equal(inspectCodexHooksFeatureFlag(activeConfig).canonical_enabled, true);
  assert.equal(createProjectRegistry({ vaultRoot: vault }).status(project).status, "bound");

  const manifest = JSON.parse(fs.readFileSync(installed.manifest_path, "utf8"));
  const rolledBack = await deployment.rollback(manifest, {
    confirmation: manifest.rollback_confirmation
  });
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.profile_restored, true);
  assert.equal(rolledBack.vault_preserved, true);
  assert.equal(rolledBack.binding_preserved, true);
  assert.equal(rolledBack.runtime_safety_copy, true);
  assert.equal(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"), originalConfig);
  assert.equal(pluginState().installed, false);
  assert.equal(serviceState(), false);
  assert.equal(createProjectRegistry({ vaultRoot: vault }).status(project).status, "bound");
});

test("deployed profile hooks feature migration has a verified exact rollback", async (t) => {
  const { codexHome, deployment } = fixture(t);
  const originalConfig = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const plan = deployment.hooksFeaturePlan();
  assert.equal(plan.writes_performed, false);
  assert.equal(plan.ready_to_apply, true);
  assert.equal(plan.observed.hooks_feature.deprecated_alias_present, true);
  assert.equal(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"), originalConfig);

  const migrated = deployment.applyHooksFeatureMigration(plan, {
    confirmation: `MIGRATE ${plan.plan_hash}`
  });
  assert.equal(migrated.status, "migrated");
  assert.equal(migrated.backup_verified, true);
  const activeConfig = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  assert.equal(activeConfig.includes("codex_hooks ="), false);
  assert.equal(inspectCodexHooksFeatureFlag(activeConfig).canonical_enabled, true);

  const manifest = JSON.parse(fs.readFileSync(migrated.manifest_path, "utf8"));
  const rolledBack = deployment.rollbackHooksFeatureMigration(manifest, {
    confirmation: manifest.rollback_confirmation
  });
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.profile_restored, true);
  assert.equal(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"), originalConfig);
});

test("desktop rollback refuses to overwrite post-install profile drift", async (t) => {
  const { codexHome, deployment } = fixture(t);
  const plan = await deployment.plan();
  const installed = await deployment.apply(plan, {
    confirmation: `DEPLOY ${plan.plan_hash}`
  });
  const manifest = JSON.parse(fs.readFileSync(installed.manifest_path, "utf8"));
  fs.appendFileSync(path.join(codexHome, "config.toml"), "# operator change\n");
  await assert.rejects(
    deployment.rollback(manifest, { confirmation: manifest.rollback_confirmation }),
    (error) => error.code === "rollback_target_changed"
  );
});
