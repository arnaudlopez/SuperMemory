#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const requiredScope = "local-first-operator";

function parseArgs(argv) {
  const options = {
    json: false,
    evidencePath: process.env.SUPERMEMORY_LIVE_SMOKE_EVIDENCE_PATH || "tmp/hindsight-live-smoke-local.jsonl",
    maxAgeHours: 24,
    ownerApproved: false,
    approvalReference: null,
    deploymentScope: null,
    rollbackAcknowledged: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--evidence-path") options.evidencePath = argv[++index];
    else if (arg === "--max-age-hours") options.maxAgeHours = Number(argv[++index]);
    else if (arg === "--owner-approved") options.ownerApproved = true;
    else if (arg === "--approval-reference") options.approvalReference = argv[++index];
    else if (arg === "--deployment-scope") options.deploymentScope = argv[++index];
    else if (arg === "--rollback-acknowledged") options.rollbackAcknowledged = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.evidencePath) throw new Error("missing evidence path");
  if (!Number.isFinite(options.maxAgeHours) || options.maxAgeHours <= 0) throw new Error("invalid max age hours");
  return options;
}

function validApprovalReference(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$/.test(value) &&
    !/(?:sk-|ghp_|github_pat_|password|api[_-]?key|secret)/i.test(value)
  );
}

function approvalState(options, decidedAt) {
  const missing = [];
  if (!options.ownerApproved) missing.push("owner_approval");
  if (!validApprovalReference(options.approvalReference)) missing.push("approval_reference");
  if (options.deploymentScope !== requiredScope) missing.push("deployment_scope");
  if (!options.rollbackAcknowledged) missing.push("rollback_acknowledgement");
  return {
    owner_approved: options.ownerApproved,
    approval_reference: validApprovalReference(options.approvalReference) ? options.approvalReference : null,
    deployment_scope: options.deploymentScope,
    required_scope: requiredScope,
    rollback_acknowledged: options.rollbackAcknowledged,
    requirements_met: missing.length === 0,
    missing,
    decided_at: decidedAt
  };
}

function runRuntimeReadiness(options) {
  const result = spawnSync("node", [
    "scripts/verify-supermemory-runtime-readiness.mjs",
    "--evidence-path", path.resolve(options.evidencePath),
    "--max-age-hours", String(options.maxAgeHours),
    "--json"
  ], {
    encoding: "utf8",
    env: process.env
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // Invalid output is represented as a failed runtime gate.
  }
  return {
    ok: result.status === 0 && report?.runtime_ready === true,
    exit_code: result.status,
    report,
    error: report ? null : result.stderr.trim() || "invalid_runtime_readiness_output"
  };
}

function reportWithoutRuntime(options, approval, decidedAt) {
  return {
    status: "fail",
    mode: "production-readiness",
    readiness_level: "not-ready",
    contract_ready: null,
    runtime_ready: false,
    production_ready: false,
    production_decision: "denied_approval_requirements",
    decided_at: decidedAt,
    runtime_check_performed: false,
    live_writes_performed_by_this_check: false,
    approval
  };
}

function reportWithRuntime(runtime, approval, decidedAt) {
  const runtimeReport = runtime.report;
  const evidenceGeneratedAt = runtimeReport?.live_evidence?.generated_at ?? null;
  const evidenceTime = Date.parse(evidenceGeneratedAt);
  const decisionTime = Date.parse(decidedAt);
  const approvalAfterEvidence = Number.isFinite(evidenceTime) && Number.isFinite(decisionTime) && decisionTime >= evidenceTime;
  const runtimeReady = runtime.ok && approvalAfterEvidence;
  const productionReady = approval.requirements_met && runtimeReady;
  return {
    status: productionReady ? "pass" : "fail",
    mode: "production-readiness",
    readiness_level: productionReady
      ? "production-ready"
      : runtimeReport?.runtime_ready
        ? "runtime-ready"
        : runtimeReport?.contract_ready
          ? "contract-ready"
          : "not-ready",
    contract_ready: runtimeReport?.contract_ready === true,
    runtime_ready: runtimeReady,
    production_ready: productionReady,
    production_decision: productionReady ? "approved" : "denied_runtime_not_ready",
    decided_at: decidedAt,
    runtime_check_performed: true,
    live_writes_performed_by_this_check: false,
    approval: {
      ...approval,
      after_live_evidence: approvalAfterEvidence
    },
    runtime: {
      ok: runtime.ok,
      exit_code: runtime.exit_code,
      status: runtimeReport?.status ?? "invalid",
      preflight_status: runtimeReport?.preflight?.status ?? "invalid",
      preflight_blockers: runtimeReport?.preflight?.blockers ?? [],
      live_evidence: runtimeReport?.live_evidence ?? null,
      error: runtime.error
    }
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const decidedAt = new Date().toISOString();
  const approval = approvalState(options, decidedAt);
  const report = approval.requirements_met
    ? reportWithRuntime(runRuntimeReadiness(options), approval, decidedAt)
    : reportWithoutRuntime(options, approval, decidedAt);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`${report.status.toUpperCase()} supermemory production readiness\n`);
    process.stdout.write(`readiness_level=${report.readiness_level}\n`);
  }
  if (!report.production_ready) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
