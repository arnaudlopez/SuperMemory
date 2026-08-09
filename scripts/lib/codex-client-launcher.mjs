import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson } from "./codex-redaction.mjs";
import { probeCodexCapabilities } from "./codex-capability-probe.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function treeHash(root) {
  const entries = [];
  const walk = (directory, prefix = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.join(prefix, entry.name).split(path.sep).join("/");
      if (entry.isSymbolicLink()) fail("client_source_symlink");
      if (entry.isDirectory()) walk(target, relative);
      else if (entry.isFile()) entries.push({
        path: relative,
        hash: crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")
      });
    }
  };
  walk(root);
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(entries)).digest("hex")}`;
}

function planDigest(plan) {
  const value = structuredClone(plan);
  delete value.plan_hash;
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
  fs.chmodSync(filePath, 0o600);
}

export function planStableCodexClient({
  repositoryRoot,
  clientRoot = path.join(os.homedir(), ".supermemory", "client"),
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  executable = "codex"
} = {}) {
  const repository = fs.realpathSync(path.resolve(repositoryRoot));
  const sourceHash = treeHash(path.join(repository, "scripts"));
  const capability = probeCodexCapabilities({ executable });
  const plan = {
    schema: "supermemory.codex-client-install-plan.v1",
    repository_root: repository,
    source_hash: sourceHash,
    client_root: path.resolve(clientRoot),
    codex_home: path.resolve(codexHome),
    plugin_data_file: path.join(path.resolve(codexHome), "plugin-data", "supermemory", "supermemory-plugin.json"),
    marketplace_root: repository,
    plugin_id: "supermemory@supermemory-local",
    capability
  };
  plan.plan_hash = planDigest(plan);
  return plan;
}

export function applyStableCodexClient({ plan, expectedPlanHash } = {}) {
  if (
    plan?.schema !== "supermemory.codex-client-install-plan.v1" ||
    plan.plan_hash !== expectedPlanHash || planDigest(plan) !== expectedPlanHash ||
    treeHash(path.join(plan.repository_root, "scripts")) !== plan.source_hash
  ) fail("client_install_plan_invalid");
  const runtime = path.join(plan.client_root, "runtime");
  const backup = path.join(plan.client_root, "backups", plan.plan_hash.slice(7, 23));
  if (fs.existsSync(backup)) fail("client_install_backup_exists");
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  if (fs.existsSync(runtime)) fs.cpSync(runtime, path.join(backup, "runtime"), { recursive: true });
  const pluginBackup = path.join(backup, "plugin-runtime.json");
  const hadPluginData = fs.existsSync(plan.plugin_data_file);
  if (hadPluginData) fs.copyFileSync(plan.plugin_data_file, pluginBackup);
  try {
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
    fs.cpSync(path.join(plan.repository_root, "scripts"), path.join(runtime, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(runtime, "deploy", "hindsight"), { recursive: true, mode: 0o700 });
    fs.copyFileSync(
      path.join(plan.repository_root, "deploy", "hindsight", "ontology-retrieval-corpus.v1.json"),
      path.join(runtime, "deploy", "hindsight", "ontology-retrieval-corpus.v1.json")
    );
    atomicJson(plan.plugin_data_file, {
      schema: "supermemory.plugin-runtime.v1",
      scope_mode: "dynamic_cwd",
      node: process.execPath,
      hook_script: path.join(runtime, "scripts", "supermemory-hook.mjs"),
      mcp_script: path.join(runtime, "scripts", "supermemory-mcp.mjs"),
      timeout_ms: 750
    });
    const executable = plan.capability.executable;
    if (!executable) fail("codex_unavailable");
    if (!plan.capability.marketplace_installed) {
      const added = spawnSync(executable, ["plugin", "marketplace", "add", plan.marketplace_root], { encoding: "utf8" });
      if (added.status !== 0) fail("codex_marketplace_install_failed");
    }
    const refreshed = probeCodexCapabilities({ executable });
    if (!refreshed.supermemory_installed) {
      const installed = spawnSync(executable, ["plugin", "add", plan.plugin_id], { encoding: "utf8" });
      if (installed.status !== 0) fail("codex_plugin_install_failed");
    }
    const finalCapability = probeCodexCapabilities({ executable });
    if (!finalCapability.supermemory_installed) fail("codex_plugin_install_failed");
    return {
      schema: "supermemory.codex-client-installation.v1",
      status: "installed",
      plan_hash: plan.plan_hash,
      runtime_root: runtime,
      plugin_data_file: plan.plugin_data_file,
      backup,
      capability: finalCapability,
      hooks_trust: "owner_review_required",
      new_session_required: true
    };
  } catch (error) {
    fs.rmSync(runtime, { recursive: true, force: true });
    const runtimeBackup = path.join(backup, "runtime");
    if (fs.existsSync(runtimeBackup)) fs.cpSync(runtimeBackup, runtime, { recursive: true });
    if (hadPluginData) {
      fs.mkdirSync(path.dirname(plan.plugin_data_file), { recursive: true, mode: 0o700 });
      fs.copyFileSync(pluginBackup, plan.plugin_data_file);
      fs.chmodSync(plan.plugin_data_file, 0o600);
    } else {
      fs.rmSync(plan.plugin_data_file, { force: true });
    }
    throw error;
  }
}
