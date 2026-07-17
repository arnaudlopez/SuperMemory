import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-runtime-readiness-"));
const missingEvidence = path.join(tmpRoot, "missing-live-evidence.jsonl");

const result = spawnSync("node", [
  "scripts/verify-supermemory-runtime-readiness.mjs",
  "--evidence-path", missingEvidence,
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

assert.notEqual(result.status, 0);
const report = JSON.parse(result.stdout);
assert.equal(report.status, "fail");
assert.equal(report.mode, "runtime-readiness");
assert.equal(report.readiness_level, "contract-ready");
assert.equal(report.contract_ready, true);
assert.equal(report.runtime_ready, false);
assert.equal(report.production_ready, false);
assert.equal(report.live_writes_performed_by_this_check, false);
assert.equal(report.contract.ok, true);
assert.equal(report.contract.status, "pass");
assert.equal(report.preflight.status, "blocked");
assert.ok(report.preflight.blockers.some((blocker) => blocker.code === "missing_live_env"));
assert.equal(report.live_evidence.reason, "live_evidence_missing");

fs.rmSync(tmpRoot, { recursive: true, force: true });
