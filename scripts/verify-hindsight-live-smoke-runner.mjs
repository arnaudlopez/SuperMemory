#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const assertionsPath = path.join(root, "identity-vault/90_evals/cases/hindsight-live-smoke-runner/expected/assertions.json");

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

function runRunner(args, env = {}) {
  return spawnSync("node", ["scripts/hindsight-live-smoke-runner.mjs", ...args], {
    cwd: root,
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

function verifyMockReport(assertions) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-live-smoke-runner-"));
  const evidencePath = path.join(tmpDir, "evidence.jsonl");
  const result = runRunner(["--mock-transport", "--json", "--evidence-path", evidencePath]);
  if (result.status !== 0) {
    fail(`mock runner failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    return;
  }
  if (result.stdout.includes("fake-live-smoke-key")) {
    fail("mock runner leaked fake API key");
  }

  const report = JSON.parse(result.stdout);
  requireEqual(report.status, "pass", "mock status");
  requireEqual(report.mode, "mock", "mode");
  requireEqual(report.live_writes_performed, false, "live_writes_performed");
  requireEqual(report.secrets_redacted, true, "secrets_redacted");
  requireEqual(fs.existsSync(evidencePath), true, "evidence file exists");

  const evidenceLines = fs.readFileSync(evidencePath, "utf8").trim().split(/\r?\n/);
  requireEqual(evidenceLines.length, 1, "evidence line count");
  if (evidenceLines[0].includes("fake-live-smoke-key")) {
    fail("evidence file leaked fake API key");
  }

  const caseIds = report.cases.map((item) => item.id);
  for (const caseId of assertions.required_case_ids) {
    requireIncludes(caseIds, caseId, "case id");
  }
  for (const smokeCase of report.cases) {
    requireEqual(smokeCase.status, "pass", `${smokeCase.id} status`);
    requireEqual(smokeCase.mode, "mock", `${smokeCase.id} mode`);
    requireEqual(smokeCase.network_writes, false, `${smokeCase.id} network_writes`);
  }

  const requestOperations = report.cases.flatMap((item) => item.requests.map((request) => request.operation));
  for (const operation of assertions.required_operations) {
    requireIncludes(requestOperations, operation, "request operation");
  }

  for (const [caseId, setupAssertion] of Object.entries(assertions.required_setup_cases ?? {})) {
    const smokeCase = report.cases.find((item) => item.id === caseId);
    requireEqual(smokeCase?.setup_required, true, `${caseId} setup_required`);
    requireEqual(smokeCase?.target_document_id, setupAssertion.target_document_id, `${caseId} target_document_id`);
    requireEqual(smokeCase?.setup?.status, "pass", `${caseId} setup status`);
    requireEqual(smokeCase?.setup?.target_document_id, setupAssertion.target_document_id, `${caseId} setup target_document_id`);
    requireEqual(
      smokeCase?.setup?.requests?.some((request) => (
        request.operation === setupAssertion.setup_operation &&
        request.document_id === setupAssertion.target_document_id
      )),
      true,
      `${caseId} setup retain request`
    );
    requireEqual(
      smokeCase?.requests?.some((request) => (
        request.operation === setupAssertion.case_operation &&
        request.document_id === setupAssertion.target_document_id
      )),
      true,
      `${caseId} delete request`
    );
  }
}

function verifyLiveGuard(assertions) {
  const result = runRunner(["--execute-live", "--json"]);
  requireEqual(result.status, 1, "missing-env live runner exit");
  const report = JSON.parse(result.stdout);
  requireEqual(report.status, "blocked_missing_live_env", "missing-env status");
  for (const envName of assertions.required_missing_env) {
    requireIncludes(report.missing_env, envName, "missing env");
  }
}

const assertions = readJson(assertionsPath);
verifyMockReport(assertions);
verifyLiveGuard(assertions);

if (!process.exitCode) {
  console.log("PASS hindsight-live-smoke-runner: mock evidence works and live execution blocks without env");
}
