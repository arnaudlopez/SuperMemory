#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const options = {
  json: process.argv.includes("--json")
};

const requiredRunbookSnippets = [
  "node scripts/verify-supermemory-release-readiness.mjs",
  "node scripts/supermemory-onboard.mjs",
  "compose.hindsight.yml",
  "SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1",
  "Hindsight Cloud",
  "reviewed promotion plan",
  "rollback",
  "observability",
  "non-goals"
];

function runCommand(id, command, args) {
  const result = spawnSync(command, args, {
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
  return {
    id,
    status: result.status === 0 ? "pass" : "fail",
    command: `${command} ${args.join(" ")}`,
    stdout_tail: result.stdout.trim().split(/\r?\n/).slice(-5),
    stderr_tail: result.stderr.trim().split(/\r?\n/).slice(-5)
  };
}

function textIncludes(filePath, snippets) {
  if (!fs.existsSync(filePath)) {
    return { status: "fail", missing: [`missing file: ${filePath}`] };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const missing = snippets.filter((snippet) => !text.includes(snippet));
  return { status: missing.length === 0 ? "pass" : "fail", missing };
}

function checkOperatorWorkflow() {
  const result = spawnSync("node", ["scripts/supermemory-operator.mjs", "--json"], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return {
      id: "operator_workflow",
      status: "fail",
      command: "node scripts/supermemory-operator.mjs --json",
      stderr_tail: result.stderr.trim().split(/\r?\n/).slice(-5)
    };
  }
  const report = JSON.parse(result.stdout);
  const requiredPhases = [
    "release_preflight",
    "manual_capture",
    "local_file_refresh",
    "local_hindsight_preflight",
    "reviewed_hindsight_promotion",
    "smoke",
    "audit",
    "rollback"
  ];
  const phaseIds = new Set((report.phases ?? []).map((phase) => phase.id));
  const missing = requiredPhases.filter((phaseId) => !phaseIds.has(phaseId));
  const failClosed = (
    report.network_writes_performed === false &&
    report.credentials_required === false &&
    report.default_runtime_target === "local_hindsight_docker" &&
    report.cloud_hindsight_default === false
  );
  return {
    id: "operator_workflow",
    status: missing.length === 0 && failClosed ? "pass" : "fail",
    command: "node scripts/supermemory-operator.mjs --json",
    missing,
    fail_closed_defaults: failClosed
  };
}

function checkRunbook() {
  const result = textIncludes("docs/production-runbook.md", requiredRunbookSnippets);
  return {
    id: "production_runbook",
    status: result.status,
    file: "docs/production-runbook.md",
    missing: result.missing
  };
}

function checkCiReleaseGate() {
  const result = textIncludes(".github/workflows/supermemory-specs.yml", [
    "node scripts/verify-supermemory-release-readiness.mjs"
  ]);
  return {
    id: "ci_release_gate",
    status: result.status,
    file: ".github/workflows/supermemory-specs.yml",
    missing: result.missing
  };
}

function checkReadmeRunbookLink() {
  const result = textIncludes("README.md", ["docs/production-runbook.md"]);
  return {
    id: "readme_runbook_link",
    status: result.status,
    file: "README.md",
    missing: result.missing
  };
}

function gitLsFiles(args) {
  const result = spawnSync("git", ["ls-files", ...args], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function checkTrackedSecretHygiene() {
  const tracked = gitLsFiles([]);
  const trackedTmp = tracked.filter((filePath) => filePath.startsWith("tmp/"));
  const secretPattern = /(sk-proj-[A-Za-z0-9_-]{12,}|sk-live-[A-Za-z0-9_-]{12,}|HINDSIGHT_API_KEY\s*=\s*["']?(?!<|\.{3}|fake|test)[A-Za-z0-9_-]{16,})/;
  const offenders = [];
  for (const filePath of tracked) {
    if (!/\.(mjs|md|yml|yaml|json|jsonl|gitignore)$/.test(filePath)) continue;
    const fullPath = path.join(root, filePath);
    if (!fs.existsSync(fullPath)) continue;
    const text = fs.readFileSync(fullPath, "utf8");
    if (secretPattern.test(text)) offenders.push(filePath);
  }
  return {
    id: "tracked_secret_hygiene",
    status: trackedTmp.length === 0 && offenders.length === 0 ? "pass" : "fail",
    tracked_tmp: trackedTmp,
    secret_like_files: offenders
  };
}

const checks = [
  runCommand("client_onboarding", "node", ["scripts/verify-supermemory-onboarding.mjs"]),
  runCommand("global_specs", "node", ["scripts/verify-supermemory-specs.mjs"]),
  runCommand("golden_end_state_workflow", "node", ["scripts/verify-golden-end-state-workflow.mjs"]),
  runCommand("manual_capture_workflow", "node", ["scripts/verify-local-manual-capture-workflow.mjs"]),
  runCommand("local_file_refresh_workflow", "node", ["scripts/verify-local-file-source-refresh-workflow.mjs"]),
  runCommand("hindsight_reviewed_promotion", "node", ["--test", "tests/hindsight-promote.test.mjs"]),
  runCommand("hindsight_live_smoke_mock", "node", ["scripts/verify-hindsight-live-smoke-runner.mjs"]),
  runCommand("hindsight_local_preflight", "node", ["scripts/verify-hindsight-local-live-smoke-preflight.mjs"]),
  runCommand("hindsight_docker_compose", "node", ["scripts/verify-hindsight-docker-compose.mjs"]),
  checkOperatorWorkflow(),
  checkRunbook(),
  checkReadmeRunbookLink(),
  checkCiReleaseGate(),
  checkTrackedSecretHygiene()
];

const failed = checks.filter((check) => check.status !== "pass");
const report = {
  status: failed.length === 0 ? "pass" : "fail",
  mode: "release-readiness",
  live_writes_performed: false,
  credentials_required: false,
  ci_mock_only: true,
  no_implicit_cloud_fallback: true,
  no_tracked_tmp_evidence: checks.find((check) => check.id === "tracked_secret_hygiene")?.tracked_tmp?.length === 0,
  no_tracked_secret_like_values: checks.find((check) => check.id === "tracked_secret_hygiene")?.secret_like_files?.length === 0,
  checks
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  for (const check of checks) {
    process.stdout.write(`${check.status.toUpperCase()} ${check.id}\n`);
  }
  process.stdout.write(`${report.status.toUpperCase()} supermemory release readiness\n`);
}

if (report.status !== "pass") {
  process.exitCode = 1;
}
