#!/usr/bin/env node

import process from "node:process";
import {
  createProjectRegistry,
  ProjectRegistryError
} from "./lib/project-registry.mjs";

const BOOLEAN_OPTIONS = new Set([
  "--adopt-legacy-workspace",
  "--json",
  "--rebind-checkout"
]);
const VALUE_OPTIONS = new Set([
  "--link-project",
  "--name",
  "--project-root",
  "--vault-root"
]);

function usage() {
  return [
    "Usage:",
    "  node scripts/supermemory-project.mjs init --vault-root <path> --project-root <path> [options]",
    "  node scripts/supermemory-project.mjs status --vault-root <path> --project-root <path> [--json]",
    "  node scripts/supermemory-project.mjs list --vault-root <path> [--json]",
    "",
    "Init options:",
    "  --name <name>                    Project display name",
    "  --link-project <project-id>      Bind another root to an existing project",
    "  --adopt-legacy-workspace         Explicitly map an unmigrated v1 workspace",
    "  --rebind-checkout                Confirm a copied/recreated checkout binding",
    "  --json                           Emit machine-readable output"
  ].join("\n");
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  if (!["init", "status", "list"].includes(command)) {
    throw new ProjectRegistryError("command_invalid", usage());
  }
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (BOOLEAN_OPTIONS.has(token)) {
      options[token.slice(2).replaceAll("-", "_")] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(token)) {
      throw new ProjectRegistryError("option_invalid", `Unknown option: ${token}\n\n${usage()}`);
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ProjectRegistryError("option_value_missing", `Missing value for ${token}.`);
    }
    options[token.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!options.vault_root) {
    throw new ProjectRegistryError("vault_root_required", "--vault-root is required.");
  }
  if (command !== "list" && !options.project_root) {
    throw new ProjectRegistryError("project_root_required", "--project-root is required.");
  }
  return { command, options };
}

function humanOutput(command, result) {
  if (command === "list") {
    const projects = result.projects ?? [];
    if (projects.length === 0) return "No SuperMemory project is registered.";
    return projects.map((project) => (
      `${project.displayName}: ${project.projectId} (${project.workspaceId})`
    )).join("\n");
  }
  const lines = [
    `status: ${result.status}`,
    result.projectId ? `project: ${result.projectId}` : null,
    result.workspaceId ? `workspace: ${result.workspaceId}` : null,
    result.checkoutId ? `checkout: ${result.checkoutId}` : null,
    result.projectRoot ? `root: ${result.projectRoot}` : null
  ];
  return lines.filter(Boolean).join("\n");
}

function emit(value, json, command) {
  process.stdout.write(json
    ? `${JSON.stringify(value, null, 2)}\n`
    : `${humanOutput(command, value)}\n`);
}

function emitError(error, json) {
  const payload = {
    ok: false,
    error: {
      code: error instanceof ProjectRegistryError ? error.code : "project_command_failed",
      message: error instanceof Error ? error.message : String(error),
      details: error instanceof ProjectRegistryError ? error.details : null
    }
  };
  if (json) process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stderr.write(`SuperMemory project error [${payload.error.code}]: ${payload.error.message}\n`);
}

let wantsJson = process.argv.includes("--json");
try {
  const { command, options } = parseArguments(process.argv.slice(2));
  wantsJson = Boolean(options.json);
  const registry = createProjectRegistry({ vaultRoot: options.vault_root });
  let result;
  if (command === "init") {
    result = registry.initProject({
      projectRoot: options.project_root,
      displayName: options.name,
      linkProjectId: options.link_project,
      adoptLegacyWorkspace: Boolean(options.adopt_legacy_workspace),
      rebindCheckout: Boolean(options.rebind_checkout)
    });
  } else if (command === "status") {
    result = registry.status(options.project_root);
  } else {
    result = registry.snapshot();
  }
  emit({ ok: true, ...result }, wantsJson, command);
} catch (error) {
  emitError(error, wantsJson);
  process.exitCode = 1;
}
