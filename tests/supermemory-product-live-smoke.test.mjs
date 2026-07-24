import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateProductEvidence } from "../scripts/supermemory-product-live-smoke.mjs";

const script = path.resolve("scripts/supermemory-product-live-smoke.mjs");

test("product live evidence requires every end-to-end workflow stage", () => {
  const report = {
    status: "pass",
    mode: "live",
    live_writes_performed: true,
    secrets_redacted: true,
    cases: [
      "four-format-ingest-review",
      "hindsight-reconciled-cited-recall",
      "refresh-and-derived-revocation",
      "explicit-source-deletion",
      "verified-backup-atomic-restore",
      "restart-and-hindsight-rebuild"
    ].map((id) => ({ id, status: "pass" }))
  };
  assert.deepEqual(validateProductEvidence(report), []);
  report.cases.pop();
  assert.deepEqual(validateProductEvidence(report), ["case:restart-and-hindsight-rebuild"]);
});

test("product live smoke fails closed without explicit live confirmation and performs no writes", () => {
  const result = spawnSync(process.execPath, [script, "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPERMEMORY_ALLOW_PRODUCT_LIVE_SMOKE: ""
    }
  });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "blocked_explicit_live_confirmation_required");
  assert.equal(report.live_writes_performed, false);
  assert.equal(report.cases.length, 0);
  assert.equal(report.evidence_path, undefined);
});
