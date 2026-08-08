#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createCodexInstaller } from "./lib/codex-installer.mjs";
import { createCodexMigration } from "./lib/codex-migration.mjs";
import { createProjectRegistry } from "./lib/project-registry.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function secureJson(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("operator_file_insecure");
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function optionalWrite(value) {
  const target = argument("--out");
  if (!target) return;
  const resolved = path.resolve(target);
  if (!fs.existsSync(path.dirname(resolved))) throw new Error("output_parent_missing");
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx"
  });
}

try {
  const configPath = argument("--config");
  if (!configPath) throw new Error("operator_config_required");
  const config = secureJson(configPath);
  if (config?.schema !== "supermemory.codex-operator.v1") {
    throw new Error("operator_config_invalid");
  }
  const command = process.argv[2];
  let result;
  if (command.startsWith("install")) {
    const installer = createCodexInstaller({
      codexHome: config.codex_home,
      projectRoot: config.project_root,
      pluginSource: config.plugin_source,
      vaultRoot: config.vault_root,
      runtimeRoot: config.runtime_root,
      keyFile: config.key_file,
      tokenFile: config.token_file,
      hookScript: config.hook_script,
      mcpScript: config.mcp_script,
      backupsRoot: config.install_backups_root,
      daemonEndpoint: config.daemon_endpoint
    });
    if (command === "install-plan") result = installer.plan();
    else if (command === "install-apply") {
      result = installer.apply(secureJson(argument("--plan")), {
        confirmation: argument("--confirm")
      });
    } else if (command === "install-rollback") {
      result = installer.rollback(secureJson(argument("--manifest")), {
        confirmation: argument("--confirm")
      });
    } else throw new Error("operator_command_invalid");
  } else if (command.startsWith("migration")) {
    const migration = createCodexMigration({
      vaultRoot: config.vault_root,
      backupsRoot: config.vault_backups_root
    });
    const binding = createProjectRegistry({ vaultRoot: config.vault_root })
      .status(config.project_root);
    if (command === "migration-plan") {
      result = migration.plan({
        projectId: binding.status === "bound" ? binding.projectId : null,
        workspaceId: binding.status === "bound" ? binding.workspaceId : null
      });
    } else if (command === "migration-apply") {
      result = migration.apply(secureJson(argument("--plan")), {
        confirmation: argument("--confirm")
      });
    } else if (command === "migration-rollback") {
      result = await migration.rollback(secureJson(argument("--checkpoint")), {
        confirmation: argument("--confirm")
      });
    } else throw new Error("operator_command_invalid");
  } else {
    throw new Error("operator_command_invalid");
  }
  optionalWrite(result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`SuperMemory Codex failed: ${error?.code ?? error?.message ?? "unknown"}\n`);
  process.exitCode = 1;
}
