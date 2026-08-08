#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";

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

function checkRuntimeReadinessSurface() {
  const scriptCheck = textIncludes("scripts/verify-supermemory-runtime-readiness.mjs", [
    "runtime-ready",
    "production_ready",
    "--require-ready",
    "live_evidence_stale_or_invalid"
  ]);
  const preflightCheck = textIncludes("scripts/hindsight-local-live-smoke-preflight.mjs", ["--require-ready"]);
  const missing = [...scriptCheck.missing, ...preflightCheck.missing];
  return {
    id: "runtime_readiness_surface",
    status: missing.length === 0 ? "pass" : "fail",
    files: [
      "scripts/verify-supermemory-runtime-readiness.mjs",
      "scripts/hindsight-local-live-smoke-preflight.mjs"
    ],
    missing
  };
}

function checkProductionReadinessSurface() {
  const scriptCheck = textIncludes("scripts/verify-supermemory-production-readiness.mjs", [
    "production-ready",
    "owner_approval",
    "approval_reference",
    "local-first-operator",
    "rollback_acknowledgement",
    "verify-supermemory-runtime-readiness.mjs"
  ]);
  const operatorCheck = textIncludes("scripts/supermemory-operator.mjs", [
    "verify-supermemory-production-readiness.mjs"
  ]);
  const runbookCheck = textIncludes("docs/production-runbook.md", [
    "Production Approval",
    "--owner-approved",
    "--approval-reference",
    "--rollback-acknowledged"
  ]);
  const missing = [...scriptCheck.missing, ...operatorCheck.missing, ...runbookCheck.missing];
  return {
    id: "production_readiness_surface",
    status: missing.length === 0 ? "pass" : "fail",
    files: [
      "scripts/verify-supermemory-production-readiness.mjs",
      "scripts/supermemory-operator.mjs",
      "docs/production-runbook.md"
    ],
    missing
  };
}

function checkTrackedSecretHygiene() {
  const result = spawnSync("node", ["scripts/verify-secret-hygiene.mjs", "--json"], {
    cwd: root,
    encoding: "utf8"
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // Invalid output is a failed hygiene check.
  }
  return {
    id: "tracked_secret_hygiene",
    status: result.status === 0 && report?.status === "pass" ? "pass" : "fail",
    tracked_tmp: report?.tracked_tmp ?? [],
    secret_like_files: [...new Set((report?.findings ?? []).map((finding) => finding.file))],
    findings: report?.findings ?? [],
    error: report ? null : result.stderr.trim() || "invalid secret hygiene output"
  };
}

const checks = [
  runCommand("memory_fabric_v22", "npm", ["run", "verify:memory-fabric-v22"]),
  runCommand("memory_fabric_v2", "node", [
    "--test",
    "tests/memory-fabric-v2-acceptance.test.mjs",
    "tests/memory-fabric-v2-e2e.test.mjs",
    "tests/memory-fabric-v2-performance.test.mjs"
  ]),
  runCommand("memory_fabric_v2_matrix", "node", ["scripts/verify-memory-fabric-v2.mjs"]),
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
  checkRuntimeReadinessSurface(),
  checkProductionReadinessSurface(),
  checkTrackedSecretHygiene()
];

const failed = checks.filter((check) => check.status !== "pass");
const report = {
  status: failed.length === 0 ? "pass" : "fail",
  mode: "release-readiness",
  readiness_level: failed.length === 0 ? "contract-ready" : "not-ready",
  contract_ready: failed.length === 0,
  runtime_ready: false,
  production_ready: false,
  production_decision: "requires_runtime_readiness_and_explicit_operator_approval",
  live_writes_performed: false,
  credentials_required: false,
  ci_mock_only: true,
  no_implicit_cloud_fallback: true,
  no_tracked_tmp_evidence: checks.find((check) => check.id === "tracked_secret_hygiene")?.tracked_tmp?.length === 0,
  no_tracked_secret_like_values: checks.find((check) => check.id === "tracked_secret_hygiene")?.secret_like_files?.length === 0,
  limitations: [
    "CI and this release gate are mock-only.",
    "Run verify-supermemory-runtime-readiness.mjs with fresh live evidence before runtime approval.",
    "Production approval remains an explicit operator decision."
  ],
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
