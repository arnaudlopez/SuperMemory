#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const commands = [
  ["node", ["scripts/verify-identity-vault-tdd.mjs"]],
  ["node", ["scripts/verify-enterprise-living-memory-target.mjs"]]
];

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

for (const [cmd, args] of commands) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    fail(`${cmd} ${args.join(" ")} exited with ${result.status}`);
  }
}

for (const file of [
  "identity-vault/80_logs/hindsight_promotions.jsonl",
  "identity-vault/80_logs/source_changes.jsonl",
  "identity-vault/60_signals/actions.jsonl",
  "identity-vault/60_signals/availability.jsonl",
  "identity-vault/60_signals/relationships.jsonl"
]) {
  if (!fs.existsSync(file)) {
    fail(`missing jsonl file: ${file}`);
    continue;
  }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    try {
      JSON.parse(line);
    } catch (error) {
      fail(`${file}:${index + 1} is not valid JSON: ${error.message}`);
    }
  }
}

if (!process.exitCode) {
  console.log("PASS supermemory specs");
}
