#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  applyCodexHistoryImportPlan,
  buildCodexHistoryImportPlan
} from "./lib/codex-history-import.mjs";
import { resolveProjectMarkerBinding } from "./lib/project-registry.mjs";
import { createCodexSpool } from "./lib/codex-spool.mjs";
import { createSuperMemoryDaemonClient } from "./lib/supermemory-daemon.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function argument(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`history_option_missing:${name}`);
  return value;
}

function secureBytes(filePath, label) {
  const target = path.resolve(filePath);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail(`${label}_insecure`);
  return fs.readFileSync(target);
}

function key(filePath) {
  const bytes = secureBytes(filePath, "history_key");
  if (bytes.length === 32) return bytes;
  const text = bytes.toString("utf8").trim();
  const decoded = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
  if (decoded.length !== 32) fail("history_key_invalid");
  return decoded;
}

function secret(filePath, label) {
  const value = secureBytes(filePath, label).toString("utf8").trim();
  if (Buffer.byteLength(value) < 32) fail(`${label}_invalid`);
  return value;
}

function atomicJson(filePath, value) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, target);
  fs.chmodSync(target, 0o600);
}

const argv = process.argv.slice(2);
const command = argv[0];
try {
  if (!['plan', 'apply'].includes(command)) fail("history_command_invalid");
  const runtimeRoot = path.resolve(argument(argv, "--runtime-root", path.join(os.homedir(), ".supermemory/runtime/codex")));
  const historyRoot = path.resolve(argument(argv, "--history-root", path.join(os.homedir(), ".codex/sessions")));
  const planFile = path.resolve(argument(argv, "--plan-file", path.join(runtimeRoot, "history-import-plan.json")));
  const checkpointFile = path.resolve(argument(argv, "--checkpoint-file", path.join(runtimeRoot, "history-import-checkpoint.json")));
  if (command === "plan") {
    const plan = buildCodexHistoryImportPlan({
      historyRoot,
      resolveBinding: resolveProjectMarkerBinding,
      from: argument(argv, "--from"),
      to: argument(argv, "--to")
    });
    atomicJson(planFile, plan);
    process.stdout.write(`${JSON.stringify({ ok: true, plan_file: planFile, ...plan }, null, 2)}\n`);
  } else {
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const expectedPlanHash = argument(argv, "--plan-hash");
    if (!expectedPlanHash) fail("history_plan_hash_required");
    const stateKey = key(argument(argv, "--key-file", path.join(runtimeRoot, "archive.key")));
    const daemonToken = secret(
      argument(argv, "--daemon-token-file", path.join(runtimeRoot, "daemon.token")),
      "history_daemon_token"
    );
    const endpoint = argument(argv, "--daemon-endpoint", "http://127.0.0.1:8765");
    const deviceId = argument(argv, "--device-id", "device_mac-mini-m4pro");
    const clients = new Map();
    const capture = async (event) => {
      let client = clients.get(event.checkout_id);
      if (!client) {
        const checkoutToken = secret(
          path.join(os.homedir(), ".supermemory", "credentials", `${event.checkout_id}.token`),
          "history_checkout_token"
        );
        const spool = createCodexSpool({ runtimeRoot, workspaceId: event.workspace_id, encryptionKey: stateKey });
        client = createSuperMemoryDaemonClient({
          endpoint,
          authToken: daemonToken,
          encryptionKey: stateKey,
          checkoutAuth: { checkoutId: event.checkout_id, deviceId, token: checkoutToken },
          spool,
          timeoutMs: 2_000
        });
        clients.set(event.checkout_id, client);
      }
      return client.capture(event);
    };
    const result = await applyCodexHistoryImportPlan({
      plan,
      expectedPlanHash,
      capture,
      checkpointFile
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error?.code ?? error?.message ?? "history_failed" })}\n`);
  process.exitCode = 1;
}
