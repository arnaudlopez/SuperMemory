#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createCodexWorkspaceStore } from "./lib/codex-workspace-store.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function secureConfig(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    fail("review_config_insecure");
  }
  const config = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (
    config?.schema !== "supermemory.review-runtime.v1" ||
    !config.vault_root ||
    !config.workspace_id ||
    !config.project_id
  ) fail("review_config_invalid");
  return config;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requireConfirmation(target) {
  if (argument("--confirm") !== target) fail("exact_confirmation_required");
}

try {
  const configPath = argument("--config");
  if (!configPath) fail("review_config_required");
  const config = secureConfig(configPath);
  const store = createCodexWorkspaceStore({
    vaultRoot: config.vault_root,
    workspaceId: config.workspace_id,
    projectId: config.project_id,
    admissionMode: config.admission?.mode === "automatic" ? "automatic" : "legacy_manual"
  });
  const commandIndex = process.argv.indexOf("--config") + 2;
  const command = process.argv[commandIndex] ?? "list";
  const target = process.argv[commandIndex + 1] ?? null;
  let result;
  if (command === "list") {
    const automatic = config.admission?.mode === "automatic";
    result = {
      workspace_id: config.workspace_id,
      mode: automatic ? "exceptions" : "legacy_review",
      candidates: store.listCandidates({
        status: argument("--status") ?? (automatic ? "quarantined" : null)
      }),
      active_memories: store.listActiveMemories({ consumer: "supermemory" })
    };
  } else if (command === "approve") {
    requireConfirmation(target);
    result = await store.reviewCandidate(target, {
      action: "approve",
      approvedBy: "local_owner",
      title: argument("--title"),
      text: argument("--text")
    });
  } else if (command === "reject") {
    requireConfirmation(target);
    result = await store.reviewCandidate(target, {
      action: "reject",
      approvedBy: "local_owner"
    });
  } else if (command === "revoke") {
    requireConfirmation(target);
    result = await store.revokeMemory(target, {
      reason: argument("--reason"),
      revokedBy: "local_owner"
    });
  } else {
    fail("review_command_invalid");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`SuperMemory review failed: ${error?.code ?? error?.message ?? "unknown"}\n`);
  process.exitCode = 1;
}
