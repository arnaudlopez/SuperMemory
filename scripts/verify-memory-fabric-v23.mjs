#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const required = [
  "scripts/lib/workspace-runtime-supervisor.mjs",
  "scripts/lib/workspace-runtime-context.mjs",
  "scripts/lib/checkout-credential-store.mjs",
  "scripts/lib/request-scope-resolver.mjs",
  "scripts/lib/project-enrollment.mjs",
  "scripts/lib/owner-preference-store.mjs",
  "scripts/lib/codex-client-enrollment.mjs",
  "scripts/lib/codex-client-launcher.mjs",
  "scripts/lib/codex-capability-probe.mjs",
  "scripts/lib/codex-history-discovery.mjs",
  "scripts/lib/codex-history-readers.mjs",
  "scripts/lib/codex-history-import.mjs",
  "scripts/supermemory-client.mjs",
  "scripts/supermemory-history.mjs",
  "scripts/supermemory-plugin.mjs",
  "tests/codex-runtime-v6.test.mjs",
  "tests/checkout-credential-store.test.mjs",
  "tests/project-enrollment.test.mjs",
  "tests/owner-preference-store.test.mjs",
  "tests/workspace-runtime-supervisor.test.mjs",
  "tests/codex-history-import.test.mjs",
  "tests/supermemory-daemon-multi-project.test.mjs",
  "docs/multi-project-codex-session-sync-blueprint.md"
];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing:${relative}`);
}
const runtime = JSON.parse(fs.readFileSync(path.join(root, "deploy/runtime/runtime-contract.production.json"), "utf8"));
if (runtime.schema !== "supermemory.codex-runtime.v6") failures.push("runtime_schema_invalid");
if (
  runtime.deployment.strategy !== "full" || runtime.deployment.canary !== false ||
  runtime.deployment.progressive !== false || runtime.deployment.activation !== "enabled"
) failures.push("runtime_activation_invalid");
if (
  runtime.scope?.mode !== "owner_plus_current_project" || runtime.scope?.cross_project_mcp !== false ||
  runtime.enrollment?.credential_mode !== "opaque_per_checkout" ||
  runtime.history_import?.default_capture_level !== "backfill" ||
  runtime.codex_integration?.auto_trust_hooks !== false
) failures.push("runtime_multi_project_contract_invalid");
const stack = fs.readFileSync(path.join(root, "deploy/portainer/supermemory-ai-stack.yml"), "utf8");
if (/SUPERMEMORY_(?:WORKSPACE_ID|PROJECT_ID)/.test(stack)) failures.push("stack_singleton_scope_present");
const mcp = fs.readFileSync(path.join(root, "scripts/lib/codex-mcp-server.mjs"), "utf8");
if (/tool\([^\n]+workspace_id/.test(mcp)) failures.push("mcp_scope_selector_present");
const pluginHook = fs.readFileSync(path.join(root, "plugins/supermemory/scripts/hook.mjs"), "utf8");
const pluginMcp = fs.readFileSync(path.join(root, "plugins/supermemory/scripts/mcp.mjs"), "utf8");
if (!pluginHook.includes("dynamic_cwd") || !pluginMcp.includes("dynamic_cwd")) failures.push("plugin_dynamic_scope_missing");
const report = {
  schema: "supermemory.memory-fabric-v2.3-verification.v1",
  status: failures.length === 0 ? "pass" : "fail",
  failures,
  direct_full_deployment: true,
  cross_project_mcp: false,
  auto_trust_hooks: false
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
