#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const assertionsPath = path.join(root, "identity-vault/90_evals/cases/hindsight-live-smoke-readiness/expected/assertions.json");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: expected ${expected}, got ${actual}`);
  }
}

function requireIncludes(items, expected, message) {
  if (!Array.isArray(items) || !items.includes(expected)) {
    fail(`${message}: expected ${expected}`);
  }
}

function runReadiness() {
  return spawnSync("node", ["scripts/hindsight-live-smoke-readiness.mjs", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "",
      HINDSIGHT_BANK_ID: "",
      HINDSIGHT_BASE_URL: "",
      SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: ""
    }
  });
}

function verifyReport(result, assertions) {
  if (result.status !== 0) {
    fail(`readiness script failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    return;
  }
  if (result.stdout.includes("sk-test-secret") || result.stderr.includes("sk-test-secret")) {
    fail("readiness output leaked a fake API key");
  }

  const report = JSON.parse(result.stdout);
  requireEqual(report.status, assertions.required_status, "status");
  requireEqual(report.live_writes_performed, assertions.required_live_writes_performed, "live_writes_performed");
  requireEqual(report.guard_check?.passed, true, "guard_check passed");
  requireEqual(report.guard_check?.error, assertions.required_guard_error, "guard_check error");

  for (const key of assertions.required_env_keys) {
    if (!Object.hasOwn(report.env, key)) {
      fail(`missing env key ${key}`);
    }
    if (!["set", "not_set"].includes(report.env[key])) {
      fail(`env ${key} must be redacted set/not_set`);
    }
  }

  const caseIds = report.smoke_cases.map((item) => item.id);
  for (const caseId of assertions.required_case_ids) {
    requireIncludes(caseIds, caseId, "case id");
  }

  const mockCommands = report.smoke_cases.map((item) => item.mock_verifier_command);
  for (const command of assertions.required_mock_commands) {
    requireIncludes(mockCommands, command, "mock verifier command");
  }

  const liveCommands = report.smoke_cases.map((item) => item.manual_live_command);
  for (const command of assertions.required_live_commands) {
    requireIncludes(liveCommands, command, "manual live command");
  }

  for (const smokeCase of report.smoke_cases) {
    requireEqual(smokeCase.mock_status, "pass", `${smokeCase.id} mock_status`);
    requireEqual(smokeCase.live_command_executes_in_readiness, false, `${smokeCase.id} live execution flag`);
  }
}

const assertions = readJson(assertionsPath);
verifyReport(runReadiness(), assertions);

if (!process.exitCode) {
  console.log("PASS hindsight-live-smoke-readiness: manual live smoke report is complete and non-live");
}
