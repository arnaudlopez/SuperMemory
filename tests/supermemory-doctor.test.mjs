import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "../scripts/supermemory-doctor.mjs";
import { createProjectRegistry } from "../scripts/lib/project-registry.mjs";

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-doctor-"));
  for (const dependency of ["mammoth", "pdfjs-dist"]) {
    const directory = path.join(cwd, "node_modules", dependency);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "package.json"), "{}");
  }
  return cwd;
}

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    }
  };
}

const spawnAvailable = () => ({ status: 0, stdout: "available\n", stderr: "" });

test("doctor reports ready only with local dependencies, installed model and healthy Hindsight", async () => {
  const cwd = fixture();
  const report = await runDoctor({
    cwd,
    env: {},
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url) => String(url).endsWith("/api/tags")
      ? response({ models: [{ name: "llama3:latest" }] })
      : response({ status: "healthy" })
  });
  assert.equal(report.status, "ready");
  assert.equal(report.ready, true, JSON.stringify(report, null, 2));
  assert.equal(report.remoteCallsAllowed, false);
  assert.equal(report.modelDownloaded, false);
  assert.equal(report.blockers.length, 0);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("doctor fails closed without downloading a missing Ollama model", async () => {
  const cwd = fixture();
  const report = await runDoctor({
    cwd,
    env: {},
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url) => String(url).endsWith("/api/tags")
      ? response({ models: [] })
      : response({ status: "healthy" })
  });
  assert.equal(report.ready, false);
  assert.equal(report.modelDownloaded, false);
  assert.ok(report.blockers.some((item) => item.code === "ollama_model"));
  assert.match(report.blockers.find((item) => item.code === "ollama_model").action, /ollama pull/);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("doctor refuses a remote Hindsight endpoint", async () => {
  const cwd = fixture();
  const report = await runDoctor({
    cwd,
    env: { HINDSIGHT_BASE_URL: "https://remote.example.test" },
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url) => String(url).endsWith("/api/tags")
      ? response({ models: [{ name: "llama3:latest" }] })
      : response({ status: "healthy" })
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((item) => item.code === "hindsight_loopback"));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("doctor refuses a remote Ollama endpoint without contacting it", async () => {
  const cwd = fixture();
  const contacted = [];
  const report = await runDoctor({
    cwd,
    env: { SUPERMEMORY_OLLAMA_URL: "https://remote-model.example.test" },
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url, options = {}) => {
      contacted.push(String(url));
      return response({ status: "healthy" });
    }
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((item) => item.code === "ollama_loopback"));
  assert.ok(contacted.every((url) => !url.includes("remote-model.example.test")));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("doctor refuses backups configured inside the canonical vault", async () => {
  const cwd = fixture();
  const report = await runDoctor({
    cwd,
    env: {
      SUPERMEMORY_VAULT_ROOT: "vault",
      SUPERMEMORY_BACKUPS_ROOT: "vault/backups"
    },
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url) => String(url).endsWith("/api/tags")
      ? response({ models: [{ name: "llama3:latest" }] })
      : response({ status: "healthy" })
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((item) => item.code === "backups"));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("doctor --codex reports the bound capability profile without governing native memories", async () => {
  const cwd = fixture();
  const vault = path.join(cwd, "identity-vault");
  fs.mkdirSync(vault);
  const binding = createProjectRegistry({ vaultRoot: vault })
    .initProject({ projectRoot: cwd });
  const codexHome = path.join(cwd, "codex-home");
  fs.mkdirSync(codexHome);
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    "features.memories = true\nfeatures.hooks = true\n"
  );
  const marketplaceRoot = path.join(cwd, ".agents", "plugins");
  fs.mkdirSync(marketplaceRoot, { recursive: true });
  fs.writeFileSync(path.join(marketplaceRoot, "marketplace.json"), JSON.stringify({
    name: "fixture",
    plugins: [{
      name: "supermemory",
      source: { source: "local", path: "./plugins/supermemory" },
      policy: { installation: "INSTALLED_BY_DEFAULT", authentication: "ON_USE" },
      category: "Productivity"
    }]
  }));
  const keyFile = path.join(cwd, "codex.key");
  fs.writeFileSync(keyFile, Buffer.alloc(32, 0x75), { mode: 0o600 });
  const tokenFile = path.join(cwd, "daemon.token");
  fs.writeFileSync(tokenFile, "fixture-token-value-with-at-least-thirty-two-bytes\n", {
    mode: 0o600
  });
  const projectRuntime = path.join(cwd, ".codex", "supermemory");
  fs.mkdirSync(projectRuntime, { recursive: true });
  for (const [file, schema] of [
    ["hook-runtime.json", "supermemory.hook-runtime.v1"],
    ["mcp-runtime.json", "supermemory.mcp-runtime.v1"],
    ["app-server-runtime.json", "supermemory.app-server-runtime.v1"]
  ]) {
    fs.writeFileSync(path.join(projectRuntime, file), JSON.stringify({ schema }), { mode: 0o600 });
  }
  const pluginData = path.join(codexHome, "plugin-data", "supermemory");
  fs.mkdirSync(pluginData, { recursive: true });
  fs.writeFileSync(
    path.join(pluginData, "supermemory-plugin.json"),
    JSON.stringify({ schema: "supermemory.plugin-runtime.v1" }),
    { mode: 0o600 }
  );
  const launchAgent = path.join(cwd, "com.supermemory.codex-daemon.plist");
  fs.writeFileSync(launchAgent, "fixture\n");
  const report = await runDoctor({
    cwd,
    codex: true,
    env: {
      CODEX_HOME: codexHome,
      SUPERMEMORY_CODEX_DESKTOP_EXECUTABLE: "/fixture/ChatGPT.app/codex",
      SUPERMEMORY_CODEX_LAUNCH_AGENT: launchAgent,
      SUPERMEMORY_CODEX_PLUGIN_ROOT: path.resolve("plugins/supermemory"),
      SUPERMEMORY_CODEX_KEY_FILE: keyFile,
      SUPERMEMORY_CODEX_TOKEN_FILE: tokenFile,
      SUPERMEMORY_CODEX_DAEMON_ENDPOINT: "http://127.0.0.1:8765",
      SUPERMEMORY_VAULT_ROOT: vault,
      SUPERMEMORY_BACKUPS_ROOT: path.join(cwd, "backups")
    },
    spawnSyncImpl: (command) => ({
      status: 0,
      stdout: String(command).includes("codex")
        ? "codex-cli 0.146.0-alpha.fixture\n"
        : "available\n",
      stderr: ""
    }),
    codexDesktopInspectImpl: async () => ({
      plugin: {
        found: true,
        installed: true,
        enabled: true,
        plugin_id: "supermemory@fixture"
      },
      hooks: {
        count: 7,
        trusted: true,
        statuses: ["trusted"],
        events: ["sessionStart", "stop"]
      }
    }),
    fetchImpl: async (url, options = {}) => {
      if (String(url).endsWith("/api/tags")) {
        return response({ models: [{ name: "llama3:latest" }] });
      }
      if (String(url).includes(":8765/health")) {
        return response({
          status: "ready",
          compiler: {
            status: "ready",
            model: "llama3:latest",
            pending: 0,
            compiled: 2,
            candidates: 1,
            archived_only: 1,
            retryable: 0
          },
          spool_replay: {
            status: "complete",
            workspaces: 0,
            replayed: 0,
            duplicates: 0,
            failed: 0,
            retained: 0,
            expired: 0
          }
        });
      }
      if (String(url).includes(":8765/v1/memory/status")) {
        assert.equal(options.headers.authorization, "Bearer fixture-token-value-with-at-least-thirty-two-bytes");
        return response({
          ok: true,
          workspace_id: binding.workspaceId,
          project_id: binding.projectId,
          working_recall: true
        });
      }
      return response({ status: "healthy" });
    }
  });
  assert.equal(report.ready, true, JSON.stringify(report, null, 2));
  assert.equal(report.codex.project_binding, "bound");
  assert.equal(report.codex.project_id, binding.projectId);
  assert.equal(report.codex.capture_adapter, "hooks");
  assert.equal(report.codex.capture_coverage, "partial");
  assert.equal(report.codex.app_server_available, true);
  assert.equal(report.codex.app_server_configured, true);
  assert.equal(report.codex.app_server_observed, true);
  assert.equal(report.codex.app_server_status, "configured_observed");
  assert.equal(report.codex.plugin_installed, true);
  assert.equal(report.codex.plugin_hooks_trusted, true);
  assert.equal(report.codex.legacy_codex_hook_count, 0);
  assert.equal(report.codex.launch_agent_loaded, true);
  assert.equal(report.codex.daemon_ready, true);
  assert.equal(report.codex.daemon_token_mode, "0600_regular_file_bearer");
  assert.equal(report.codex.working_memory_round_trip, "authenticated_scope_bound");
  assert.equal(
    report.checks.find((check) => check.id === "codex_working_memory_round_trip")?.ok,
    true,
    "WM-AC19: doctor proves strict token mode and an authenticated scope-bound working-memory round trip"
  );
  assert.equal(report.codex.memory_compiler.status, "ready");
  assert.equal(report.codex.spool_replay.status, "complete");
  assert.equal(report.codex.marketplace, "discoverable");
  assert.equal(report.codex.mcp, "installed");
  assert.equal(report.codex.native_memories_enabled, true);
  assert.equal(report.codex.native_memories_authoritative, false);
  assert.equal(report.codex.cloud_web_coverage, "none");
  fs.rmSync(cwd, { recursive: true, force: true });
});
