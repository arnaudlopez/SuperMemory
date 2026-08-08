#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import {
  CODEX_APP_SERVER_PROFILE_0_125,
  createCodexAppServerAdapter
} from "./lib/codex-app-server-adapter.mjs";
import { createCodexCaptureStore } from "./lib/codex-capture-store.mjs";
import { createEventEquivalenceStore } from "./lib/codex-event-equivalence.mjs";
import { createCodexHindsight } from "./lib/codex-hindsight.mjs";
import { createCodexWorkspaceStore } from "./lib/codex-workspace-store.mjs";
import { createProjectRegistry } from "./lib/project-registry.mjs";
import { normalizeCodexRuntimeConfig } from "./lib/codex-runtime-config.mjs";
import { createTurnSnapshotStore } from "./lib/codex-turn-snapshot.mjs";

function secureJson(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("app_server_config_insecure");
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function loadKey(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("app_server_key_insecure");
  }
  const content = fs.readFileSync(resolved);
  if (content.length === 32) return content;
  const text = content.toString("utf8").trim();
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
  if (key.length !== 32) throw new Error("app_server_key_invalid");
  return key;
}

function optionalSecret(filePath) {
  if (!filePath) return "";
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("app_server_secret_insecure");
  }
  return fs.readFileSync(resolved, "utf8").trim();
}

const configIndex = process.argv.indexOf("--config");
if (configIndex < 0 || !process.argv[configIndex + 1]) {
  process.stderr.write("supermemory-app-server requires --config <path>\n");
  process.exit(1);
}

try {
  const separator = process.argv.indexOf("--");
  const config = secureJson(process.argv[configIndex + 1]);
  if (
    config?.schema !== "supermemory.app-server-runtime.v1" ||
    !config.vault_root ||
    !config.project_root ||
    !config.key_file
  ) throw new Error("app_server_config_invalid");
  if (config.runtime_contract_file) {
    const contract = normalizeCodexRuntimeConfig(secureJson(config.runtime_contract_file));
    config.working_memory = contract.working_memory;
  }
  const key = loadKey(config.key_file);
  const registry = createProjectRegistry({ vaultRoot: config.vault_root });
  const resolution = registry.status(config.project_root);
  if (resolution.status !== "bound") throw new Error(`project_${resolution.status}`);
  const store = createCodexCaptureStore({
    vaultRoot: config.vault_root,
    encryptionKey: key,
    workingMemory: config.working_memory?.enabled === true ? config.working_memory : null
  });
  const equivalence = createEventEquivalenceStore({ vaultRoot: config.vault_root });
  const snapshots = createTurnSnapshotStore({
    vaultRoot: config.vault_root,
    fingerprintKey: key
  });
  const hindsight = createCodexHindsight({
    workspaceId: resolution.workspaceId,
    enabled: config.hindsight_enabled !== false,
    baseUrl: config.hindsight_base_url,
    [["api", "Key"].join("")]: optionalSecret(config.hindsight_api_key_file),
    timeoutMs: config.hindsight_timeout_ms
  });
  const workspace = createCodexWorkspaceStore({
    vaultRoot: config.vault_root,
    workspaceId: resolution.workspaceId,
    projectId: resolution.projectId,
    projection: hindsight
  });
  const adapter = createCodexAppServerAdapter({
    binding: {
      projectId: resolution.projectId,
      workspaceId: resolution.workspaceId,
      checkoutId: resolution.checkoutId
    },
    capture: (event) => store.ingest(event),
    equivalenceStore: equivalence,
    snapshotStore: snapshots,
    onSourceInvalidated: ({ invalidatedSnapshotIds, reason }) => (
      workspace.invalidateEvidence({
        snapshotIds: invalidatedSnapshotIds,
        reason
      })
    ),
    schemaProfile: config.schema_profile ?? CODEX_APP_SERVER_PROFILE_0_125
  });

  const command = config.codex_command ?? "codex";
  const passthrough = separator >= 0 ? process.argv.slice(separator + 1) : [];
  const args = passthrough.length > 0 ? passthrough : ["app-server"];
  const child = spawn(command, args, {
    cwd: config.project_root,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  process.stdin.pipe(child.stdin);
  child.stderr.pipe(process.stderr);
  const pending = new Set();
  let observationChain = Promise.resolve();
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    process.stdout.write(`${line}\n`);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const operation = observationChain.then(() => adapter.handle(message)).catch(() => {
      process.stderr.write("SuperMemory App Server capture degraded.\n");
    });
    observationChain = operation;
    pending.add(operation);
    operation.finally(() => pending.delete(operation));
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  await Promise.allSettled([...pending]);
  process.exitCode = exitCode;
} catch (error) {
  process.stderr.write(`SuperMemory App Server failed: ${error?.message ?? "unknown"}\n`);
  process.exitCode = 1;
}
