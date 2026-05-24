import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

function runVerifier() {
  return spawnSync("node", ["scripts/verify-golden-end-state-workflow.mjs", "--json"], {
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

function parseJson(result) {
  assert.equal(result.status, 0, `verifier failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const result = runVerifier();
const report = parseJson(result);
const serialized = JSON.stringify(report);

assert.equal(report.status, "pass");
assert.equal(report.mode, "golden-end-state-workflow");
assert.equal(report.live_writes_performed, false);
assert.equal(report.network_writes, false);
assert.equal(report.cloud_fallback_allowed, false);
assert.equal(report.operator_usable_locally, true);
assert.equal(serialized.includes("sk-test-secret"), false);
assert.equal(serialized.includes("api.hindsight.vectorize.io"), false);

const requiredPhases = [
  "capture",
  "snapshot",
  "llm_first_interpretation",
  "staging_review",
  "governed_promotion",
  "local_hindsight_preflight",
  "recall",
  "governed_answer",
  "refresh_change",
  "audit"
];
assert.deepEqual(report.phases.map((phase) => phase.id), requiredPhases);
for (const phase of report.phases) {
  assert.equal(phase.status, "pass", `${phase.id} should pass`);
  assert.ok(Array.isArray(phase.evidence) && phase.evidence.length > 0, `${phase.id} should cite evidence`);
}

const requiredCommands = [
  "node scripts/verify-local-manual-capture-workflow.mjs",
  "node scripts/verify-local-file-source-refresh-workflow.mjs",
  "node scripts/verify-hindsight-local-live-smoke-preflight.mjs",
  "node scripts/verify-hindsight-live-smoke-runner.mjs",
  "node scripts/verify-governed-answer-evidence.mjs",
  "node scripts/verify-enterprise-living-memory-complete.mjs"
];
for (const command of requiredCommands) {
  assert.ok(report.required_commands.includes(command), `missing required command ${command}`);
}

assert.ok(report.failure_modes.includes("missing_live_env_blocks_live_write"));
assert.ok(report.failure_modes.includes("non_local_hindsight_endpoint_blocked"));
assert.ok(report.failure_modes.includes("revoked_memory_not_active"));
assert.ok(report.failure_modes.includes("unavailable_source_not_fresh"));
assert.ok(report.docs.includes("README.md"));
assert.ok(report.docs.includes("docs/golden-end-state-operator-workflow.md"));

const globalVerifier = fs.readFileSync("scripts/verify-supermemory-specs.mjs", "utf8");
assert.ok(globalVerifier.includes("scripts/verify-golden-end-state-workflow.mjs"));
