#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    json: false,
    evidencePath: process.env.SUPERMEMORY_LIVE_SMOKE_EVIDENCE_PATH || "tmp/hindsight-live-smoke-local.jsonl",
    maxAgeHours: 24
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--evidence-path") options.evidencePath = argv[++index];
    else if (arg === "--max-age-hours") options.maxAgeHours = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.evidencePath) throw new Error("missing evidence path");
  if (!Number.isFinite(options.maxAgeHours) || options.maxAgeHours <= 0) throw new Error("invalid max age hours");
  return options;
}

function readLatestEvidence(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { status: "missing", path: resolved };
  }
  const rows = fs.readFileSync(resolved, "utf8").split(/\r?\n/).filter(Boolean);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      return { status: "found", path: resolved, report: JSON.parse(rows[index]) };
    } catch {
      // Continue to the previous complete JSONL receipt.
    }
  }
  return { status: "invalid", path: resolved };
}

function evaluateEvidence(evidence, maxAgeHours) {
  if (evidence.status !== "found") return { ok: false, reason: `live_evidence_${evidence.status}` };
  const report = evidence.report;
  const generatedAt = Date.parse(report.generated_at);
  const ageHours = Number.isFinite(generatedAt) ? (Date.now() - generatedAt) / 3_600_000 : Number.POSITIVE_INFINITY;
  const ok = (
    report.status === "pass" &&
    report.mode === "live" &&
    report.live_writes_performed === true &&
    report.secrets_redacted === true &&
    ageHours >= 0 &&
    ageHours <= maxAgeHours
  );
  return {
    ok,
    reason: ok ? null : "live_evidence_stale_or_invalid",
    generated_at: report.generated_at ?? null,
    age_hours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
    max_age_hours: maxAgeHours,
    mode: report.mode ?? null,
    live_writes_performed: report.live_writes_performed === true,
    secrets_redacted: report.secrets_redacted === true
  };
}

function runPreflight() {
  const result = spawnSync("node", [
    "scripts/hindsight-local-live-smoke-preflight.mjs",
    "--json",
    "--require-ready"
  ], { encoding: "utf8", env: process.env });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // Report parsing is reflected in the readiness result below.
  }
  return {
    ok: result.status === 0 && report?.status === "ready",
    exit_code: result.status,
    report,
    error: report ? null : result.stderr.trim() || "invalid_preflight_output"
  };
}

function runContractReadiness() {
  const result = spawnSync("node", [
    "scripts/verify-supermemory-release-readiness.mjs",
    "--json"
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "",
      HINDSIGHT_BANK_ID: "",
      HINDSIGHT_BASE_URL: "",
      SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: ""
    }
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // Invalid output is represented as a failed contract gate below.
  }
  return {
    ok: result.status === 0 && report?.contract_ready === true,
    exit_code: result.status,
    report,
    error: report ? null : result.stderr.trim() || "invalid_contract_readiness_output"
  };
}

function buildReport(options) {
  const contract = runContractReadiness();
  const preflight = runPreflight();
  const evidence = readLatestEvidence(options.evidencePath);
  const liveEvidence = evaluateEvidence(evidence, options.maxAgeHours);
  const runtimeReady = contract.ok && preflight.ok && liveEvidence.ok;
  return {
    status: runtimeReady ? "pass" : "fail",
    mode: "runtime-readiness",
    readiness_level: runtimeReady ? "runtime-ready" : contract.ok ? "contract-ready" : "not-ready",
    contract_ready: contract.ok,
    runtime_ready: runtimeReady,
    production_ready: false,
    production_decision: "requires_explicit_operator_approval",
    live_writes_performed_by_this_check: false,
    contract: {
      ok: contract.ok,
      exit_code: contract.exit_code,
      status: contract.report?.status ?? "invalid",
      failed_checks: (contract.report?.checks ?? [])
        .filter((check) => check.status !== "pass")
        .map((check) => check.id),
      error: contract.error
    },
    preflight: {
      ok: preflight.ok,
      exit_code: preflight.exit_code,
      status: preflight.report?.status ?? "invalid",
      blockers: preflight.report?.blockers ?? [],
      error: preflight.error
    },
    live_evidence: {
      ...liveEvidence,
      path: evidence.path
    }
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`${report.status.toUpperCase()} supermemory runtime readiness\n`);
    process.stdout.write(`readiness_level=${report.readiness_level}\n`);
  }
  if (!report.runtime_ready) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
