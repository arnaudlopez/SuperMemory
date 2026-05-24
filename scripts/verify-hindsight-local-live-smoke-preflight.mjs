#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function runPreflight(env = {}) {
  return spawnSync("node", ["scripts/hindsight-local-live-smoke-preflight.mjs", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "",
      HINDSIGHT_BANK_ID: "",
      HINDSIGHT_BASE_URL: "",
      SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: "",
      ...env
    }
  });
}

function parseReport(result, label) {
  if (result.status !== 0) {
    fail(`${label} preflight exited with ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    return null;
  }
  if (result.stdout.includes("sk-test-secret") || result.stderr.includes("sk-test-secret")) {
    fail(`${label} preflight leaked a fake API key`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`${label} preflight emitted invalid JSON: ${error.message}`);
    return null;
  }
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: expected ${expected}, got ${actual}`);
  }
}

function requireSetNotSet(value, message) {
  if (!["set", "not_set"].includes(value)) {
    fail(`${message}: expected set/not_set, got ${value}`);
  }
}

function verifyCommon(report, label) {
  if (!report) return;
  if (!["ready", "blocked"].includes(report.status)) {
    fail(`${label} status must be ready or blocked`);
  }
  requireEqual(report.mode, "local-live-preflight", `${label} mode`);
  requireEqual(report.live_writes_performed, false, `${label} live_writes_performed`);
  requireEqual(report.network_writes, false, `${label} network_writes`);
  requireEqual(report.cloud_fallback_allowed, false, `${label} cloud_fallback_allowed`);
  requireEqual(report.default_base_url, "http://127.0.0.1:8888", `${label} default_base_url`);
  requireEqual(report.live_command.includes("node scripts/hindsight-live-smoke-runner.mjs --execute-live --json"), true, `${label} live command`);
  if (JSON.stringify(report).includes("api.hindsight.vectorize.io")) {
    fail(`${label} preflight should not contain a cloud fallback URL`);
  }
  for (const key of ["HINDSIGHT_API_KEY", "HINDSIGHT_BANK_ID", "HINDSIGHT_BASE_URL", "SUPERMEMORY_ALLOW_LIVE_HINDSIGHT"]) {
    requireSetNotSet(report.env?.[key], `${label} env ${key}`);
  }
}

const blocked = parseReport(runPreflight(), "blocked");
verifyCommon(blocked, "blocked");
if (blocked && !blocked.blockers?.some((blocker) => blocker.code === "missing_live_env")) {
  fail("blocked preflight must report missing_live_env");
}

const localEnv = parseReport(runPreflight({
  HINDSIGHT_API_KEY: "sk-test-secret",
  HINDSIGHT_BANK_ID: "bank-local-smoke",
  HINDSIGHT_BASE_URL: "http://127.0.0.1:8888",
  SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: "1"
}), "local env");
verifyCommon(localEnv, "local env");
if (localEnv) {
  requireEqual(localEnv.env.HINDSIGHT_API_KEY, "set", "local env HINDSIGHT_API_KEY");
  requireEqual(localEnv.endpoint?.base_url, "http://127.0.0.1:8888", "local env endpoint");
  requireEqual(localEnv.endpoint?.is_local, true, "local env is_local");
}

if (!process.exitCode) {
  console.log("PASS hindsight-local-live-smoke-preflight: local live smoke preflight is redacted and non-live");
}
