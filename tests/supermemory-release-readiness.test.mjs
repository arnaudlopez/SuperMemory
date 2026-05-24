import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

function runNode(args) {
  return spawnSync("node", args, {
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

function parseJson(result, label) {
  assert.equal(result.status, 0, `${label} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const requiredFiles = [
  "scripts/verify-supermemory-release-readiness.mjs",
  "scripts/supermemory-operator.mjs",
  "docs/production-runbook.md"
];

for (const filePath of requiredFiles) {
  assert.equal(fs.existsSync(filePath), true, `missing production readiness file: ${filePath}`);
}

const operator = parseJson(runNode(["scripts/supermemory-operator.mjs", "--json"]), "operator workflow");
assert.equal(operator.status, "pass");
assert.equal(operator.network_writes_performed, false);
assert.equal(operator.credentials_required, false);
assert.equal(operator.default_runtime_target, "local_hindsight_docker");
assert.equal(operator.cloud_hindsight_default, false);
assert.deepEqual(
  operator.phases.map((phase) => phase.id),
  [
    "release_preflight",
    "manual_capture",
    "local_file_refresh",
    "local_hindsight_preflight",
    "reviewed_hindsight_promotion",
    "smoke",
    "audit",
    "rollback"
  ]
);

const commandText = operator.phases.flatMap((phase) => phase.commands ?? []).join("\n");
for (const requiredCommand of [
  "node scripts/verify-supermemory-release-readiness.mjs",
  "node scripts/local-manual-capture.mjs",
  "node scripts/local-file-source-refresh.mjs",
  "node scripts/hindsight-local-live-smoke-preflight.mjs --json",
  "node scripts/hindsight-promote.mjs --input",
  "node scripts/hindsight-promote.mjs --apply-plan",
  "node scripts/hindsight-live-smoke-runner.mjs --mock-transport",
  "git revert"
]) {
  assert.match(commandText, new RegExp(requiredCommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `operator missing command: ${requiredCommand}`);
}

const release = parseJson(runNode(["scripts/verify-supermemory-release-readiness.mjs", "--json"]), "release readiness");
assert.equal(release.status, "pass");
assert.equal(release.mode, "release-readiness");
assert.equal(release.live_writes_performed, false);
assert.equal(release.credentials_required, false);
assert.equal(release.ci_mock_only, true);
assert.equal(release.no_implicit_cloud_fallback, true);
assert.equal(release.no_tracked_tmp_evidence, true);
assert.equal(release.no_tracked_secret_like_values, true);

const checkIds = new Set(release.checks.map((check) => check.id));
for (const checkId of [
  "global_specs",
  "golden_end_state_workflow",
  "manual_capture_workflow",
  "local_file_refresh_workflow",
  "hindsight_reviewed_promotion",
  "hindsight_live_smoke_mock",
  "hindsight_local_preflight",
  "hindsight_docker_compose",
  "operator_workflow",
  "production_runbook",
  "ci_release_gate",
  "tracked_secret_hygiene"
]) {
  assert.equal(checkIds.has(checkId), true, `release verifier missing check: ${checkId}`);
}

const readme = fs.readFileSync("README.md", "utf8");
assert.match(readme, /docs\/production-runbook\.md/, "README must link the production runbook");

const runbook = fs.readFileSync("docs/production-runbook.md", "utf8");
for (const requiredText of [
  "node scripts/verify-supermemory-release-readiness.mjs",
  "compose.hindsight.yml",
  "SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1",
  "Hindsight Cloud",
  "reviewed promotion plan",
  "rollback",
  "observability",
  "non-goals"
]) {
  assert.match(runbook, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `runbook missing: ${requiredText}`);
}

const workflow = fs.readFileSync(".github/workflows/supermemory-specs.yml", "utf8");
assert.match(workflow, /node scripts\/verify-supermemory-release-readiness\.mjs/, "CI must run release readiness verifier");
