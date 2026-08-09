#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

function fallback(eventName, reason = "plugin_not_configured") {
  if (eventName === "SessionEnd") return null;
  if (eventName === "SessionStart") {
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `SuperMemory indisponible (${reason}); aucune mémoire n’est injectée.`
      }
    };
  }
  return { continue: true };
}

function emit(value) {
  if (value !== null && value !== undefined) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  }
}

function readInput() {
  const bytes = fs.readFileSync(0);
  if (bytes.length > MAX_INPUT_BYTES) throw new Error("input_too_large");
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function secureJson(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("plugin_config_insecure");
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function dynamicRuntimeConfig(cwd, fileName) {
  let current = path.resolve(cwd ?? process.cwd());
  for (;;) {
    const candidate = path.join(current, ".codex", "supermemory", fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function validOutput(eventName, value) {
  if (eventName === "SessionEnd") return null;
  if (!value || typeof value !== "object") {
    throw new Error("plugin_output_invalid");
  }
  if (eventName === "SessionStart") {
    const specific = value.hookSpecificOutput;
    if (
      specific?.hookEventName !== "SessionStart" ||
      typeof specific.additionalContext !== "string"
    ) {
      throw new Error("plugin_output_invalid");
    }
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: specific.additionalContext
      }
    };
  }
  if (eventName === "PostToolUse" && value.continue === false) {
    const specific = value.hookSpecificOutput;
    if (
      specific?.hookEventName !== "PostToolUse" ||
      typeof specific.additionalContext !== "string" ||
      typeof value.stopReason !== "string"
    ) throw new Error("plugin_output_invalid");
    return {
      continue: false,
      stopReason: value.stopReason,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: specific.additionalContext
      }
    };
  }
  if (value.continue !== true) throw new Error("plugin_output_invalid");
  return { continue: true };
}

let eventName = null;
try {
  const input = readInput();
  eventName = input.value?.hook_event_name;
  const pluginData = process.env.PLUGIN_DATA;
  if (!pluginData) throw new Error("plugin_data_missing");
  const configPath = path.join(pluginData, "supermemory-plugin.json");
  const config = secureJson(configPath);
  const dynamic = config?.scope_mode === "dynamic_cwd";
  if (
    config?.schema !== "supermemory.plugin-runtime.v1" ||
    !path.isAbsolute(config.node) ||
    !path.isAbsolute(config.hook_script) ||
    (!dynamic && !path.isAbsolute(config.runtime_config))
  ) {
    throw new Error("plugin_config_invalid");
  }
  const timeout = Math.min(1_500, Math.max(50, Number(config.timeout_ms ?? 750)));
  const runtimeConfig = dynamic
    ? dynamicRuntimeConfig(input.value?.cwd, "hook-runtime.json")
    : config.runtime_config;
  if (!runtimeConfig) throw new Error("project_not_enrolled");
  const child = spawnSync(
    config.node,
    [config.hook_script, "--config", runtimeConfig],
    {
      input: input.bytes,
      encoding: "utf8",
      env: { ...process.env, SUPERMEMORY_PLUGIN_BRIDGE: "1" },
      timeout,
      maxBuffer: 256 * 1024,
      stdio: ["pipe", "pipe", "ignore"]
    }
  );
  if (child.error || child.status !== 0) throw new Error("plugin_bridge_failed");
  if (eventName === "SessionEnd") {
    emit(null);
  } else {
    emit(validOutput(eventName, JSON.parse(child.stdout)));
  }
} catch (error) {
  emit(fallback(eventName, String(error?.message ?? "plugin_failed").slice(0, 60)));
}
