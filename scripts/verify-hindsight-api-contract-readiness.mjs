#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const assertionsPath = path.join(root, "identity-vault/90_evals/cases/hindsight-api-contract-readiness/expected/assertions.json");

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
  return spawnSync("node", ["scripts/hindsight-api-contract-readiness.mjs", "--json"], {
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
    fail(`contract readiness script failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    return;
  }
  if (result.stdout.includes("fake-key-for-contract-check") || result.stderr.includes("fake-key-for-contract-check")) {
    fail("contract readiness output leaked the fake API key");
  }

  const report = JSON.parse(result.stdout);
  requireEqual(report.status, assertions.required_status, "status");
  requireEqual(report.live_writes_performed, false, "live_writes_performed");
  requireEqual(report.fake_credentials_only, true, "fake_credentials_only");

  const sourceIds = report.contract_sources.map((source) => source.id);
  for (const sourceId of assertions.required_contract_source_ids) {
    requireIncludes(sourceIds, sourceId, "contract source id");
  }

  const checkIds = report.checks.map((check) => check.id);
  for (const checkId of assertions.required_check_ids) {
    requireIncludes(checkIds, checkId, "check id");
  }

  for (const check of report.checks) {
    requireEqual(check.status, "pass", `${check.id} status`);
    if (check.errors.length !== 0) {
      fail(`${check.id} has errors: ${check.errors.join(", ")}`);
    }
  }

  const retain = report.checks.find((check) => check.id === "retain");
  const upsert = report.checks.find((check) => check.id === "upsert");
  const deletion = report.checks.find((check) => check.id === "delete");
  requireEqual(retain?.requests.some((request) => request.path.endsWith("/memories")), true, "retain /memories path");
  requireEqual(upsert?.requests.some((request) => request.path.endsWith("/memories")), true, "upsert /memories path");
  requireEqual(deletion?.requests.some((request) => request.method === "DELETE" && request.path.includes("/documents/")), true, "delete /documents path");

  for (const check of [retain, upsert]) {
    const recall = check?.requests.find((request) => request.operation === "recall");
    requireEqual(recall?.tags_match, assertions.required_recall_tags_match, `${check?.id} recall tags_match`);
  }

  for (const envName of assertions.required_owner_live_env) {
    requireIncludes(report.required_owner_live_env, envName, "required owner live env");
  }
}

const assertions = readJson(assertionsPath);
verifyReport(runReadiness(), assertions);

if (!process.exitCode) {
  console.log("PASS hindsight-api-contract-readiness: transport contract is strict and ready for owner live smoke");
}
