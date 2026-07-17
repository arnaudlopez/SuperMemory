import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(args) {
  return spawnSync("node", ["scripts/verify-supermemory-production-readiness.mjs", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "",
      HINDSIGHT_BANK_ID: "",
      HINDSIGHT_BASE_URL: "",
      SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: "",
      SUPERMEMORY_ALLOW_HINDSIGHT_CLOUD: ""
    }
  });
}

function parseReport(result) {
  assert.ok(result.stdout.trim(), `missing JSON report\nSTDERR:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const missingEvidence = path.resolve("tmp/production-readiness-test-missing-evidence.jsonl");
assert.equal(fs.existsSync("scripts/verify-supermemory-production-readiness.mjs"), true);

const operator = spawnSync("node", ["scripts/supermemory-operator.mjs", "--json"], { encoding: "utf8" });
assert.equal(operator.status, 0);
assert.match(operator.stdout, /verify-supermemory-production-readiness\.mjs/);

const missingApproval = run(["--evidence-path", missingEvidence, "--json"]);
assert.notEqual(missingApproval.status, 0);
const missingApprovalReport = parseReport(missingApproval);
assert.equal(missingApprovalReport.status, "fail");
assert.equal(missingApprovalReport.mode, "production-readiness");
assert.equal(missingApprovalReport.production_ready, false);
assert.equal(missingApprovalReport.runtime_check_performed, false);
assert.deepEqual(missingApprovalReport.approval.missing, [
  "owner_approval",
  "approval_reference",
  "deployment_scope",
  "rollback_acknowledgement"
]);

const invalidScope = run([
  "--evidence-path", missingEvidence,
  "--owner-approved",
  "--approval-reference", "owner-approval-test",
  "--deployment-scope", "hosted-saas",
  "--rollback-acknowledged",
  "--json"
]);
assert.notEqual(invalidScope.status, 0);
const invalidScopeReport = parseReport(invalidScope);
assert.equal(invalidScopeReport.production_ready, false);
assert.equal(invalidScopeReport.runtime_check_performed, false);
assert.deepEqual(invalidScopeReport.approval.missing, ["deployment_scope"]);

const missingRuntime = run([
  "--evidence-path", missingEvidence,
  "--owner-approved",
  "--approval-reference", "owner-approval-test",
  "--deployment-scope", "local-first-operator",
  "--rollback-acknowledged",
  "--json"
]);
assert.notEqual(missingRuntime.status, 0);
const missingRuntimeReport = parseReport(missingRuntime);
assert.equal(missingRuntimeReport.approval.requirements_met, true);
assert.equal(missingRuntimeReport.runtime_check_performed, true);
assert.equal(missingRuntimeReport.runtime_ready, false);
assert.equal(missingRuntimeReport.production_ready, false);
assert.equal(missingRuntimeReport.production_decision, "denied_runtime_not_ready");
assert.equal(missingRuntimeReport.live_writes_performed_by_this_check, false);
assert.equal(JSON.stringify(missingRuntimeReport).includes("Bearer "), false);
