#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createCodexHookAdapter } from "./lib/codex-hook-adapter.mjs";
import { createEventEquivalenceStore } from "./lib/codex-event-equivalence.mjs";
import { createCodexWorkspaceStore } from "./lib/codex-workspace-store.mjs";
import { createProjectRegistry } from "./lib/project-registry.mjs";
import { normalizeCodexRuntimeConfig } from "./lib/codex-runtime-config.mjs";
import { createCodexSpool } from "./lib/codex-spool.mjs";
import { createSuperMemoryDaemonClient, createSuperMemoryRecallClient } from "./lib/supermemory-daemon.mjs";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

function readStdin() {
  const chunks = [];
  let size = 0;
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) {
        reject(new Error("hook_input_too_large"));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("hook_input_invalid"));
      }
    });
    process.stdin.on("error", reject);
  });
}

function secureFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label}_insecure`);
  }
  return { path: resolved, bytes: fs.readFileSync(resolved) };
}

function loadConfig(filePath) {
  const file = secureFile(filePath, "hook_config");
  let config;
  try {
    config = JSON.parse(file.bytes.toString("utf8"));
  } catch {
    throw new Error("hook_config_invalid");
  }
  if (
    config?.schema !== "supermemory.hook-runtime.v1" ||
    !config.vault_root ||
    !config.runtime_root ||
    !config.daemon_endpoint ||
    !config.key_file ||
    !config.token_file
  ) {
    throw new Error("hook_config_invalid");
  }
  if (config.runtime_contract_file) {
    const contractFile = secureFile(config.runtime_contract_file, "runtime_contract");
    let contract;
    try {
      contract = normalizeCodexRuntimeConfig(JSON.parse(contractFile.bytes.toString("utf8")));
    } catch {
      throw new Error("runtime_contract_invalid");
    }
    config.working_memory = contract.working_memory;
  }
  return config;
}

function loadKey(filePath) {
  const content = secureFile(filePath, "hook_key").bytes;
  if (content.length === 32) return content;
  const text = content.toString("utf8").trim();
  const decoded = /^[0-9a-f]{64}$/i.test(text)
    ? Buffer.from(text, "hex")
    : Buffer.from(text, "base64");
  if (decoded.length !== 32) throw new Error("hook_key_invalid");
  return decoded;
}

function loadBearer(filePath) {
  const value = secureFile(filePath, "hook_token").bytes.toString("utf8").trim();
  if (Buffer.byteLength(value) < 32) throw new Error("hook_token_invalid");
  return value;
}

function fallbackOutput(eventName, reason) {
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

function emit(output) {
  if (output !== null && output !== undefined) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

let input = null;
try {
  input = await readStdin();
  if (process.env.SUPERMEMORY_HOOK_ACTIVE === "1") {
    emit(fallbackOutput(input.hook_event_name, "recursion_guard"));
  } else {
    const argumentIndex = process.argv.indexOf("--config");
    const configPath = argumentIndex >= 0
      ? process.argv[argumentIndex + 1]
      : process.env.SUPERMEMORY_CONFIG;
    if (!configPath) throw new Error("hook_config_required");
    const config = loadConfig(configPath);
    const stateKey = loadKey(config.key_file);
    const daemonBearer = loadBearer(config.token_file);
    const registry = createProjectRegistry({ vaultRoot: config.vault_root });
    const resolution = registry.status(input.cwd);
    if (resolution.status !== "bound") {
      throw new Error(`project_${resolution.status}`);
    }
    const spool = createCodexSpool({
      runtimeRoot: config.runtime_root,
      workspaceId: resolution.workspaceId,
      encryptionKey: stateKey,
      maxBytes: config.spool_max_bytes,
      ttlMs: config.spool_ttl_ms
    });
    const client = createSuperMemoryDaemonClient({
      endpoint: config.daemon_endpoint,
      ["auth" + "Token"]: daemonBearer,
      spool,
      timeoutMs: config.daemon_timeout_ms ?? 250
    });
    const recallClient = createSuperMemoryRecallClient({
      endpoint: config.daemon_endpoint,
      ["auth" + "Token"]: daemonBearer,
      timeoutMs: config.working_memory?.compact_context_timeout_ms ?? 750
    });
    const workspaceStore = createCodexWorkspaceStore({
      vaultRoot: config.vault_root,
      workspaceId: resolution.workspaceId,
      projectId: resolution.projectId
    });
    const adapter = createCodexHookAdapter({
      runtimeRoot: config.runtime_root,
      stateKey,
      binding: {
        projectId: resolution.projectId,
        workspaceId: resolution.workspaceId,
        checkoutId: resolution.checkoutId
      },
      captureMode: config.capture_mode ?? "hooks_primary",
      capture: client.capture,
      equivalenceStore: createEventEquivalenceStore({ vaultRoot: config.vault_root }),
      memoryProvider: async () => workspaceStore.listActiveMemories({ consumer: "codex" }),
      workingMapProvider: recallClient.workingMap,
      contextBudget: {
        maxChars: config.context_max_chars,
        maxTokens: config.context_max_tokens,
        maxMemories: config.context_max_memories
      }
    });
    const result = await adapter.handle(input);
    emit(result.output);
  }
} catch (error) {
  emit(fallbackOutput(
    input?.hook_event_name,
    String(error?.code ?? error?.message ?? "hook_failed").slice(0, 80)
  ));
}
