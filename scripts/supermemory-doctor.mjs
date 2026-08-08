#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  inspectCodexDesktopHost,
  inspectCodexHooksFeatureFlag,
  inspectLegacyCodexHooks
} from "./lib/codex-desktop-deployment.mjs";
import { createProjectRegistry } from "./lib/project-registry.mjs";

function parseArgs(argv) {
  const options = { json: false, codex: false };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--codex") options.codex = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function loopbackHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function commandCheck(spawnSyncImpl, command, args, id) {
  const result = spawnSyncImpl(command, args, { encoding: "utf8" });
  return {
    id,
    ok: result.status === 0,
    detail: result.status === 0
      ? (result.stdout || "").trim().split(/\r?\n/)[0] || "available"
      : (result.stderr || result.stdout || `${command} unavailable`).trim().slice(0, 240)
  };
}

async function fetchJson(fetchImpl, url, timeoutMs = 3_000, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    return { ok: false, status: null, data: null, error: error?.name || "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDoctor({
  env = process.env,
  fetchImpl = globalThis.fetch,
  spawnSyncImpl = spawnSync,
  codexDesktopInspectImpl = inspectCodexDesktopHost,
  cwd = process.cwd(),
  nodeVersion = process.versions.node,
  codex = false
} = {}) {
  const vaultRoot = path.resolve(cwd, env.SUPERMEMORY_VAULT_ROOT || "identity-vault");
  const backupsRoot = path.resolve(
    cwd,
    env.SUPERMEMORY_BACKUPS_ROOT || path.join(os.homedir(), ".supermemory", "backups")
  );
  const baseUrl = env.HINDSIGHT_BASE_URL || "http://127.0.0.1:8888";
  const ollamaUrl = env.SUPERMEMORY_OLLAMA_URL || "http://127.0.0.1:11434";
  const model = env.HINDSIGHT_OLLAMA_MODEL || "llama3:latest";
  const checks = [];

  const major = Number.parseInt(String(nodeVersion).split(".")[0], 10);
  checks.push({
    id: "node",
    ok: Number.isInteger(major) && major >= 18,
    detail: `Node ${nodeVersion}`
  });

  for (const dependency of ["mammoth", "pdfjs-dist"]) {
    const packagePath = path.join(cwd, "node_modules", dependency, "package.json");
    checks.push({
      id: `dependency_${dependency}`,
      ok: fs.existsSync(packagePath),
      detail: fs.existsSync(packagePath) ? "installed" : "run npm ci --ignore-scripts"
    });
  }

  let vaultOk = false;
  let vaultDetail = vaultRoot;
  try {
    fs.mkdirSync(vaultRoot, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(vaultRoot);
    vaultOk = stat.isDirectory() && !stat.isSymbolicLink();
    if (vaultOk) fs.accessSync(vaultRoot, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    vaultDetail = `${vaultRoot}: ${error.code || error.message}`;
  }
  checks.push({ id: "vault", ok: vaultOk, detail: vaultDetail });

  let backupsOk = !isInside(vaultRoot, backupsRoot);
  let backupsDetail = backupsRoot;
  if (backupsOk) {
    try {
      fs.mkdirSync(backupsRoot, { recursive: true, mode: 0o700 });
      const stat = fs.lstatSync(backupsRoot);
      backupsOk = stat.isDirectory() && !stat.isSymbolicLink();
      if (backupsOk) fs.accessSync(backupsRoot, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      backupsOk = false;
      backupsDetail = `${backupsRoot}: ${error.code || error.message}`;
    }
  } else {
    backupsDetail = `${backupsRoot}: must be outside the canonical vault`;
  }
  checks.push({ id: "backups", ok: backupsOk, detail: backupsDetail });

  checks.push({
    id: "hindsight_loopback",
    ok: loopbackHttpUrl(baseUrl),
    detail: baseUrl
  });
  const ollamaLoopback = loopbackHttpUrl(ollamaUrl);
  checks.push({
    id: "ollama_loopback",
    ok: ollamaLoopback,
    detail: ollamaUrl
  });
  checks.push(commandCheck(spawnSyncImpl, "docker", ["version", "--format", "{{.Server.Version}}"], "docker"));
  checks.push(commandCheck(spawnSyncImpl, "ollama", ["--version"], "ollama"));

  const ollama = ollamaLoopback
    ? await fetchJson(fetchImpl, `${ollamaUrl}/api/tags`)
    : { ok: false, data: null };
  const models = ollama.data?.models ?? [];
  checks.push({
    id: "ollama_model",
    ok: ollama.ok && models.some((item) => item.name === model || item.model === model),
    detail: ollama.ok
      ? models.some((item) => item.name === model || item.model === model)
        ? `${model} installed`
        : `${model} missing; install it explicitly with: ollama pull ${model}`
      : `Ollama unavailable at ${ollamaUrl}`
  });

  const hindsight = await fetchJson(fetchImpl, `${baseUrl.replace(/\/+$/, "")}/health`);
  checks.push({
    id: "hindsight",
    ok: hindsight.ok && hindsight.data?.status === "healthy",
    detail: hindsight.ok ? JSON.stringify(hindsight.data) : `unavailable at ${baseUrl}`
  });

  let codexReport = null;
  if (codex) {
    const codexVersion = commandCheck(spawnSyncImpl, "codex", ["--version"], "codex_cli");
    checks.push(codexVersion);
    const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
    const desktopExecutable = path.resolve(
      env.SUPERMEMORY_CODEX_DESKTOP_EXECUTABLE ||
      (fs.existsSync("/Applications/ChatGPT.app/Contents/Resources/codex")
        ? "/Applications/ChatGPT.app/Contents/Resources/codex"
        : "/Applications/Codex.app/Contents/Resources/codex")
    );
    const desktopVersion = commandCheck(
      spawnSyncImpl,
      desktopExecutable,
      ["--version"],
      "codex_desktop_runtime"
    );
    checks.push(desktopVersion);
    let binding = { status: "unbound" };
    try {
      binding = createProjectRegistry({ vaultRoot }).status(cwd);
    } catch (error) {
      binding = { status: error?.code ?? "unbound" };
    }
    checks.push({
      id: "codex_project_binding",
      ok: binding.status === "bound",
      detail: binding.status
    });
    const pluginRoot = path.resolve(
      env.SUPERMEMORY_CODEX_PLUGIN_ROOT || path.join(cwd, "plugins", "supermemory")
    );
    const pluginFiles = [
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      path.join(pluginRoot, "hooks", "hooks.json"),
      path.join(pluginRoot, ".mcp.json")
    ];
    checks.push({
      id: "codex_plugin",
      ok: pluginFiles.every((file) => fs.existsSync(file)),
      detail: pluginFiles.every((file) => fs.existsSync(file)) ? "packaged" : "missing"
    });
    const marketplacePath = path.join(cwd, ".agents", "plugins", "marketplace.json");
    let marketplaceConfigured = false;
    try {
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
      marketplaceConfigured = marketplace.plugins?.some((entry) => (
        entry?.name === "supermemory" &&
        entry?.source?.source === "local" &&
        entry?.source?.path === "./plugins/supermemory"
      ));
    } catch {
      marketplaceConfigured = false;
    }
    checks.push({
      id: "codex_marketplace",
      ok: marketplaceConfigured,
      detail: marketplaceConfigured ? "supermemory_discoverable" : "missing_or_invalid"
    });
    const configPath = path.join(codexHome, "config.toml");
    let legacyHooks = 0;
    let legacyHookInspection = "none";
    try {
      const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
      const inspected = inspectLegacyCodexHooks(configText);
      legacyHooks = inspected.legacy_hook_count;
      legacyHookInspection = legacyHooks === 0
        ? "none"
        : `${legacyHooks} legacy Codex hook(s) active`;
    } catch (error) {
      legacyHooks = -1;
      legacyHookInspection = error?.code ?? "legacy_hook_inspection_failed";
    }
    checks.push({
      id: "codex_legacy_hooks",
      ok: legacyHooks === 0,
      detail: legacyHookInspection
    });
    let hooksFeature;
    try {
      hooksFeature = inspectCodexHooksFeatureFlag(
        fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : ""
      );
      checks.push({
        id: "codex_hooks_feature",
        ok: hooksFeature.canonical_enabled && hooksFeature.deprecated_alias_count === 0,
        detail: hooksFeature.canonical_enabled && hooksFeature.deprecated_alias_count === 0
          ? "canonical_enabled"
          : (hooksFeature.deprecated_alias_count > 0
            ? "deprecated_codex_hooks_alias"
            : "canonical_hooks_disabled")
      });
    } catch (error) {
      checks.push({
        id: "codex_hooks_feature",
        ok: false,
        detail: error?.code ?? "hooks_feature_inspection_failed"
      });
    }
    const keyPath = env.SUPERMEMORY_CODEX_KEY_FILE;
    const keySecure = !keyPath || (() => {
      try {
        const stat = fs.lstatSync(path.resolve(keyPath));
        return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0;
      } catch {
        return false;
      }
    })();
    checks.push({
      id: "codex_key_store",
      ok: keySecure,
      detail: keyPath ? (keySecure ? "configured_securely" : "insecure") : "not_configured"
    });
    const nativeMemoriesEnabled = fs.existsSync(configPath) &&
      /memories\s*=\s*true/i.test(fs.readFileSync(configPath, "utf8"));
    checks.push({
      id: "codex_native_memories",
      ok: true,
      detail: nativeMemoriesEnabled
        ? "parallel_non_governed_source_enabled"
        : "disabled_or_not_detected"
    });
    const appServerConfigPath = path.join(
      cwd,
      ".codex",
      "supermemory",
      "app-server-runtime.json"
    );
    const appServerConfigured = (() => {
      try {
        const stat = fs.lstatSync(appServerConfigPath);
        if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
          return false;
        }
        return JSON.parse(fs.readFileSync(appServerConfigPath, "utf8"))?.schema ===
          "supermemory.app-server-runtime.v1";
      } catch {
        return false;
      }
    })();
    const runtimeFiles = [
      path.join(codexHome, "plugin-data", "supermemory", "supermemory-plugin.json"),
      path.join(cwd, ".codex", "supermemory", "hook-runtime.json"),
      path.join(cwd, ".codex", "supermemory", "mcp-runtime.json")
    ];
    const runtimeConfigured = runtimeFiles.every((file) => {
      try {
        const stat = fs.lstatSync(file);
        return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0;
      } catch {
        return false;
      }
    });
    checks.push({
      id: "codex_plugin_runtime",
      ok: runtimeConfigured,
      detail: runtimeConfigured ? "configured_securely" : "missing_or_insecure"
    });
    let desktopObserved = null;
    try {
      desktopObserved = await codexDesktopInspectImpl({
        codexExecutable: desktopExecutable,
        cwd,
        codexHome
      });
    } catch (error) {
      desktopObserved = {
        error: error?.code ?? "codex_app_server_unavailable",
        plugin: { found: false, installed: false, enabled: false },
        hooks: { count: 0, trusted: false, statuses: [], events: [] }
      };
    }
    const pluginActive = Boolean(
      desktopObserved.plugin?.installed && desktopObserved.plugin?.enabled
    );
    const pluginHooksTrusted = Boolean(
      pluginActive &&
      desktopObserved.hooks?.count > 0 &&
      desktopObserved.hooks?.trusted
    );
    checks.push({
      id: "codex_plugin_installed",
      ok: pluginActive,
      detail: pluginActive ? "installed_enabled" : "not_installed_or_disabled"
    });
    checks.push({
      id: "codex_plugin_hooks_trusted",
      ok: pluginHooksTrusted,
      detail: pluginHooksTrusted
        ? "trusted"
        : desktopObserved.hooks?.statuses?.join(",") || "not_observed"
    });
    const launchAgentPath = path.resolve(
      env.SUPERMEMORY_CODEX_LAUNCH_AGENT ||
      path.join(os.homedir(), "Library", "LaunchAgents", "com.supermemory.codex-daemon.plist")
    );
    const launchAgentLabel = env.SUPERMEMORY_CODEX_LAUNCH_AGENT_LABEL ||
      "com.supermemory.codex-daemon";
    const launchAgentFile = fs.existsSync(launchAgentPath);
    const launchAgentLoaded = spawnSyncImpl(
      "launchctl",
      ["print", `gui/${typeof process.getuid === "function" ? process.getuid() : 0}/${launchAgentLabel}`],
      { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] }
    ).status === 0;
    checks.push({
      id: "codex_launch_agent",
      ok: launchAgentFile && launchAgentLoaded,
      detail: launchAgentFile && launchAgentLoaded ? "loaded" : "missing_or_unloaded"
    });
    const daemonEndpoint = env.SUPERMEMORY_CODEX_DAEMON_ENDPOINT ||
      "http://127.0.0.1:8765";
    const tokenPath = env.SUPERMEMORY_CODEX_TOKEN_FILE;
    let daemonReady = false;
    let daemonCompiler = null;
    let daemonSpoolReplay = null;
    let workingMemoryRoundTrip = null;
    let daemonTokenMode = null;
    if (loopbackHttpUrl(daemonEndpoint) && tokenPath) {
      try {
        const stat = fs.lstatSync(path.resolve(tokenPath));
        if (stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0) {
          const token = fs.readFileSync(path.resolve(tokenPath), "utf8").trim();
          if (Buffer.byteLength(token, "utf8") >= 32) {
            daemonTokenMode = "0600_regular_file_bearer";
            const headers = { authorization: `Bearer ${token}` };
            const daemon = await fetchJson(
              fetchImpl,
              `${daemonEndpoint.replace(/\/+$/, "")}/health`,
              3_000,
              { headers }
            );
            daemonReady = daemon.ok && daemon.data?.status === "ready";
            daemonCompiler = daemon.data?.compiler ?? null;
            daemonSpoolReplay = daemon.data?.spool_replay ?? null;
            if (daemonReady && binding.status === "bound") {
              const memoryStatus = await fetchJson(
                fetchImpl,
                `${daemonEndpoint.replace(/\/+$/, "")}/v1/memory/status`,
                3_000,
                { headers }
              );
              workingMemoryRoundTrip = memoryStatus.ok && memoryStatus.data?.ok === true &&
                memoryStatus.data?.working_recall === true &&
                memoryStatus.data?.workspace_id === binding.workspaceId &&
                memoryStatus.data?.project_id === binding.projectId
                ? "authenticated_scope_bound"
                : null;
            }
          }
        }
      } catch {
        daemonReady = false;
      }
    }
    checks.push({
      id: "codex_daemon",
      ok: daemonReady,
      detail: daemonReady ? "ready_loopback_authenticated" : "unavailable_or_unconfigured"
    });
    const workingMemoryReady = daemonReady && workingMemoryRoundTrip === "authenticated_scope_bound";
    checks.push({
      id: "codex_working_memory_round_trip",
      ok: workingMemoryReady,
      detail: workingMemoryReady
        ? `${workingMemoryRoundTrip}; token=${daemonTokenMode}`
        : "authenticated_scope_bound_round_trip_failed"
    });
    const compilerReady = Boolean(
      daemonReady &&
      daemonCompiler?.status === "ready" &&
      Number(daemonCompiler?.retryable ?? 0) === 0
    );
    checks.push({
      id: "codex_memory_compiler",
      ok: compilerReady,
      detail: compilerReady
        ? `ready model=${daemonCompiler.model ?? model} compiled=${Number(daemonCompiler.compiled ?? 0)} pending=${Number(daemonCompiler.pending ?? 0)}`
        : daemonReady
          ? `degraded_or_missing retryable=${Number(daemonCompiler?.retryable ?? 0)}`
          : "daemon_unavailable"
    });
    const spoolReplayReady = Boolean(
      daemonReady &&
      daemonSpoolReplay?.status === "complete" &&
      Number(daemonSpoolReplay?.failed ?? 0) === 0
    );
    checks.push({
      id: "codex_spool_replay",
      ok: spoolReplayReady,
      detail: spoolReplayReady
        ? `complete replayed=${Number(daemonSpoolReplay.replayed ?? 0)} retained=${Number(daemonSpoolReplay.retained ?? 0)}`
        : daemonSpoolReplay?.status ?? "missing"
    });
    const appServerAvailable = desktopVersion.ok;
    codexReport = {
      project_binding: binding.status,
      project_id: binding.projectId ?? null,
      workspace_id: binding.workspaceId ?? null,
      capture_adapter: pluginHooksTrusted ? "hooks" : pluginActive ? "hooks_untrusted" : "none",
      capture_coverage: pluginHooksTrusted ? "partial" : "none",
      cli_version: codexVersion.ok ? codexVersion.detail : null,
      desktop_version: desktopVersion.ok ? desktopVersion.detail : null,
      app_server_available: appServerAvailable,
      app_server_configured: appServerConfigured,
      app_server_observed: !desktopObserved.error,
      app_server_status: !appServerAvailable
        ? "unavailable"
        : desktopObserved.error
          ? "available_inspection_failed"
          : appServerConfigured
            ? "configured_observed"
            : "observed_not_configured",
      plugin_installed: pluginActive,
      plugin_hooks_trusted: pluginHooksTrusted,
      plugin_hook_statuses: desktopObserved.hooks?.statuses ?? [],
      legacy_codex_hook_count: legacyHooks,
      launch_agent_loaded: launchAgentLoaded,
      daemon_ready: daemonReady,
      daemon_token_mode: daemonTokenMode,
      working_memory_round_trip: workingMemoryRoundTrip,
      memory_compiler: daemonCompiler,
      spool_replay: daemonSpoolReplay,
      mcp: pluginActive && fs.existsSync(pluginFiles[2]) ? "installed" : "misconfigured",
      marketplace: marketplaceConfigured ? "discoverable" : "misconfigured",
      duplicate_hook_count: legacyHooks > 0 ? legacyHooks : 0,
      native_memories_enabled: nativeMemoriesEnabled,
      native_memories_authoritative: false,
      cloud_web_coverage: "none",
      remote_host_coverage: "requires_separate_host_install"
    };
  }

  const blockers = checks.filter((check) => !check.ok);
  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    ready: blockers.length === 0,
    mode: "local-product-doctor",
    remoteCallsAllowed: false,
    modelDownloaded: false,
    vaultRoot,
    backupsRoot,
    hindsightBaseUrl: baseUrl,
    ollamaModel: model,
    codex: codexReport,
    checks,
    blockers: blockers.map((check) => ({
      code: check.id,
      action: check.detail
    }))
  };
}

function printText(report) {
  process.stdout.write(`${report.ready ? "READY" : "BLOCKED"} SuperMemory local doctor\n`);
  for (const check of report.checks) {
    process.stdout.write(`${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.detail}\n`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node scripts/supermemory-doctor.mjs [--json] [--codex]\n");
    } else {
      const report = await runDoctor({ codex: options.codex });
      if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else printText(report);
      if (!report.ready) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
