#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { materializeSnapshotArtifact } from "./lib/snapshot-artifacts.mjs";
import { withVaultMutationLock, writeRegistryPairRecoverable } from "./lib/registry-transaction.mjs";

const defaultExcludes = [".git/**", "node_modules/**", "tmp/**", "dist/**", "build/**", ".env*", "**/.env*"];
const rawContentKeys = new Set(["content", "body", "raw_content", "source_text"]);

function parseArgs(argv) {
  const options = {
    client: null,
    workspace: null,
    sourceRoot: null,
    includes: [],
    excludes: [],
    requestedBy: null,
    captureReason: null,
    writePlan: null,
    applyPlan: null,
    commitStaging: null,
    outDir: null,
    vaultRoot: null,
    ownerConfirmed: false,
    capturedAt: new Date().toISOString(),
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--client") {
      options.client = argv[index + 1];
      index += 1;
    } else if (arg === "--workspace") {
      options.workspace = argv[index + 1];
      index += 1;
    } else if (arg === "--source-root") {
      options.sourceRoot = argv[index + 1];
      index += 1;
    } else if (arg === "--include") {
      options.includes.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--exclude") {
      options.excludes.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--requested-by") {
      options.requestedBy = argv[index + 1];
      index += 1;
    } else if (arg === "--capture-reason") {
      options.captureReason = argv[index + 1];
      index += 1;
    } else if (arg === "--write-plan") {
      options.writePlan = argv[index + 1];
      index += 1;
    } else if (arg === "--apply-plan") {
      options.applyPlan = argv[index + 1];
      index += 1;
    } else if (arg === "--commit-staging") {
      options.commitStaging = argv[index + 1];
      index += 1;
    } else if (arg === "--out-dir") {
      options.outDir = argv[index + 1];
      index += 1;
    } else if (arg === "--vault-root") {
      options.vaultRoot = argv[index + 1];
      index += 1;
    } else if (arg === "--owner-confirmed") {
      options.ownerConfirmed = true;
    } else if (arg === "--captured-at") {
      options.capturedAt = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage: node scripts/supermemory-onboard.mjs --client <name> --workspace <id> --source-root <dir> --include <pattern> --requested-by <owner> --capture-reason <reason> [--exclude <pattern>] [--write-plan <file>] [--json]",
    "       node scripts/supermemory-onboard.mjs --apply-plan <file> --out-dir <staging-dir> [--json]",
    "       node scripts/supermemory-onboard.mjs --commit-staging <staging-dir> --vault-root <identity-vault> --owner-confirmed [--json]",
    "",
    "Creates a redacted client onboarding plan, applies it to reviewable staging, and commits source/snapshot registry rows only after owner confirmation."
  ].join("\n");
}

function hasValue(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "item";
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRel(filePath) {
  return filePath.split(path.sep).join("/");
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function matchPattern(relativePath, pattern) {
  if (!pattern) return false;
  const rel = normalizeRel(relativePath);
  const normalized = pattern.replace(/^\.\//, "");
  if (normalized.includes("..")) throw new Error("scope_escape");
  if (normalized === rel) return true;

  if (normalized.startsWith("**/*.")) {
    return rel.endsWith(normalized.slice(4));
  }
  if (normalized.startsWith("*.")) {
    return !rel.includes("/") && rel.endsWith(normalized.slice(1));
  }
  if (normalized.endsWith("/**")) {
    const dir = normalized.slice(0, -3).replace(/\/$/, "");
    return rel === dir || rel.startsWith(`${dir}/`);
  }
  if (normalized.startsWith("**/") && normalized.endsWith("*")) {
    const prefix = normalized.slice(3, -1);
    return path.posix.basename(rel).startsWith(prefix);
  }
  if (normalized.endsWith("*")) {
    return rel.startsWith(normalized.slice(0, -1));
  }
  return false;
}

function isSecretLike(text) {
  return /(sk-[A-Za-z0-9_-]+|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]|TOKEN\s*=)/i.test(text);
}

function containsRawContentField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsRawContentField(item));
  return Object.entries(value).some(([key, nested]) => rawContentKeys.has(key) || containsRawContentField(nested));
}

function withoutPlanHash(plan) {
  const clone = structuredClone(plan);
  delete clone.plan_hash;
  return clone;
}

function planHash(plan) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(withoutPlanHash(plan))).digest("hex")}`;
}

function assertPlanHash(plan, errorCode) {
  if (!plan?.plan_hash || planHash(plan) !== plan.plan_hash) {
    throw new Error(errorCode);
  }
}

function resolveWritableFile(outputPath) {
  const requested = path.resolve(outputPath);
  const parent = path.dirname(requested);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("write_plan_parent_missing");
  }
  if (fs.existsSync(requested) && fs.statSync(requested).isDirectory()) {
    throw new Error("write_plan_target_is_directory");
  }
  return path.join(fs.realpathSync(parent), path.basename(requested));
}

function buildPlan(options) {
  const errors = [];
  if (!hasValue(options.client) || !hasValue(options.workspace)) errors.push("missing_workspace_setup");
  if (!hasValue(options.requestedBy) || !hasValue(options.captureReason)) errors.push("missing_owner_intent");
  if (!hasValue(options.sourceRoot)) errors.push("missing_source_root");
  if (options.includes.length === 0) errors.push("missing_include_patterns");
  if (errors.length > 0) throw new Error(errors[0]);

  const sourceRoot = path.resolve(options.sourceRoot);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error("source_root_unreadable");
  }
  const rootReal = fs.realpathSync(sourceRoot);
  const excludes = [...defaultExcludes, ...options.excludes];
  for (const pattern of [...options.includes, ...excludes]) {
    if (pattern.includes("..")) throw new Error("scope_escape");
  }

  const files = walkFiles(rootReal)
    .map((filePath) => ({
      fullPath: fs.realpathSync(filePath),
      relativePath: normalizeRel(path.relative(rootReal, filePath))
    }))
    .filter((file) => isInside(rootReal, file.fullPath))
    .filter((file) => options.includes.some((pattern) => matchPattern(file.relativePath, pattern)))
    .filter((file) => !excludes.some((pattern) => matchPattern(file.relativePath, pattern)))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  if (files.length === 0) throw new Error("no_matched_files");

  const dateToken = options.capturedAt.replace(/\D/g, "").slice(0, 14) || "00000000000000";
  const workspaceSlug = slug(options.workspace);
  const sources = [];
  const snapshots = [];
  const warnings = [];

  for (const file of files) {
    const text = fs.readFileSync(file.fullPath, "utf8");
    const hash = `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
    const sourceSlug = slug(file.relativePath);
    const relativePathId = crypto.createHash("sha256").update(file.relativePath).digest("hex").slice(0, 12);
    const sourceId = `source:onboard:${workspaceSlug}:${sourceSlug}-${relativePathId}`;
    const snapshotId = `snap:${sourceId}:${dateToken}`;
    const secretLike = isSecretLike(text);
    const reviewState = secretLike ? "needs_review" : "ready_for_review";
    const common = {
      source_id: sourceId,
      workspace_id: options.workspace,
      client_name: options.client,
      relative_path: file.relativePath,
      original_ref: file.fullPath,
      connector_id: "onboarding.local_folder",
      connector_type: "local_folder",
      connector_scope: rootReal,
      requested_by: options.requestedBy,
      capture_reason: options.captureReason,
      owner_confirmed: true,
      status: "captured",
      review_state: reviewState,
      sensitivity: secretLike ? "restricted_review" : "standard",
      content_hash: hash
    };
    sources.push({
      ...common,
      source_kind: path.extname(file.relativePath).slice(1) || "local_file",
      active_snapshot_id: snapshotId,
      mutability: "mutable_external",
      freshness: "fresh"
    });
    snapshots.push({
      snapshot_id: snapshotId,
      source_id: sourceId,
      workspace_id: options.workspace,
      relative_path: file.relativePath,
      original_ref: file.fullPath,
      content_hash: hash,
      captured_at: options.capturedAt,
      capture_method: "client_onboarding",
      immutable: true,
      source_text_role: "evidence_only",
      review_state: reviewState
    });
    if (secretLike) {
      warnings.push({
        warning_id: `warn:${sourceId}:secret-like`,
        source_id: sourceId,
        relative_path: file.relativePath,
        severity: "needs_review",
        code: "secret_like_source",
        message: "Secret-like text was detected; source remains review-gated and raw content is not persisted."
      });
    }
  }

  const plan = {
    status: "pass",
    mode: "dry-run",
    generated_from: "supermemory_client_onboarding",
    network_writes: false,
    writes_performed: false,
    credentials_required: false,
    client: {
      name: options.client,
      workspace_id: options.workspace,
      requested_by: options.requestedBy,
      capture_reason: options.captureReason
    },
    source_root: rootReal,
    include_patterns: options.includes,
    exclude_patterns: excludes,
    validation: { errors: [] },
    summary: {
      files_included: sources.length,
      secret_like_warnings: warnings.length
    },
    sources,
    snapshots,
    warnings,
    promotion_payloads: []
  };
  plan.plan_hash = planHash(plan);
  return plan;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath, errorCode = "json_unreadable") {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(errorCode);
  }
}

function resolveApplyOutDir(outputDir) {
  if (!hasValue(outputDir)) throw new Error("missing_apply_out_dir");
  const requested = path.resolve(outputDir);
  const parent = path.dirname(requested);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error("apply_plan_parent_missing");
  const vaultRoot = path.resolve("identity-vault");
  if (isInside(vaultRoot, requested)) throw new Error("apply_plan_vault_write_forbidden");
  if (fs.existsSync(requested) && !fs.statSync(requested).isDirectory()) throw new Error("apply_plan_out_dir_is_file");
  fs.mkdirSync(requested, { recursive: true });
  if (fs.readdirSync(requested).length > 0) throw new Error("apply_plan_out_dir_not_empty");
  return fs.realpathSync(requested);
}

function validatePlan(plan, tamperError = "apply_plan_tampered") {
  if (!plan || plan.generated_from !== "supermemory_client_onboarding" || plan.mode !== "dry-run") {
    throw new Error("apply_plan_invalid");
  }
  if (plan.network_writes !== false || plan.writes_performed !== false || plan.promotion_payloads?.length !== 0) {
    throw new Error("apply_plan_invalid");
  }
  if (plan.validation?.errors?.length) throw new Error("apply_plan_invalid");
  assertPlanHash(plan, tamperError);
  if (containsRawContentField(plan)) throw new Error("raw_content_forbidden");
}

function applyPlan(options) {
  if (!hasValue(options.applyPlan)) throw new Error("missing_apply_plan");
  const plan = readJson(path.resolve(options.applyPlan), "apply_plan_unreadable");
  validatePlan(plan);
  const outDir = resolveApplyOutDir(options.outDir);
  const manifest = {
    generated_from: "supermemory_client_onboarding_apply",
    mode: "staging",
    plan_hash: plan.plan_hash,
    network_writes: false,
    writes_performed: true,
    artifact_files: [
      "onboarding-plan.json",
      "workspace.json",
      "source-registry.json",
      "snapshots.json",
      "warnings.json"
    ]
  };
  writeJson(path.join(outDir, "onboarding-plan.json"), plan);
  writeJson(path.join(outDir, "workspace.json"), plan.client);
  writeJson(path.join(outDir, "source-registry.json"), plan.sources);
  writeJson(path.join(outDir, "snapshots.json"), plan.snapshots);
  writeJson(path.join(outDir, "warnings.json"), plan.warnings);
  writeJson(path.join(outDir, "manifest.json"), manifest);
  return {
    status: "pass",
    mode: "apply-plan",
    network_writes: false,
    writes_performed: true,
    out_dir: outDir,
    artifacts: [...manifest.artifact_files, "manifest.json"]
  };
}

function ensureVaultRegistries(vaultRoot) {
  const inbox = path.join(vaultRoot, "00_inbox");
  if (fs.existsSync(inbox)) {
    const inboxStat = fs.lstatSync(inbox);
    if (inboxStat.isSymbolicLink() || !inboxStat.isDirectory()) throw new Error("vault_registry_scope_invalid");
  } else {
    fs.mkdirSync(inbox, { mode: 0o700 });
  }
  const sourceRegistry = path.join(inbox, "source_registry.md");
  const snapshotRegistry = path.join(inbox, "snapshot_registry.md");
  if (!fs.existsSync(sourceRegistry)) {
    fs.writeFileSync(sourceRegistry, "# Source Registry\n\n| source_id | workspace_id | client_name | relative_path | active_snapshot_id | review_state | content_hash |\n| --- | --- | --- | --- | --- | --- | --- |\n", { flag: "wx", mode: 0o600 });
  } else {
    const sourceStat = fs.lstatSync(sourceRegistry);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error("vault_registry_scope_invalid");
  }
  if (!fs.existsSync(snapshotRegistry)) {
    fs.writeFileSync(snapshotRegistry, "# Snapshot Registry\n\n| snapshot_id | source_id | workspace_id | relative_path | content_hash | captured_at | review_state |\n| --- | --- | --- | --- | --- | --- | --- |\n", { flag: "wx", mode: 0o600 });
  } else {
    const snapshotStat = fs.lstatSync(snapshotRegistry);
    if (snapshotStat.isSymbolicLink() || !snapshotStat.isFile()) throw new Error("vault_registry_scope_invalid");
  }
  return { sourceRegistry, snapshotRegistry };
}

function md(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function appendRowsText(existing, rows) {
  const suffix = existing.endsWith("\n") ? "" : "\n";
  return `${existing}${suffix}${rows.join("\n")}\n`;
}

function commitStaging(options) {
  if (!options.ownerConfirmed) throw new Error("owner_confirmation_required");
  if (!hasValue(options.commitStaging)) throw new Error("missing_commit_staging");
  if (!hasValue(options.vaultRoot)) throw new Error("missing_vault_root");
  const stagingDir = path.resolve(options.commitStaging);
  if (!fs.existsSync(stagingDir) || !fs.statSync(stagingDir).isDirectory()) throw new Error("staging_unreadable");
  const manifest = readJson(path.join(stagingDir, "manifest.json"), "staging_incomplete");
  const plan = readJson(path.join(stagingDir, "onboarding-plan.json"), "staging_incomplete");
  const sources = readJson(path.join(stagingDir, "source-registry.json"), "staging_incomplete");
  const snapshots = readJson(path.join(stagingDir, "snapshots.json"), "staging_incomplete");
  if (manifest.generated_from !== "supermemory_client_onboarding_apply" || manifest.plan_hash !== plan.plan_hash) {
    throw new Error("staging_tampered");
  }
  validatePlan(plan, "staging_tampered");
  if (JSON.stringify(sources) !== JSON.stringify(plan.sources) || JSON.stringify(snapshots) !== JSON.stringify(plan.snapshots)) {
    throw new Error("staging_tampered");
  }
  const requestedVaultRoot = path.resolve(options.vaultRoot);
  if (!fs.existsSync(requestedVaultRoot)) {
    fs.mkdirSync(requestedVaultRoot, { recursive: true, mode: 0o700 });
  }
  if (fs.lstatSync(requestedVaultRoot).isSymbolicLink() || !fs.lstatSync(requestedVaultRoot).isDirectory()) {
    throw new Error("vault_root_unreadable");
  }
  const vaultRoot = fs.realpathSync(requestedVaultRoot);
  return withVaultMutationLock(vaultRoot, ({ recovery }) => {
    const { sourceRegistry, snapshotRegistry } = ensureVaultRegistries(vaultRoot);
    const existingSource = fs.readFileSync(sourceRegistry, "utf8");
    const existingSnapshot = fs.readFileSync(snapshotRegistry, "utf8");
    for (const source of sources) {
      if (existingSource.includes(source.source_id)) throw new Error("duplicate_vault_entry");
    }
    for (const snapshot of snapshots) {
      if (existingSnapshot.includes(snapshot.snapshot_id)) throw new Error("duplicate_vault_entry");
    }
    const snapshotArtifacts = snapshots.map((snapshot) => materializeSnapshotArtifact({
      vaultRoot,
      originalRef: snapshot.original_ref,
      contentHash: snapshot.content_hash,
      snapshotId: snapshot.snapshot_id
    }));
    const nextSourceRegistry = appendRowsText(existingSource, sources.map((source) => (
      `| ${md(source.source_id)} | ${md(source.workspace_id)} | ${md(source.client_name)} | ${md(source.relative_path)} | ${md(source.active_snapshot_id)} | ${md(source.review_state)} | ${md(source.content_hash)} |`
    )));
    const nextSnapshotRegistry = appendRowsText(existingSnapshot, snapshots.map((snapshot) => (
      `| ${md(snapshot.snapshot_id)} | ${md(snapshot.source_id)} | ${md(snapshot.workspace_id)} | ${md(snapshot.relative_path)} | ${md(snapshot.content_hash)} | ${md(snapshot.captured_at)} | ${md(snapshot.review_state)} |`
    )));
    const registryTransaction = writeRegistryPairRecoverable({
      vaultRoot,
      sourceRegistry,
      snapshotRegistry,
      nextSourceRegistry,
      nextSnapshotRegistry
    });
    return {
      status: "pass",
      mode: "commit-staging",
      network_writes: false,
      writes_performed: true,
      vault_root: vaultRoot,
      snapshot_artifacts: snapshotArtifacts,
      registry_transaction: registryTransaction,
      recovered_previous_transaction: recovery.recovered,
      summary: {
        sources_committed: sources.length,
        snapshots_committed: snapshots.length,
        snapshot_artifacts_committed: snapshotArtifacts.length
      }
    };
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  let report;
  if (options.applyPlan) {
    report = applyPlan(options);
  } else if (options.commitStaging) {
    report = commitStaging(options);
  } else {
    report = buildPlan(options);
    if (options.writePlan) {
      writeJson(resolveWritableFile(options.writePlan), report);
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${report.status} ${report.mode}\n`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
