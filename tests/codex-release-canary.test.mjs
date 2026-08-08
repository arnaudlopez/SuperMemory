import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_ACCEPTANCE_EVIDENCE,
  buildReleaseReport,
  CODEX_ACCEPTANCE_IDS
} from "../scripts/verify-codex-supermemory-release.mjs";
import { resolveCodexExecutable } from "../scripts/run-codex-integration-canary.mjs";

function passingChecks() {
  return [...new Set(Object.values(CODEX_ACCEPTANCE_EVIDENCE).flatMap((entry) => (
    entry.check_ids
  )))].map((id) => ({ id, status: "pass" }));
}

test("release matrix contains all 80 unique acceptance contracts", () => {
  assert.equal(CODEX_ACCEPTANCE_IDS.length, 80);
  assert.equal(new Set(CODEX_ACCEPTANCE_IDS).size, 80);
  for (const prefix of [
    "AC-ID-", "AC-CAP-", "AC-VER-", "AC-GOV-", "AC-HIN-", "AC-MCP-",
    "AC-CLI-", "AC-SEC-", "AC-DEL-", "AC-MIG-", "AC-MEM-"
  ]) {
    assert.ok(CODEX_ACCEPTANCE_IDS.some((id) => id.startsWith(prefix)));
  }
  for (const [id, evidence] of Object.entries(CODEX_ACCEPTANCE_EVIDENCE)) {
    assert.match(id, /^AC-[A-Z]+-\d{2}$/);
    assert.ok(evidence.evidence.includes("::"));
    assert.ok(evidence.check_ids.length > 0);
    assert.notEqual(evidence.evidence, "isolated automated acceptance suite");
  }
});

test("dated local canary is honest about UI observation and final approval", () => {
  const report = buildReleaseReport({
    generatedAt: "2026-07-24T22:00:00.000Z",
    codexVersion: "codex-cli 0.125.0",
    checks: passingChecks()
  });
  assert.equal(report.status, "pass");
  assert.equal(report.release_candidate_ready, true);
  assert.equal(report.production_ready, false);
  assert.equal(report.final_audit_required, true);
  assert.equal(report.acceptance.total, 80);
  assert.equal(report.acceptance.covered, 80);
  assert.equal(report.clients.cli.observed, true);
  assert.equal(report.clients.desktop.observed, false);
  assert.equal(report.clients.ide.observed, false);
  assert.equal(report.clients.cloud_web.status, "not_covered");
  assert.equal(report.customer_data_used, false);
  assert.equal(report.live_cloud_writes_performed, false);
  assert.equal(report.backup_rollback_verified, true);
  assert.ok(Object.values(report.acceptance.matrix).every((entry) => (
    entry.evidence.includes("::") && entry.check_ids.length > 0
  )));
});

test("one failed gate blocks every completion claim", () => {
  const checks = passingChecks();
  checks.find((check) => check.id === "s5_s6_acceptance").status = "fail";
  const report = buildReleaseReport({
    checks,
    codexVersion: "codex-cli 0.125.0"
  });
  assert.equal(report.status, "fail");
  assert.equal(report.release_candidate_ready, false);
  assert.equal(report.production_ready, false);
  assert.ok(report.acceptance.covered > 0);
  assert.ok(report.acceptance.covered < 80);
  assert.equal(report.acceptance.matrix["AC-MCP-02"].status, "blocked");
});

test("Codex executable resolution skips broken candidates and selects a validated existing fallback", () => {
  const resolved = resolveCodexExecutable({
    explicit: "/usr/bin/false",
    pathValue: "",
    fallbacks: [process.execPath]
  });
  assert.equal(resolved.executable, process.execPath);
  assert.match(resolved.version, /^v\d+/);
  assert.equal(resolved.attempts[0].executable, "/usr/bin/false");
  assert.equal(resolved.attempts[0].status, "unusable");
});
