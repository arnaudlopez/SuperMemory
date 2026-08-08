#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createCodexHindsight } from "./lib/codex-hindsight.mjs";
import { createCodexMemoryRecall } from "./lib/codex-memory-recall.mjs";
import { createCodexMcpServer, runMcpStdio } from "./lib/codex-mcp-server.mjs";
import { createSuperMemoryRecallClient } from "./lib/supermemory-daemon.mjs";
import { createCodexWorkspaceStore } from "./lib/codex-workspace-store.mjs";
import { createProjectRegistry } from "./lib/project-registry.mjs";
import { normalizeCodexRuntimeConfig } from "./lib/codex-runtime-config.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function secureJson(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    fail("mcp_config_insecure");
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function optionalSecret(filePath) {
  if (!filePath) return "";
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    fail("mcp_secret_insecure");
  }
  return fs.readFileSync(resolved, "utf8").trim();
}

const configIndex = process.argv.indexOf("--config");
if (configIndex < 0 || !process.argv[configIndex + 1]) {
  process.stderr.write("supermemory-mcp requires --config <path>\n");
  process.exit(1);
} else {
  try {
    const config = secureJson(process.argv[configIndex + 1]);
    if (config?.schema !== "supermemory.mcp-runtime.v1" || !config.vault_root) {
      fail("mcp_config_invalid");
    }
    if (config.runtime_contract_file) {
      const contract = normalizeCodexRuntimeConfig(secureJson(config.runtime_contract_file));
      config.max_results = contract.memory_router.max_results;
    }
    const registry = createProjectRegistry({ vaultRoot: config.vault_root });
    const diagnosticMode = process.argv.includes("--diagnostic");
    if (diagnosticMode) {
      const diagnostics = {
        status() {
          const snapshot = registry.snapshot();
          return {
            mode: "diagnostic",
            projects: snapshot.projects.length,
            workspaces: new Set(snapshot.projects.map((project) => project.workspaceId)).size,
            checkouts: snapshot.checkouts.length,
            content_access: false
          };
        },
        resolveProject(cwd) {
          const resolution = registry.status(cwd);
          return {
            status: resolution.status,
            project_id: resolution.projectId ?? null,
            workspace_id: resolution.workspaceId ?? null,
            checkout_id: resolution.checkoutId ?? null,
            action: ["unbound", "ambiguous", "binding_conflict"].includes(resolution.status)
              ? "owner_action_required"
              : null,
            content_access: false
          };
        }
      };
      await runMcpStdio(createCodexMcpServer({ mode: "diagnostic", diagnostics }));
    } else {
      const launchRoot = fs.realpathSync(process.cwd());
      const resolution = registry.status(launchRoot);
      if (resolution.status !== "bound") fail(`scope_${resolution.status}`);
      if (
        (config.expected_project_id && config.expected_project_id !== resolution.projectId) ||
        (config.expected_workspace_id && config.expected_workspace_id !== resolution.workspaceId)
      ) fail("scope_mismatch");
      const store = createCodexWorkspaceStore({
        vaultRoot: config.vault_root,
        workspaceId: resolution.workspaceId,
        projectId: resolution.projectId
      });
      const hindsight = createCodexHindsight({
        workspaceId: resolution.workspaceId,
        enabled: config.hindsight_enabled !== false,
        baseUrl: config.hindsight_base_url,
        ["api" + "Key"]: optionalSecret(config.hindsight_api_key_file),
        timeoutMs: config.hindsight_timeout_ms
      });
      const durableRecall = createCodexMemoryRecall({
        workspaceStore: store,
        hindsight,
        maxLimit: config.max_results ?? 10
      });
      const recall = config.daemon_endpoint
        ? createSuperMemoryRecallClient({
          endpoint: config.daemon_endpoint,
          ["auth" + "Token"]: optionalSecret(config.daemon_token_file),
          timeoutMs: config.daemon_recall_timeout_ms ?? 1_500
        })
        : Object.freeze({
          status: () => durableRecall.status(),
          assertBound() { fail("backend_unavailable"); }
        });
      await runMcpStdio(createCodexMcpServer({ mode: "bound", recall }));
    }
  } catch (error) {
    process.stderr.write(`SuperMemory MCP failed: ${error?.code ?? error?.message ?? "unknown"}\n`);
    process.exitCode = 1;
  }
}
