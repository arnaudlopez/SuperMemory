import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fixturePath = "identity-vault/90_evals/cases/hindsight-adapter-minimal/input/fixture.json";

function runCli(args, env = {}) {
  return spawnSync("node", ["scripts/hindsight-promote.mjs", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "",
      HINDSIGHT_BANK_ID: "",
      HINDSIGHT_BASE_URL: "",
      SUPERMEMORY_PROMOTION_MODE: "",
      ...env
    }
  });
}

function parseJson(result) {
  assert.equal(result.status, 0, `CLI failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const dryRun = parseJson(runCli(["--input", fixturePath, "--json"]));

assert.equal(dryRun.mode, "dry-run");
assert.equal(dryRun.network_writes, false);
assert.equal(dryRun.credentials_required, false);
assert.equal(dryRun.validation.errors.length, 0);
assert.equal(dryRun.summary.retained, 1);
assert.equal(dryRun.summary.upserted, 1);
assert.equal(dryRun.summary.deleted, 1);
assert.equal(dryRun.summary.skipped, 1);
assert.deepEqual(dryRun.env, {
  HINDSIGHT_API_KEY: "not_set",
  HINDSIGHT_BANK_ID: "not_set",
  HINDSIGHT_BASE_URL: "not_set"
});
assert.ok(dryRun.operations.some((operation) => operation.operation === "delete" && operation.document_id === "doc-acme-risk-score-legacy"));
assert.ok(dryRun.operations.some((operation) => operation.operation === "skip" && operation.document_id === "doc-unpromoted-raw-llm-note"));
assert.ok(dryRun.traces.some((trace) => trace.operation === "recall" && trace.policy_id === "recall-acme-email-agent"));

const explicitDryRun = parseJson(runCli(["--input", fixturePath, "--dry-run", "--json"]));
assert.equal(explicitDryRun.mode, "dry-run");

const invalidFixture = path.join("identity-vault/90_evals/cases/hindsight-adapter-minimal/input/fixture.json");
const missingInput = runCli(["--input", "identity-vault/90_evals/cases/does-not-exist.json", "--json"]);
assert.notEqual(missingInput.status, 0);
assert.match(missingInput.stderr, /missing input file/);

const liveWithoutEnv = runCli(["--input", invalidFixture, "--live", "--json"]);
assert.notEqual(liveWithoutEnv.status, 0);
assert.match(liveWithoutEnv.stderr, /missing required live env/);

const mixedModes = runCli(["--input", fixturePath, "--dry-run", "--live", "--json"], {
  HINDSIGHT_API_KEY: "sk-test-secret",
  HINDSIGHT_BANK_ID: "bank-test"
});
assert.notEqual(mixedModes.status, 0);
assert.match(mixedModes.stderr, /mutually exclusive/);

const liveGuard = runCli(["--input", fixturePath, "--live", "--json"], {
  HINDSIGHT_API_KEY: "sk-test-secret",
  HINDSIGHT_BANK_ID: "bank-test",
  HINDSIGHT_BASE_URL: "https://example.invalid"
});
assert.notEqual(liveGuard.status, 0);
assert.match(liveGuard.stderr, /live transport is not implemented/);
assert.doesNotMatch(liveGuard.stderr, /sk-test-secret/);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-promote-"));
const invalidPromotionPath = path.join(tmpDir, "invalid-promotion.json");
fs.writeFileSync(
  invalidPromotionPath,
  JSON.stringify({
    promotion_payloads: [
      {
        document_id: "doc-missing-provenance",
        memory_id: "mem-missing-provenance",
        status: "active",
        text: "Missing provenance.",
        tags: ["workspace:ws-acme", "access_policy:professional-default", "status:active"],
        metadata: { source_id: "src-acme-api-doc" }
      }
    ]
  })
);
const invalidPromotion = runCli(["--input", invalidPromotionPath, "--json"]);
assert.notEqual(invalidPromotion.status, 0);
assert.match(invalidPromotion.stderr, /adapter_promotion_missing_provenance/);

const broadRecallPath = path.join(tmpDir, "broad-recall.json");
fs.writeFileSync(
  broadRecallPath,
  JSON.stringify({
    recall_policies: [
      {
        policy_id: "recall-broad",
        query: "What do we know?",
        fail_closed: false,
        required_tags: ["workspace:ws-acme"]
      }
    ]
  })
);
const broadRecall = runCli(["--input", broadRecallPath, "--json"]);
assert.notEqual(broadRecall.status, 0);
assert.match(broadRecall.stderr, /unsafe_adapter_recall_policy/);
fs.rmSync(tmpDir, { recursive: true, force: true });
