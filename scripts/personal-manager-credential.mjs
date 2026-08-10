#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createAgentCredentialStore } from "./lib/agent-credential-store.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function options(argv) {
  const result = { operation: "status", agentId: "agent_personal_manager", deviceId: "device_home101" };
  const values = new Set(["--vault-root", "--agent-token-file", "--agent-id", "--device-id", "--confirm"]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--rotate-from-file") { result.operation = "rotate"; continue; }
    if (value === "--revoke") { result.operation = "revoke"; continue; }
    if (!values.has(value) || !argv[index + 1]) fail("credential_cli_option_invalid");
    result[value.slice(2).replaceAll("-", "_")] = argv[index + 1];
    index += 1;
  }
  if (!result.vault_root) fail("credential_cli_vault_required");
  return result;
}

function secret(file) {
  const target = path.resolve(file ?? "");
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o027) !== 0) fail("credential_cli_token_file_insecure");
  return fs.readFileSync(target, "utf8").trim();
}

try {
  const input = options(process.argv.slice(2));
  const store = createAgentCredentialStore({ vaultRoot: input.vault_root });
  let result;
  if (input.operation === "rotate") {
    if (input.confirm !== "ROTATE personal-manager credential") fail("credential_cli_confirmation_required");
    result = store.rotateTo({ token: secret(input.agent_token_file), agentId: input.agentId, deviceId: input.deviceId });
  } else if (input.operation === "revoke") {
    if (input.confirm !== "REVOKE personal-manager credential") fail("credential_cli_confirmation_required");
    result = store.revoke({ agentId: input.agentId });
  } else {
    result = store.snapshot().find((item) => item.agent_id === input.agentId) ?? { status: "not_provisioned" };
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error?.code ?? error?.message ?? "credential_cli_failed" })}\n`);
  process.exitCode = 1;
}
