import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-redaction.mjs";
import { createDisabledCodexRuntimeV4, normalizeCodexRuntimeConfig } from "./codex-runtime-config.mjs";

export class CodexInstallerError extends Error {
  constructor(code) {
    super(code);
    this.name = "CodexInstallerError";
    this.code = code;
  }
}

function fail(code) {
  throw new CodexInstallerError(code);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function planHash(value) {
  const clone = structuredClone(value);
  delete clone.plan_hash;
  return digest(canonicalJson(clone));
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${canonicalJson(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function copyEntry(source, target) {
  if (
    fs.existsSync(source) &&
    fs.existsSync(target) &&
    fs.realpathSync(source) === fs.realpathSync(target)
  ) return;
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.cpSync(source, target, { recursive: true, dereference: false });
}

function entryFingerprint(target) {
  if (!fs.existsSync(target)) return { exists: false, type: null, sha256: null };
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) fail("install_target_symlink");
  if (stat.isFile()) {
    return {
      exists: true,
      type: "file",
      sha256: digest(fs.readFileSync(target)),
      mode: stat.mode & 0o777
    };
  }
  if (!stat.isDirectory()) fail("install_target_invalid");
  const entries = [];
  const walk = (directory, prefix = "") => {
    for (const name of fs.readdirSync(directory).sort()) {
      const current = path.join(directory, name);
      const relative = path.join(prefix, name).split(path.sep).join("/");
      const child = fs.lstatSync(current);
      if (child.isSymbolicLink()) fail("install_target_symlink");
      if (child.isDirectory()) {
        entries.push({ path: `${relative}/`, type: "directory", mode: child.mode & 0o777 });
        walk(current, relative);
      } else if (child.isFile()) {
        entries.push({
          path: relative,
          type: "file",
          mode: child.mode & 0o777,
          sha256: digest(fs.readFileSync(current))
        });
      } else {
        fail("install_target_invalid");
      }
    }
  };
  walk(target);
  return {
    exists: true,
    type: "directory",
    sha256: digest(canonicalJson(entries)),
    mode: stat.mode & 0o777
  };
}

function snapshotTarget(target, backupRoot, id) {
  const fingerprint = entryFingerprint(target);
  if (!fingerprint.exists) {
    return { id, existed: false, backup: null, fingerprint };
  }
  const backup = path.join(backupRoot, id);
  fs.cpSync(target, backup, { recursive: true, dereference: false });
  return { id, existed: true, backup: id, fingerprint };
}

function readMarketplace(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      name: "supermemory-local",
      interface: { displayName: "SuperMemory Local" },
      plugins: []
    };
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail("marketplace_invalid");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail("marketplace_invalid");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray(value.plugins)
  ) fail("marketplace_invalid");
  return value;
}

export function countConfiguredSuperMemoryHookCommands(configText) {
  const assignments = String(configText).matchAll(
    /^\s*(?:command|command_windows|commandWindows)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/gim
  );
  let count = 0;
  for (const match of assignments) {
    if (/supermemory/i.test(match[1] ?? match[2] ?? "")) count += 1;
  }
  return count;
}

function mergeMarketplace(filePath) {
  const marketplace = readMarketplace(filePath);
  const matches = marketplace.plugins.filter((entry) => entry?.name === "supermemory");
  if (matches.length > 1) fail("marketplace_duplicate_plugin");
  const expected = {
    name: "supermemory",
    source: { source: "local", path: "./plugins/supermemory" },
    policy: {
      installation: "INSTALLED_BY_DEFAULT",
      authentication: "ON_USE"
    },
    category: "Productivity"
  };
  if (matches.length === 1) {
    const existing = matches[0];
    if (
      existing?.source?.source !== "local" ||
      existing?.source?.path !== expected.source.path
    ) fail("marketplace_plugin_conflict");
    marketplace.plugins = marketplace.plugins.map((entry) => (
      entry?.name === "supermemory" ? expected : entry
    ));
  } else {
    marketplace.plugins.push(expected);
  }
  return marketplace;
}

export function createCodexInstaller({
  codexHome,
  projectRoot,
  pluginSource,
  vaultRoot,
  runtimeRoot,
  keyFile,
  tokenFile,
  hookScript,
  mcpScript,
  backupsRoot,
  daemonEndpoint = "http://127.0.0.1:8765",
  runtimeContract = null,
  nodePath = process.execPath,
  clock = () => new Date().toISOString()
} = {}) {
  const home = path.resolve(codexHome);
  const project = fs.realpathSync(path.resolve(projectRoot));
  const plugin = fs.realpathSync(path.resolve(pluginSource));
  const backupBase = path.resolve(backupsRoot);
  const pluginTarget = path.join(home, "plugins", "supermemory");
  const pluginData = path.join(home, "plugin-data", "supermemory");
  const projectData = path.join(project, ".codex", "supermemory");
  const projectPlugin = path.join(project, "plugins", "supermemory");
  const marketplace = path.join(project, ".agents", "plugins", "marketplace.json");
  for (const target of [pluginTarget, pluginData]) {
    if (!isInside(home, target)) fail("install_scope_invalid");
  }
  for (const target of [projectData, projectPlugin, marketplace]) {
    if (!isInside(project, target)) fail("install_scope_invalid");
  }
  let daemonUrl;
  try {
    daemonUrl = new URL(daemonEndpoint);
  } catch {
    fail("daemon_endpoint_invalid");
  }
  if (
    daemonUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(daemonUrl.hostname)
  ) fail("daemon_endpoint_invalid");
  const normalizedRuntimeContract = runtimeContract === null
    ? createDisabledCodexRuntimeV4()
    : normalizeCodexRuntimeConfig(runtimeContract);

  const buildPlan = () => {
    const userConfig = path.join(home, "config.toml");
    const projectConfig = path.join(project, ".codex", "config.toml");
    const configText = [userConfig, projectConfig]
      .filter((file) => fs.existsSync(file))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    const duplicateHookCount = countConfiguredSuperMemoryHookCommands(configText);
    const nativeEnabled = /memories\s*=\s*true/i.test(configText);
    const body = {
      schema: "supermemory.codex-install-plan.v1",
      generated_at: clock(),
      mode: "plan",
      writes_performed: false,
      scope_fingerprints: {
        codex_home: digest(home),
        project_root: digest(project),
        plugin_source: digest(plugin)
      },
      targets: ["plugin", "plugin_data", "project_data", "project_plugin", "marketplace"],
      runtime: {
        vault_root_fingerprint: digest(path.resolve(vaultRoot)),
        runtime_root_fingerprint: digest(path.resolve(runtimeRoot)),
        key_file_configured: Boolean(keyFile),
        token_file_configured: Boolean(tokenFile),
        daemon_endpoint_loopback: true
      },
      checks: {
        duplicate_hook_count: duplicateHookCount,
        native_memories_enabled: nativeEnabled,
        native_memories_authoritative: false,
        config_toml_will_be_modified: false,
        marketplace_will_be_merged: true,
        plugin_installed_by_default: true
      },
      warnings: [
        ...(duplicateHookCount > 0 ? ["existing_supermemory_configuration_review_required"] : []),
        ...(nativeEnabled ? ["codex_native_memories_are_parallel_and_not_governed"] : [])
      ]
    };
    return { ...body, plan_hash: planHash(body) };
  };

  const apply = (installPlan, { confirmation } = {}) => {
    if (planHash(installPlan) !== installPlan.plan_hash) fail("install_plan_tampered");
    if (confirmation !== `APPLY ${installPlan.plan_hash}`) fail("exact_confirmation_required");
    if (installPlan.checks.duplicate_hook_count > 0) fail("duplicate_hooks_detected");
    for (const file of [keyFile, tokenFile, hookScript, mcpScript]) {
      const stat = fs.lstatSync(path.resolve(file));
      if (stat.isSymbolicLink() || !stat.isFile()) fail("install_input_invalid");
      if ([keyFile, tokenFile].includes(file) && (stat.mode & 0o077) !== 0) {
        fail("install_secret_insecure");
      }
    }
    const installId = `install_${installPlan.plan_hash.slice("sha256:".length, 32)}`;
    const backupRoot = path.join(backupBase, installId);
    if (fs.existsSync(backupRoot)) fail("install_backup_exists");
    fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
    const backups = [
      snapshotTarget(pluginTarget, backupRoot, "plugin"),
      snapshotTarget(pluginData, backupRoot, "plugin-data"),
      snapshotTarget(projectData, backupRoot, "project-data"),
      ...(path.resolve(plugin) === path.resolve(projectPlugin)
        ? []
        : [snapshotTarget(projectPlugin, backupRoot, "project-plugin")]),
      snapshotTarget(marketplace, backupRoot, "marketplace")
    ];
    const targets = {
      plugin: pluginTarget,
      "plugin-data": pluginData,
      "project-data": projectData,
      "project-plugin": projectPlugin,
      marketplace
    };
    const restore = () => {
      for (const entry of [...backups].reverse()) {
        const target = targets[entry.id];
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        if (entry.existed) {
          copyEntry(path.join(backupRoot, entry.backup), target);
        }
      }
    };
    try {
      copyEntry(plugin, pluginTarget);
      copyEntry(plugin, projectPlugin);
      fs.mkdirSync(pluginData, { recursive: true, mode: 0o700 });
      fs.mkdirSync(projectData, { recursive: true, mode: 0o700 });
      const hookRuntime = path.join(projectData, "hook-runtime.json");
      const mcpRuntime = path.join(projectData, "mcp-runtime.json");
      const appServerRuntime = path.join(projectData, "app-server-runtime.json");
      const runtimeContractPath = path.join(projectData, "runtime-contract.json");
      atomicJson(runtimeContractPath, normalizedRuntimeContract);
      atomicJson(hookRuntime, {
        schema: "supermemory.hook-runtime.v1",
        vault_root: path.resolve(vaultRoot),
        runtime_root: path.resolve(runtimeRoot),
        daemon_endpoint: daemonUrl.toString().replace(/\/+$/, ""),
        key_file: path.resolve(keyFile),
        token_file: path.resolve(tokenFile),
        capture_mode: "hooks_primary",
        runtime_contract_file: runtimeContractPath,
        working_memory: normalizedRuntimeContract.working_memory
      });
      atomicJson(mcpRuntime, {
        schema: "supermemory.mcp-runtime.v1",
        vault_root: path.resolve(vaultRoot),
        hindsight_base_url: "http://127.0.0.1:8888",
        max_results: 10,
        runtime_contract_file: runtimeContractPath,
        daemon_endpoint: daemonUrl.toString().replace(/\/+$/, ""),
        daemon_token_file: path.resolve(tokenFile)
      });
      atomicJson(appServerRuntime, {
        schema: "supermemory.app-server-runtime.v1",
        vault_root: path.resolve(vaultRoot),
        project_root: project,
        key_file: path.resolve(keyFile),
        hindsight_base_url: "http://127.0.0.1:8888",
        capture_mode: "app_server_primary",
        runtime_contract_file: runtimeContractPath,
        working_memory: normalizedRuntimeContract.working_memory
      });
      atomicJson(path.join(pluginData, "supermemory-plugin.json"), {
        schema: "supermemory.plugin-runtime.v1",
        scope_mode: normalizedRuntimeContract.schema === "supermemory.codex-runtime.v6"
          ? "dynamic_cwd"
          : "fixed_project",
        node: nodePath,
        hook_script: path.resolve(hookScript),
        runtime_config: hookRuntime,
        mcp_script: path.resolve(mcpScript),
        mcp_runtime_config: mcpRuntime,
        timeout_ms: 750
      });
      atomicJson(marketplace, mergeMarketplace(marketplace));
      const postApplyFingerprints = Object.fromEntries(
        backups.map((entry) => [entry.id, entryFingerprint(targets[entry.id])])
      );
      const manifest = {
        schema: "supermemory.codex-installation.v1",
        install_id: installId,
        applied_at: clock(),
        plan_hash: installPlan.plan_hash,
        backups,
        post_apply_fingerprints: postApplyFingerprints,
        config_toml_modified: false,
        marketplace_merged: true,
        plugin_installed_by_default: true,
        app_server_configured_not_observed: true,
        runtime_contract_schema: normalizedRuntimeContract.schema,
        runtime_activation: normalizedRuntimeContract.deployment.activation,
        native_memories_authoritative: false,
        rollback_confirmation: `ROLLBACK ${installId}`
      };
      atomicJson(path.join(backupRoot, "manifest.json"), manifest);
      return { ...manifest, status: "installed", backup_verified: true };
    } catch (error) {
      restore();
      throw error;
    }
  };

  const rollback = (manifest, { confirmation } = {}) => {
    if (manifest?.schema !== "supermemory.codex-installation.v1") {
      fail("install_manifest_invalid");
    }
    if (confirmation !== `ROLLBACK ${manifest.install_id}`) fail("exact_confirmation_required");
    const targets = {
      plugin: pluginTarget,
      "plugin-data": pluginData,
      "project-data": projectData,
      "project-plugin": projectPlugin,
      marketplace
    };
    for (const entry of manifest.backups) {
      if (entry.existed) {
        const backup = path.join(backupBase, manifest.install_id, entry.backup);
        if (
          canonicalJson(entryFingerprint(backup)) !== canonicalJson(entry.fingerprint)
        ) fail("install_backup_tampered");
      }
      const expected = manifest.post_apply_fingerprints?.[entry.id];
      if (
        expected &&
        canonicalJson(entryFingerprint(targets[entry.id])) !== canonicalJson(expected)
      ) fail("install_rollback_target_changed");
    }
    for (const entry of manifest.backups) {
      const target = targets[entry.id];
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      if (entry.existed) {
        copyEntry(path.join(backupBase, manifest.install_id, entry.backup), target);
      }
    }
    return {
      status: "rolled_back",
      install_id: manifest.install_id,
      vault_preserved: fs.existsSync(path.resolve(vaultRoot)),
      dual_capture_enabled: false,
      restored_targets: manifest.backups.filter((entry) => entry.existed).length
    };
  };

  return { plan: buildPlan, apply, rollback };
}
