#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createCodexDesktopDeployment } from "./lib/codex-desktop-deployment.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function secureJson(filePath, expectedSchema = null) {
  if (!filePath) throw new Error("operator_file_required");
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("operator_file_insecure");
  }
  const value = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (expectedSchema && value?.schema !== expectedSchema) {
    throw new Error("operator_file_invalid");
  }
  return value;
}

function outputFile(value) {
  const destination = argument("--out");
  if (!destination) return null;
  const resolved = path.resolve(destination);
  if (!fs.existsSync(path.dirname(resolved))) throw new Error("output_parent_missing");
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx"
  });
  return resolved;
}

function deploymentFrom(config) {
  return createCodexDesktopDeployment({
    codexHome: config.codex_home,
    projectRoot: config.project_root,
    pluginSource: config.plugin_source,
    vaultRoot: config.vault_root,
    runtimeRoot: config.runtime_root,
    keyFile: config.key_file,
    tokenFile: config.token_file,
    hookScript: config.hook_script,
    mcpScript: config.mcp_script,
    daemonScript: config.daemon_script,
    nodePath: config.node_path,
    codexExecutable: config.codex_desktop_executable,
    installBackupsRoot: config.install_backups_root,
    desktopBackupsRoot: config.desktop_backups_root,
    launchAgentPath: config.launch_agent_path,
    launchAgentLabel: config.launch_agent_label,
    daemonEndpoint: config.daemon_endpoint,
    projectName: config.project_name,
    adoptLegacyWorkspace: Boolean(config.adopt_legacy_workspace)
  });
}

function publicResult(command, value, outputPath) {
  if (command === "plan") return value;
  if (command === "apply" || command === "hooks-feature-apply") {
    return {
      ...value,
      output_path: outputPath
    };
  }
  return value;
}

export async function runDesktopCommand(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (![
    "plan",
    "apply",
    "rollback",
    "status",
    "hooks-feature-plan",
    "hooks-feature-apply",
    "hooks-feature-rollback"
  ].includes(command)) {
    throw new Error("desktop_command_invalid");
  }
  const config = secureJson(
    argument("--config"),
    "supermemory.codex-desktop-operator.v1"
  );
  const deployment = deploymentFrom(config);
  let result;
  if (command === "plan") {
    result = await deployment.plan();
  } else if (command === "apply") {
    result = await deployment.apply(
      secureJson(argument("--plan"), "supermemory.codex-desktop-plan.v1"),
      { confirmation: argument("--confirm") }
    );
  } else if (command === "rollback") {
    result = await deployment.rollback(
      secureJson(
        argument("--manifest"),
        "supermemory.codex-desktop-installation.v1"
      ),
      { confirmation: argument("--confirm") }
    );
  } else if (command === "hooks-feature-plan") {
    result = deployment.hooksFeaturePlan();
  } else if (command === "hooks-feature-apply") {
    result = deployment.applyHooksFeatureMigration(
      secureJson(
        argument("--plan"),
        "supermemory.codex-desktop-hooks-feature-plan.v1"
      ),
      { confirmation: argument("--confirm") }
    );
  } else if (command === "hooks-feature-rollback") {
    result = deployment.rollbackHooksFeatureMigration(
      secureJson(
        argument("--manifest"),
        "supermemory.codex-desktop-hooks-feature-migration.v1"
      ),
      { confirmation: argument("--confirm") }
    );
  } else {
    result = await deployment.status();
  }
  const outputPath = outputFile(result);
  return publicResult(command, result, outputPath);
}

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    const result = await runDesktopCommand();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`SuperMemory Desktop failed: ${error?.code ?? error?.message ?? "unknown"}\n`);
    process.exitCode = 1;
  }
}
