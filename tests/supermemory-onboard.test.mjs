import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function runOnboard(args) {
  return spawnSync("node", ["scripts/supermemory-onboard.mjs", ...args], {
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

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertNoRawContent(value, label = "value") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawContent(item, `${label}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(["content", "body", "raw_content", "source_text"].includes(key), false, `${label} leaked raw content key ${key}`);
    assertNoRawContent(nested, `${label}.${key}`);
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-onboard-"));
const sourceRoot = path.join(tmpRoot, "client-source");
const planPath = path.join(tmpRoot, "onboarding-plan.json");
const stagingDir = path.join(tmpRoot, "staging");
const vaultRoot = path.join(tmpRoot, "identity-vault");

writeFile(path.join(sourceRoot, "notes", "strategy.md"), "# Strategy\nClient wants governed memory.\n");
writeFile(path.join(sourceRoot, "exports", "crm.json"), JSON.stringify({ account: "ACME", status: "pilot" }));
writeFile(path.join(sourceRoot, "secrets.md"), "api_key: SHOULD_NOT_LEAK_TO_PLAN\n");
writeFile(path.join(sourceRoot, "node_modules", "ignored.md"), "ignored dependency content\n");
writeFile(path.join(sourceRoot, ".git", "ignored.md"), "ignored git content\n");
writeFile(path.join(sourceRoot, ".env"), "TOKEN=SHOULD_NOT_MATCH\n");

const dryRun = parseJson(runOnboard([
  "--client", "Client ACME",
  "--workspace", "workspace:acme",
  "--source-root", sourceRoot,
  "--include", "**/*.md",
  "--include", "**/*.json",
  "--exclude", "node_modules/**",
  "--requested-by", "arnaud",
  "--capture-reason", "client memory bootstrap",
  "--write-plan", planPath,
  "--json"
]), "dry-run");

assert.equal(dryRun.status, "pass");
assert.equal(dryRun.mode, "dry-run");
assert.equal(dryRun.generated_from, "supermemory_client_onboarding");
assert.equal(dryRun.network_writes, false);
assert.equal(dryRun.writes_performed, false);
assert.equal(dryRun.credentials_required, false);
assert.equal(dryRun.validation.errors.length, 0);
assert.equal(dryRun.summary.files_included, 3);
assert.equal(dryRun.summary.secret_like_warnings, 1);
assert.ok(dryRun.plan_hash.startsWith("sha256:"));
assert.deepEqual(dryRun.promotion_payloads, []);
assert.equal(fs.existsSync(planPath), true);
assertNoRawContent(dryRun, "dryRun");
assert.equal(JSON.stringify(dryRun).includes("SHOULD_NOT_LEAK_TO_PLAN"), false);
assert.equal(JSON.stringify(dryRun).includes("SHOULD_NOT_MATCH"), false);

const persistedPlan = readJson(planPath);
assert.equal(persistedPlan.plan_hash, dryRun.plan_hash);
assert.equal(persistedPlan.sources.length, 3);
assert.equal(persistedPlan.snapshots.length, 3);
assert.equal(persistedPlan.warnings.length, 1);
assert.ok(persistedPlan.sources.every((source) => source.workspace_id === "workspace:acme"));
assert.ok(persistedPlan.sources.some((source) => source.review_state === "needs_review"));
assertNoRawContent(persistedPlan, "persistedPlan");

const missingOwner = runOnboard([
  "--client", "Client ACME",
  "--workspace", "workspace:acme",
  "--source-root", sourceRoot,
  "--include", "**/*.md",
  "--capture-reason", "client memory bootstrap",
  "--json"
]);
assert.notEqual(missingOwner.status, 0);
assert.match(missingOwner.stderr, /missing_owner_intent/);

const noMatches = runOnboard([
  "--client", "Client ACME",
  "--workspace", "workspace:acme",
  "--source-root", sourceRoot,
  "--include", "**/*.pdf",
  "--requested-by", "arnaud",
  "--capture-reason", "client memory bootstrap",
  "--json"
]);
assert.notEqual(noMatches.status, 0);
assert.match(noMatches.stderr, /no_matched_files/);

const scopeEscape = runOnboard([
  "--client", "Client ACME",
  "--workspace", "workspace:acme",
  "--source-root", sourceRoot,
  "--include", "../outside.md",
  "--requested-by", "arnaud",
  "--capture-reason", "client memory bootstrap",
  "--json"
]);
assert.notEqual(scopeEscape.status, 0);
assert.match(scopeEscape.stderr, /scope_escape/);

const applied = parseJson(runOnboard([
  "--apply-plan", planPath,
  "--out-dir", stagingDir,
  "--json"
]), "apply-plan");
assert.equal(applied.status, "pass");
assert.equal(applied.mode, "apply-plan");
assert.equal(applied.network_writes, false);
assert.equal(applied.writes_performed, true);
assert.deepEqual(applied.artifacts.sort(), [
  "manifest.json",
  "onboarding-plan.json",
  "snapshots.json",
  "source-registry.json",
  "warnings.json",
  "workspace.json"
].sort());

for (const artifact of applied.artifacts) {
  assert.equal(fs.existsSync(path.join(stagingDir, artifact)), true, `missing staging artifact ${artifact}`);
  assertNoRawContent(readJson(path.join(stagingDir, artifact)), artifact);
}

const nonEmptyDir = path.join(tmpRoot, "non-empty-staging");
fs.mkdirSync(nonEmptyDir);
writeFile(path.join(nonEmptyDir, "keep.txt"), "occupied");
const nonEmptyApply = runOnboard(["--apply-plan", planPath, "--out-dir", nonEmptyDir, "--json"]);
assert.notEqual(nonEmptyApply.status, 0);
assert.match(nonEmptyApply.stderr, /apply_plan_out_dir_not_empty/);

const vaultApply = runOnboard(["--apply-plan", planPath, "--out-dir", path.join(process.cwd(), "identity-vault", "tmp-onboarding-test"), "--json"]);
assert.notEqual(vaultApply.status, 0);
assert.match(vaultApply.stderr, /apply_plan_vault_write_forbidden/);

const tamperedPlanPath = path.join(tmpRoot, "tampered-plan.json");
const tamperedPlan = readJson(planPath);
tamperedPlan.sources[0].source_id = "source:tampered";
fs.writeFileSync(tamperedPlanPath, `${JSON.stringify(tamperedPlan, null, 2)}\n`);
const tamperedApply = runOnboard(["--apply-plan", tamperedPlanPath, "--out-dir", path.join(tmpRoot, "tampered-staging"), "--json"]);
assert.notEqual(tamperedApply.status, 0);
assert.match(tamperedApply.stderr, /apply_plan_tampered/);

const rawContentPlanPath = path.join(tmpRoot, "raw-content-plan.json");
const rawContentPlan = readJson(planPath);
rawContentPlan.sources[0].content = "raw source content";
const canonical = JSON.stringify({ ...rawContentPlan, plan_hash: undefined });
rawContentPlan.plan_hash = `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`;
fs.writeFileSync(rawContentPlanPath, `${JSON.stringify(rawContentPlan, null, 2)}\n`);
const rawContentApply = runOnboard(["--apply-plan", rawContentPlanPath, "--out-dir", path.join(tmpRoot, "raw-content-staging"), "--json"]);
assert.notEqual(rawContentApply.status, 0);
assert.match(rawContentApply.stderr, /raw_content_forbidden/);

const missingConfirmation = runOnboard(["--commit-staging", stagingDir, "--vault-root", vaultRoot, "--json"]);
assert.notEqual(missingConfirmation.status, 0);
assert.match(missingConfirmation.stderr, /owner_confirmation_required/);

const committed = parseJson(runOnboard([
  "--commit-staging", stagingDir,
  "--vault-root", vaultRoot,
  "--owner-confirmed",
  "--json"
]), "commit-staging");
assert.equal(committed.status, "pass");
assert.equal(committed.mode, "commit-staging");
assert.equal(committed.network_writes, false);
assert.equal(committed.writes_performed, true);
assert.equal(committed.summary.sources_committed, 3);
assert.equal(committed.summary.snapshots_committed, 3);
assert.equal(committed.summary.snapshot_artifacts_committed, 3);
assert.equal(committed.snapshot_artifacts.length, 3);
assert.ok(committed.snapshot_artifacts.every((artifact) => fs.existsSync(artifact.path)));
assert.deepEqual(
  committed.snapshot_artifacts.map((artifact) => fs.readFileSync(artifact.path, "utf8")).sort(),
  [
    "# Strategy\nClient wants governed memory.\n",
    JSON.stringify({ account: "ACME", status: "pilot" }),
    "api_key: SHOULD_NOT_LEAK_TO_PLAN\n"
  ].sort()
);

const sourceRegistry = fs.readFileSync(path.join(vaultRoot, "00_inbox", "source_registry.md"), "utf8");
const snapshotRegistry = fs.readFileSync(path.join(vaultRoot, "00_inbox", "snapshot_registry.md"), "utf8");
assert.match(sourceRegistry, /workspace:acme/);
assert.match(sourceRegistry, /Client ACME/);
assert.match(snapshotRegistry, /sha256:/);
assert.equal(sourceRegistry.includes("SHOULD_NOT_LEAK_TO_PLAN"), false);
assert.equal(snapshotRegistry.includes("SHOULD_NOT_LEAK_TO_PLAN"), false);

const collisionRoot = path.join(tmpRoot, "collision-source");
writeFile(path.join(collisionRoot, "a-b.md"), "flat path\n");
writeFile(path.join(collisionRoot, "a", "b.md"), "nested path\n");
const collisionPlan = parseJson(runOnboard([
  "--client", "Collision Test",
  "--workspace", "workspace:collision",
  "--source-root", collisionRoot,
  "--include", "**/*.md",
  "--requested-by", "arnaud",
  "--capture-reason", "verify deterministic unique ids",
  "--json"
]), "collision-plan");
assert.equal(collisionPlan.sources.length, 2);
assert.equal(new Set(collisionPlan.sources.map((source) => source.source_id)).size, 2);
assert.equal(new Set(collisionPlan.snapshots.map((snapshot) => snapshot.snapshot_id)).size, 2);

const duplicateCommit = runOnboard([
  "--commit-staging", stagingDir,
  "--vault-root", vaultRoot,
  "--owner-confirmed",
  "--json"
]);
assert.notEqual(duplicateCommit.status, 0);
assert.match(duplicateCommit.stderr, /duplicate_vault_entry/);

const tamperedStaging = path.join(tmpRoot, "tampered-staging-commit");
fs.cpSync(stagingDir, tamperedStaging, { recursive: true });
const tamperedManifest = readJson(path.join(tamperedStaging, "manifest.json"));
tamperedManifest.plan_hash = "sha256:bad";
fs.writeFileSync(path.join(tamperedStaging, "manifest.json"), `${JSON.stringify(tamperedManifest, null, 2)}\n`);
const tamperedCommit = runOnboard([
  "--commit-staging", tamperedStaging,
  "--vault-root", path.join(tmpRoot, "tampered-vault"),
  "--owner-confirmed",
  "--json"
]);
assert.notEqual(tamperedCommit.status, 0);
assert.match(tamperedCommit.stderr, /staging_tampered/);
