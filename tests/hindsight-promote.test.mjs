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
assert.match(liveGuard.stderr, /live transport requires SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1 or --mock-transport/);
assert.doesNotMatch(liveGuard.stderr, /sk-test-secret/);

const liveMock = parseJson(runCli(["--input", fixturePath, "--live", "--mock-transport", "--json"], {
  HINDSIGHT_API_KEY: "sk-test-secret",
  HINDSIGHT_BANK_ID: "bank-test",
  HINDSIGHT_BASE_URL: "https://example.invalid"
}));
assert.equal(liveMock.mode, "live");
assert.equal(liveMock.network_writes, false);
assert.equal(liveMock.credentials_required, true);
assert.equal(liveMock.bank_id, "bank-test");
assert.equal(liveMock.transport.mode, "mock");
assert.equal(liveMock.transport.requests.length, 5);
assert.equal(liveMock.transport.result.status, "mocked");
assert.equal(liveMock.transport.result.requests_sent, 5);
assert.ok(liveMock.transport.requests.some((request) => request.operation === "recall"));
assert.equal(JSON.stringify(liveMock).includes("sk-test-secret"), false);

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

const candidateTypePath = path.join(tmpDir, "candidate-type.json");
fs.writeFileSync(
  candidateTypePath,
  JSON.stringify({
    contract_mode: "vault_sync_v1",
    entity_type_registry: [
      { entity_type: "marketing_strategy", status: "candidate" }
    ],
    promotion_payloads: [
      {
        document_id: "doc-acme-strategy",
        memory_id: "mem-acme-strategy",
        status: "active",
        text: "Acme is evaluating a new marketing strategy.",
        tags: [
          "workspace:ws-acme",
          "access_policy:professional-default",
          "status:active",
          "entity_type:marketing_strategy",
          "schema_status:candidate"
        ],
        metadata: {
          source_id: "src-acme-strategy",
          snapshot_id: "snap-acme-strategy-2026-05-22",
          observation_id: "obs-acme-strategy",
          interpretation_id: "interp-acme-strategy",
          memory_id: "mem-acme-strategy",
          source_version: "snap-acme-strategy-2026-05-22",
          freshness: "fresh",
          derived_from: ["snap-acme-strategy-2026-05-22"]
        }
      }
    ]
  })
);
const candidateType = runCli(["--input", candidateTypePath, "--json"]);
assert.notEqual(candidateType.status, 0);
assert.match(candidateType.stderr, /candidate_type_not_promotable/);

const missingVaultSyncMetadataPath = path.join(tmpDir, "missing-vault-sync-metadata.json");
fs.writeFileSync(
  missingVaultSyncMetadataPath,
  JSON.stringify({
    contract_mode: "vault_sync_v1",
    promotion_payloads: [
      {
        document_id: "doc-acme-prd",
        memory_id: "mem-acme-prd-t1",
        status: "active",
        text: "Acme Project Y PRD was reviewed against the t1 snapshot.",
        tags: [
          "workspace:ws-acme",
          "access_policy:professional-default",
          "status:active",
          "entity_type:project",
          "schema_status:stable"
        ],
        metadata: {
          source_id: "src-acme-prd",
          snapshot_id: "snap-acme-prd-2026-05-21",
          observation_id: "obs-acme-prd",
          interpretation_id: "interp-acme-prd",
          memory_id: "mem-acme-prd-t1"
        }
      }
    ]
  })
);
const missingVaultSyncMetadata = runCli(["--input", missingVaultSyncMetadataPath, "--json"]);
assert.notEqual(missingVaultSyncMetadata.status, 0);
assert.match(missingVaultSyncMetadata.stderr, /vault_sync_metadata_missing/);

const vaultSyncValidPath = path.join(tmpDir, "vault-sync-valid.json");
fs.writeFileSync(
  vaultSyncValidPath,
  JSON.stringify({
    contract_mode: "vault_sync_v1",
    entity_type_registry: [
      { entity_type: "project", status: "stable" }
    ],
    snapshot_registry: [
      {
        snapshot_id: "snap-acme-prd-2026-05-21",
        source_id: "src-acme-prd",
        freshness: "fresh",
        immutable: true
      }
    ],
    promotion_payloads: [
      {
        document_id: "doc-acme-prd",
        memory_id: "mem-acme-prd-t1",
        status: "active",
        text: "Acme Project Y PRD was reviewed against the t1 snapshot.",
        tags: [
          "workspace:ws-acme",
          "access_policy:professional-default",
          "status:active",
          "entity_type:project",
          "schema_status:stable"
        ],
        metadata: {
          source_id: "src-acme-prd",
          snapshot_id: "snap-acme-prd-2026-05-21",
          observation_id: "obs-acme-prd",
          interpretation_id: "interp-acme-prd",
          memory_id: "mem-acme-prd-t1",
          source_version: "snap-acme-prd-2026-05-21",
          freshness: "fresh",
          derived_from: ["snap-acme-prd-2026-05-21"],
          evidence_refs: ["source_registry", "snapshot_registry"],
          reliability: {
            rule: "owner_reviewed_snapshot",
            score: 0.98
          },
          confidence: 0.98,
          restricted: false,
          nullish: null
        }
      }
    ]
  })
);
const vaultSyncValid = parseJson(runCli(["--input", vaultSyncValidPath, "--live", "--mock-transport", "--json"], {
  HINDSIGHT_API_KEY: "sk-test-secret",
  HINDSIGHT_BANK_ID: "bank-test",
  HINDSIGHT_BASE_URL: "https://example.invalid"
}));
const vaultSyncRequest = vaultSyncValid.transport.requests.find((request) => request.operation === "retain");
assert.equal(vaultSyncValid.validation.contract_mode, "vault_sync_v1");
assert.deepEqual(vaultSyncValid.operations[0].metadata.derived_from, ["snap-acme-prd-2026-05-21"]);
assert.deepEqual(vaultSyncValid.operations[0].metadata.evidence_refs, ["source_registry", "snapshot_registry"]);
assert.deepEqual(vaultSyncValid.operations[0].metadata.reliability, {
  rule: "owner_reviewed_snapshot",
  score: 0.98
});
assert.equal(vaultSyncValid.operations[0].metadata.confidence, 0.98);
assert.equal(vaultSyncValid.operations[0].metadata.restricted, false);
assert.equal(vaultSyncRequest.body.items[0].metadata.derived_from, "[\"snap-acme-prd-2026-05-21\"]");
assert.equal(vaultSyncRequest.body.items[0].metadata.evidence_refs, "[\"source_registry\",\"snapshot_registry\"]");
assert.equal(vaultSyncRequest.body.items[0].metadata.reliability, "{\"rule\":\"owner_reviewed_snapshot\",\"score\":0.98}");
assert.equal(vaultSyncRequest.body.items[0].metadata.confidence, "0.98");
assert.equal(vaultSyncRequest.body.items[0].metadata.restricted, "false");
assert.equal(Object.hasOwn(vaultSyncRequest.body.items[0].metadata, "nullish"), false);
assert.equal(vaultSyncRequest.body.items[0].metadata.source_version, "snap-acme-prd-2026-05-21");
assert.equal(vaultSyncRequest.body.items[0].metadata.freshness, "fresh");
assert.ok(Object.values(vaultSyncRequest.body.items[0].metadata).every((value) => typeof value === "string"));

const generatedFromValidatedPath = path.join(tmpDir, "generated-from-validated.json");
fs.writeFileSync(
  generatedFromValidatedPath,
  JSON.stringify({
    contract_mode: "vault_sync_v1",
    promotion_source: "validated_memories",
    entity_type_registry: [
      { entity_type: "project", status: "stable" }
    ],
    snapshot_registry: [
      {
        snapshot_id: "snap-acme-prd-2026-05-22",
        source_id: "src-acme-prd",
        freshness: "fresh",
        immutable: true
      }
    ],
    validated_memories: [
      {
        memory_id: "mem-acme-prd-t2",
        document_id: "doc-acme-prd",
        status: "active",
        review_status: "approved",
        promote_to_hindsight: true,
        text: "Acme Project Y PRD was approved against the 2026-05-22 snapshot.",
        workspace_id: "ws-acme",
        access_policy: "professional-default",
        consumer: "email_agent",
        entity_type: "project",
        schema_status: "stable",
        source_id: "src-acme-prd",
        snapshot_id: "snap-acme-prd-2026-05-22",
        observation_id: "obs-acme-prd-t2",
        interpretation_id: "interp-acme-prd-t2",
        freshness: "fresh",
        derived_from: ["snap-acme-prd-2026-05-22"]
      }
    ]
  })
);
const generatedFromValidated = parseJson(runCli(["--input", generatedFromValidatedPath, "--json"]));
assert.equal(generatedFromValidated.generated_from, "validated_memories");
assert.equal(generatedFromValidated.summary.retained, 1);
assert.equal(generatedFromValidated.operations[0].document_id, "doc-acme-prd");
assert.equal(generatedFromValidated.operations[0].memory_id, "mem-acme-prd-t2");
assert.equal(generatedFromValidated.operations[0].metadata.source_version, "snap-acme-prd-2026-05-22");
assert.deepEqual(generatedFromValidated.operations[0].metadata.derived_from, ["snap-acme-prd-2026-05-22"]);
assert.deepEqual(generatedFromValidated.operations[0].tags, [
  "workspace:ws-acme",
  "access_policy:professional-default",
  "status:active",
  "entity_type:project",
  "schema_status:stable",
  "consumer:email_agent"
]);

const implicitGenerationPath = path.join(tmpDir, "implicit-generation.json");
fs.writeFileSync(
  implicitGenerationPath,
  JSON.stringify({
    contract_mode: "vault_sync_v1",
    promotion_source: "validated_memories",
    validated_memories: [
      {
        memory_id: "mem-acme-prd-unflagged",
        document_id: "doc-acme-prd-unflagged",
        status: "active",
        review_status: "approved",
        text: "This memory is valid but not explicitly flagged for Hindsight promotion.",
        workspace_id: "ws-acme",
        access_policy: "professional-default",
        entity_type: "project",
        schema_status: "stable",
        source_id: "src-acme-prd",
        snapshot_id: "snap-acme-prd-2026-05-22",
        observation_id: "obs-acme-prd-unflagged",
        interpretation_id: "interp-acme-prd-unflagged",
        freshness: "fresh",
        derived_from: ["snap-acme-prd-2026-05-22"]
      }
    ]
  })
);
const implicitGeneration = runCli(["--input", implicitGenerationPath, "--json"]);
assert.notEqual(implicitGeneration.status, 0);
assert.match(implicitGeneration.stderr, /validated_memory_not_explicitly_promotable/);

const reviewedPlanPath = path.join(tmpDir, "reviewed-promotion-plan.json");
const writeReviewedPlan = parseJson(runCli([
  "--input", generatedFromValidatedPath,
  "--write-plan", reviewedPlanPath,
  "--json"
]));
assert.equal(writeReviewedPlan.mode, "write-plan");
assert.equal(writeReviewedPlan.generated_from, "hindsight_reviewed_promotion_plan");
assert.equal(writeReviewedPlan.network_writes, false);
assert.equal(writeReviewedPlan.writes_performed, true);
assert.equal(writeReviewedPlan.review_required, true);
assert.equal(writeReviewedPlan.plan_path, fs.realpathSync(reviewedPlanPath));
assert.equal(fs.existsSync(reviewedPlanPath), true);
assert.equal(JSON.stringify(writeReviewedPlan).includes("sk-test-secret"), false);

const savedReviewedPlan = JSON.parse(fs.readFileSync(reviewedPlanPath, "utf8"));
assert.equal(savedReviewedPlan.generated_from, "hindsight_reviewed_promotion_plan");
assert.equal(savedReviewedPlan.mode, "review-required");
assert.equal(savedReviewedPlan.review_required, true);
assert.equal(savedReviewedPlan.network_writes, false);
assert.equal(savedReviewedPlan.plan.validation.errors.length, 0);
assert.equal(savedReviewedPlan.plan.summary.retained, 1);

const applyWithoutConfirmation = runCli([
  "--apply-plan", reviewedPlanPath,
  "--mock-transport",
  "--json"
], {
  HINDSIGHT_API_KEY: "sk-test-secret",
  HINDSIGHT_BANK_ID: "bank-test",
  HINDSIGHT_BASE_URL: "http://127.0.0.1:8888"
});
assert.notEqual(applyWithoutConfirmation.status, 0);
assert.match(applyWithoutConfirmation.stderr, /owner_confirmation_required/);

const applyReviewedPlanMock = parseJson(runCli([
  "--apply-plan", reviewedPlanPath,
  "--owner-confirmed",
  "--mock-transport",
  "--json"
], {
  HINDSIGHT_API_KEY: "sk-test-secret",
  HINDSIGHT_BANK_ID: "bank-test",
  HINDSIGHT_BASE_URL: "http://127.0.0.1:8888"
}));
assert.equal(applyReviewedPlanMock.mode, "apply-plan");
assert.equal(applyReviewedPlanMock.reviewed_plan, true);
assert.equal(applyReviewedPlanMock.owner_confirmed, true);
assert.equal(applyReviewedPlanMock.network_writes, false);
assert.equal(applyReviewedPlanMock.transport.mode, "mock");
assert.equal(applyReviewedPlanMock.transport.requests.length, 1);
assert.equal(JSON.stringify(applyReviewedPlanMock).includes("sk-test-secret"), false);

const tamperedPlanPath = path.join(tmpDir, "reviewed-promotion-plan-tampered.json");
const tamperedPlan = JSON.parse(fs.readFileSync(reviewedPlanPath, "utf8"));
tamperedPlan.plan.operations[0].document_id = "doc-tampered";
fs.writeFileSync(tamperedPlanPath, JSON.stringify(tamperedPlan, null, 2));
const tamperedApply = runCli([
  "--apply-plan", tamperedPlanPath,
  "--owner-confirmed",
  "--mock-transport",
  "--json"
], {
  HINDSIGHT_API_KEY: "sk-test-secret",
  HINDSIGHT_BANK_ID: "bank-test",
  HINDSIGHT_BASE_URL: "http://127.0.0.1:8888"
});
assert.notEqual(tamperedApply.status, 0);
assert.match(tamperedApply.stderr, /apply_plan_tampered/);

const identityVaultPlan = runCli([
  "--input", generatedFromValidatedPath,
  "--write-plan", "identity-vault/reviewed-promotion-plan.json",
  "--json"
]);
assert.notEqual(identityVaultPlan.status, 0);
assert.match(identityVaultPlan.stderr, /write_plan_vault_write_forbidden/);
fs.rmSync(tmpDir, { recursive: true, force: true });
