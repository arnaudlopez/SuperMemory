import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexMcpServer } from "../scripts/lib/codex-mcp-server.mjs";
import { createProjectRegistry } from "../scripts/lib/project-registry.mjs";

const mcpScript = path.resolve("scripts/supermemory-mcp.mjs");
const pluginRoot = path.resolve("plugins/supermemory");

function request(id, method, params = undefined) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mcp-"));
  const vault = path.join(root, "vault");
  const project = path.join(root, "project");
  fs.mkdirSync(vault);
  fs.mkdirSync(project);
  const git = spawnSync("git", ["init", "-q"], { cwd: project, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const registry = createProjectRegistry({ vaultRoot: vault });
  const binding = registry.initProject({ projectRoot: project });
  const configPath = path.join(root, "mcp.json");
  fs.writeFileSync(configPath, `${JSON.stringify({
    schema: "supermemory.mcp-runtime.v1",
    vault_root: vault,
    expected_project_id: binding.projectId,
    expected_workspace_id: binding.workspaceId,
    hindsight_enabled: false,
    max_results: 5
  })}\n`, { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault, project, binding, configPath };
}

test("bound MCP advertises only scope-free read tools and returns tool errors safely", async () => {
  const workingSetId = "wset_018f7c0e-7b7d-7abc-8def-0123456789ad";
  const recall = {
    assertBound(args) {
      if (args.working_set_id !== workingSetId) throw Object.assign(new Error("not_found_or_not_authorized"), {
        code: "not_found_or_not_authorized"
      });
      return { working_set_id: workingSetId };
    },
    async status() {
      return { project_id: "prj", workspace_id: "ws" };
    },
    async search(args) {
      if ("workspace_id" in args || "cwd" in args) {
        const error = new Error("scope_argument_forbidden");
        error.code = "scope_argument_forbidden";
        throw error;
      }
      return { results: [], query: args.query };
    },
    async recall(args) { return { results: [], query: args.query }; },
    async reflect(args) { return { status: "grounded", format: args.format ?? "summary" }; },
    workingMap: () => ({}),
    workingSearch: () => ({ results: [] }),
    workingOpen: () => ({}),
    workingNeighbors: () => ({}),
    graphQuery: () => ({ results: [] }),
    explainPath: () => ({ path: {} }),
    get() {
      return { memory: {} };
    },
    explainCitation() {
      return { chain: {} };
    }
  };
  const server = createCodexMcpServer({ mode: "bound", recall });
  const initialized = await server.handle(request(1, "initialize", {
    protocolVersion: "2025-06-18"
  }));
  assert.equal(initialized.result.protocolVersion, "2025-06-18");
  assert.match(initialized.result.instructions, /Search first/);
  assert.ok(initialized.result.instructions.length < 512);

  const listed = await server.handle(request(2, "tools/list"));
  assert.deepEqual(listed.result.tools.map((entry) => entry.name), [
    "supermemory_status",
    "supermemory_recall",
    "supermemory_reflect",
    "supermemory_search",
    "supermemory_get",
    "supermemory_explain_citation",
    "supermemory_working_map",
    "supermemory_working_search",
    "supermemory_working_open",
    "supermemory_working_neighbors",
    "supermemory_graph_query",
    "supermemory_graph_explain_path"
  ]);
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, "workspace_id"), false);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, "project_id"), false);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, "cwd"), false);
  }
  const forbidden = await server.handle(request(3, "tools/call", {
    name: "supermemory_search",
    arguments: { working_set_id: workingSetId, query: "cache", workspace_id: "ws_other" }
  }));
  assert.equal(forbidden.result.isError, true);
  assert.equal(forbidden.result.structuredContent.error, "scope_argument_forbidden");
  const unbound = await server.handle(request(4, "tools/call", {
    name: "supermemory_recall",
    arguments: { working_set_id: "wset_018f7c0e-7b7d-7abc-8def-0123456789ff", query: "cache" }
  }));
  assert.equal(unbound.result.isError, true);
  assert.equal(unbound.result.structuredContent.error, "not_found_or_not_authorized");
  const excessive = await server.handle(request(5, "tools/call", {
    name: "supermemory_reflect",
    arguments: { working_set_id: workingSetId, query: "résume", max_tokens: 4097 }
  }));
  assert.equal(excessive.result.isError, true);
  assert.equal(excessive.result.structuredContent.error, "arguments_invalid");
  const arbitrarySchema = await server.handle(request(6, "tools/call", {
    name: "supermemory_reflect",
    arguments: { working_set_id: workingSetId, query: "résume", response_schema: {} }
  }));
  assert.equal(arbitrarySchema.result.isError, true);
});

test("global MCP is diagnostic-only and cannot invoke content tools", async () => {
  const diagnostics = {
    status: () => ({ mode: "diagnostic", content_access: false }),
    resolveProject: (cwd) => ({ status: "unbound", cwd_fingerprint_only: Boolean(cwd) })
  };
  const server = createCodexMcpServer({ mode: "diagnostic", diagnostics });
  const listed = await server.handle(request(1, "tools/list"));
  assert.deepEqual(listed.result.tools.map((entry) => entry.name), [
    "supermemory_status",
    "supermemory_resolve_project"
  ]);
  const denied = await server.handle(request(2, "tools/call", {
    name: "supermemory_search",
    arguments: { query: "architecture" }
  }));
  assert.equal(denied.result.isError, true);
  assert.equal(denied.result.structuredContent.error, "tool_not_found");
});

test("stdio runtime freezes the launch binding and exposes bound versus diagnostic profiles", (t) => {
  const { project, configPath, binding } = fixture(t);
  const input = [
    JSON.stringify(request(1, "initialize", { protocolVersion: "2025-06-18" })),
    JSON.stringify(request(2, "tools/list")),
    JSON.stringify(request(3, "tools/call", {
      name: "supermemory_status",
      arguments: {}
    }))
  ].join("\n") + "\n";
  const bound = spawnSync(process.execPath, [mcpScript, "--config", configPath], {
    cwd: project,
    input,
    encoding: "utf8",
    timeout: 5_000
  });
  assert.equal(bound.status, 0, bound.stderr);
  const messages = bound.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(messages[2].result.structuredContent.project_id, binding.projectId);
  assert.equal(messages[2].result.structuredContent.workspace_id, binding.workspaceId);

  const diagnostics = spawnSync(
    process.execPath,
    [mcpScript, "--config", configPath, "--diagnostic"],
    {
      cwd: project,
      input: `${JSON.stringify(request(1, "tools/list"))}\n`,
      encoding: "utf8",
      timeout: 5_000
    }
  );
  assert.equal(diagnostics.status, 0, diagnostics.stderr);
  const diagnosticTools = JSON.parse(diagnostics.stdout).result.tools.map((entry) => entry.name);
  assert.deepEqual(diagnosticTools, ["supermemory_status", "supermemory_resolve_project"]);
});

test("plugin manifest packages MCP bridges without absolute installation paths", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(pluginRoot, ".codex-plugin", "plugin.json"),
    "utf8"
  ));
  const config = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(Object.keys(config.mcpServers).sort(), [
    "supermemory",
    "supermemory-diagnostics"
  ]);
  const serialized = JSON.stringify(config);
  assert.match(serialized, /\$\{PLUGIN_ROOT\}/);
  assert.equal(serialized.includes("/Users/"), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "scripts", "mcp.mjs")), true);
});
