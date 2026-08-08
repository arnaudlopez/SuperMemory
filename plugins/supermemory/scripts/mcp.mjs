#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function secureJson(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("plugin_config_insecure");
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

try {
  const pluginData = process.env.PLUGIN_DATA;
  if (!pluginData) throw new Error("plugin_data_missing");
  const config = secureJson(path.join(pluginData, "supermemory-plugin.json"));
  if (
    config?.schema !== "supermemory.plugin-runtime.v1" ||
    !path.isAbsolute(config.node) ||
    !path.isAbsolute(config.mcp_script) ||
    !path.isAbsolute(config.mcp_runtime_config)
  ) throw new Error("plugin_config_invalid");
  const args = [
    config.mcp_script,
    "--config",
    config.mcp_runtime_config,
    ...(process.argv.includes("--diagnostic") ? ["--diagnostic"] : [])
  ];
  const child = spawn(config.node, args, {
    cwd: process.cwd(),
    env: { ...process.env, SUPERMEMORY_PLUGIN_BRIDGE: "1" },
    stdio: "inherit"
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
} catch (error) {
  process.stderr.write(`SuperMemory MCP bridge failed: ${error?.message ?? "unknown"}\n`);
  process.exitCode = 1;
}
