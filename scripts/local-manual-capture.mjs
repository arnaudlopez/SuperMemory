#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    file: null,
    scope: null,
    workspace: null,
    requestedBy: null,
    captureReason: null,
    sourceId: null,
    sourceKind: "local_file",
    sensitivity: "medium",
    connectorId: "manual.local_file",
    connectorType: "manual_file",
    capturedAt: new Date().toISOString(),
    writePlan: null,
    applyPlan: null,
    commitStaging: null,
    outDir: null,
    vaultRoot: null,
    ownerConfirmed: false,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--file") {
      options.file = argv[index + 1];
      index += 1;
    } else if (arg === "--scope") {
      options.scope = argv[index + 1];
      index += 1;
    } else if (arg === "--workspace") {
      options.workspace = argv[index + 1];
      index += 1;
    } else if (arg === "--requested-by") {
      options.requestedBy = argv[index + 1];
      index += 1;
    } else if (arg === "--capture-reason") {
      options.captureReason = argv[index + 1];
      index += 1;
    } else if (arg === "--source-id") {
      options.sourceId = argv[index + 1];
      index += 1;
    } else if (arg === "--source-kind") {
      options.sourceKind = argv[index + 1];
      index += 1;
    } else if (arg === "--sensitivity") {
      options.sensitivity = argv[index + 1];
      index += 1;
    } else if (arg === "--connector-id") {
      options.connectorId = argv[index + 1];
      index += 1;
    } else if (arg === "--connector-type") {
      options.connectorType = argv[index + 1];
      index += 1;
    } else if (arg === "--captured-at") {
      options.capturedAt = argv[index + 1];
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
    } else if (arg === "--json" || arg === "--dry-run") {
      options.json = options.json || arg === "--json";
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage: node scripts/local-manual-capture.mjs --file <path> --scope <dir> --workspace <id> --requested-by <owner> --capture-reason <reason> [--json] [--write-plan <file>]",
    "       node scripts/local-manual-capture.mjs --apply-plan <file> --out-dir <staging-dir> [--json]",
    "       node scripts/local-manual-capture.mjs --commit-staging <staging-dir> --vault-root <identity-vault> --owner-confirmed [--json]",
    "",
    "Dry-runs one explicit local/manual source capture. Reads only --file, emits source registry and snapshot plan, and never writes to the vault.",
    "Applies a saved dry-run plan only to a reviewable staging directory outside identity-vault.",
    "Commits reviewed staging into the final vault source and snapshot registries only after explicit owner confirmation."
  ].join("\n");
}

function hasValue(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function ensureTrailingSeparator(value) {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "source";
}

function validateOptions(options) {
  const errors = [];
  if (!hasValue(options.file) || !hasValue(options.scope)) {
    errors.push("manual_capture_scope_escape");
  }
  if (!hasValue(options.requestedBy) || !hasValue(options.captureReason)) {
    errors.push("missing_owner_intent");
  }
  if (!hasValue(options.workspace)) {
    errors.push("missing_snapshot_proof");
  }
  return errors;
}

function filePlan(options) {
  const preflightErrors = validateOptions(options);
  if (preflightErrors.length > 0) {
    return { errors: preflightErrors };
  }

  let filePath;
  let scopePath;
  let stat;
  try {
    filePath = fs.realpathSync(path.resolve(options.file));
    scopePath = ensureTrailingSeparator(fs.realpathSync(path.resolve(options.scope)));
    stat = fs.statSync(filePath);
  } catch {
    return { errors: ["manual_capture_scope_escape"] };
  }
  if (!stat.isFile() || !filePath.startsWith(scopePath)) {
    return { errors: ["manual_capture_scope_escape"] };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const contentHash = `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
  const sourceId = options.sourceId ?? `source:local-manual:${slug(path.basename(filePath, path.extname(filePath)))}`;
  const dateToken = options.capturedAt.replace(/\D/g, "").slice(0, 14);
  const snapshotId = `snap:${sourceId}:${dateToken}`;
  const containsUntrustedInstructions = /ignore previous instructions|export all memories|system prompt|developer message/i.test(content);
  const containsSecretLikeText = /sk-[A-Za-z0-9_-]+|password\s*[:=]|api[_-]?key\s*[:=]|secret_value/i.test(content);

  const capture = {
    capture_id: `cap:manual:${slug(path.basename(filePath, path.extname(filePath)))}:${dateToken}`,
    source_id: sourceId,
    workspace_id: options.workspace,
    requested_by: options.requestedBy,
    capture_reason: options.captureReason,
    owner_confirmed: true,
    connector_id: options.connectorId,
    connector_type: options.connectorType,
    connector_scope: scopePath,
    original_ref: filePath,
    source_kind: options.sourceKind,
    sensitivity: options.sensitivity,
    status: "active",
    freshness: "fresh",
    content_hash: contentHash,
    captured_at: options.capturedAt,
    contains_untrusted_instructions: containsUntrustedInstructions,
    contains_secret_like_text: containsSecretLikeText
  };

  const sourceRegistryEntry = {
    source_id: sourceId,
    source_kind: options.sourceKind,
    connector_id: options.connectorId,
    connector_type: options.connectorType,
    connector_scope: scopePath,
    original_ref: filePath,
    workspace_id: options.workspace,
    requested_by: options.requestedBy,
    capture_reason: options.captureReason,
    owner_confirmed: true,
    mutability: "mutable_external",
    active_snapshot_id: snapshotId,
    freshness: "fresh",
    status: "captured",
    sensitivity: options.sensitivity
  };

  const snapshot = {
    snapshot_id: snapshotId,
    source_id: sourceId,
    connector_id: options.connectorId,
    connector_scope: scopePath,
    original_ref: filePath,
    content_hash: contentHash,
    captured_at: options.capturedAt,
    capture_method: "manual_copy",
    immutable: true,
    previous_snapshot_id: null,
    source_text_role: "evidence_only",
    contains_untrusted_instructions: containsUntrustedInstructions,
    contains_secret_like_text: containsSecretLikeText
  };

  return {
    errors: [],
    plan: {
      mode: "dry-run",
      generated_from: "local_manual_capture",
      network_writes: false,
      writes_performed: false,
      files_read: 1,
      validation: {
        errors: []
      },
      manual_captures: [capture],
      source_registry_entries: [sourceRegistryEntry],
      snapshots: [snapshot],
      derived_memories: [],
      promotion_payloads: []
    }
  };
}

function resolveWritablePlanPath(outputPath) {
  if (!hasValue(outputPath)) return null;
  const requestedPath = path.resolve(outputPath);
  const parent = path.dirname(requestedPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("write_plan_parent_missing");
  }
  if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isDirectory()) {
    throw new Error("write_plan_target_is_directory");
  }
  return path.join(fs.realpathSync(parent), path.basename(requestedPath));
}

function writePlanFile(plan, outputPath) {
  if (!outputPath) return;
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
}

function readJsonFile(inputPath) {
  try {
    return JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch {
    throw new Error("apply_plan_unreadable");
  }
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveApplyPlanPath(inputPath) {
  if (!hasValue(inputPath)) {
    throw new Error("missing_apply_plan");
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("apply_plan_unreadable");
  }
  return fs.realpathSync(resolved);
}

function resolveApplyOutDir(outputDir) {
  if (!hasValue(outputDir)) {
    throw new Error("missing_apply_out_dir");
  }

  const requestedPath = path.resolve(outputDir);
  const parent = path.dirname(requestedPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("apply_plan_parent_missing");
  }
  if (fs.existsSync(requestedPath) && !fs.statSync(requestedPath).isDirectory()) {
    throw new Error("apply_plan_out_dir_is_file");
  }

  const vaultRoot = path.resolve("identity-vault");
  if (isPathInside(vaultRoot, requestedPath)) {
    throw new Error("apply_plan_vault_write_forbidden");
  }

  fs.mkdirSync(requestedPath, { recursive: true });
  if (fs.readdirSync(requestedPath).length > 0) {
    throw new Error("apply_plan_out_dir_not_empty");
  }

  return fs.realpathSync(requestedPath);
}

function planContainsRawContentField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => planContainsRawContentField(item));
  }
  return Object.entries(value).some(([key, nestedValue]) => {
    if (["body", "content", "raw_content", "source_text"].includes(key)) {
      return true;
    }
    return planContainsRawContentField(nestedValue);
  });
}

function validateApplyPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("apply_plan_invalid");
  }
  if (plan.generated_from !== "local_manual_capture" || plan.mode !== "dry-run") {
    throw new Error("apply_plan_invalid");
  }
  if (plan.network_writes !== false || plan.writes_performed !== false) {
    throw new Error("apply_plan_invalid");
  }
  if (!plan.validation || !Array.isArray(plan.validation.errors) || plan.validation.errors.length > 0) {
    throw new Error("apply_plan_invalid");
  }
  if (planContainsRawContentField(plan)) {
    throw new Error("apply_plan_contains_raw_content");
  }

  const requiredArrays = ["manual_captures", "source_registry_entries", "snapshots", "derived_memories", "promotion_payloads"];
  for (const key of requiredArrays) {
    if (!Array.isArray(plan[key])) {
      throw new Error("apply_plan_invalid");
    }
  }
  if (plan.manual_captures.length === 0 || plan.source_registry_entries.length === 0 || plan.snapshots.length === 0) {
    throw new Error("apply_plan_invalid");
  }
  if (plan.derived_memories.length > 0 || plan.promotion_payloads.length > 0) {
    throw new Error("apply_plan_invalid");
  }

  for (const capture of plan.manual_captures) {
    if (!hasValue(capture.source_id) || !hasValue(capture.original_ref) || capture.owner_confirmed !== true) {
      throw new Error("apply_plan_invalid");
    }
  }
  for (const entry of plan.source_registry_entries) {
    if (!hasValue(entry.source_id) || !hasValue(entry.active_snapshot_id) || entry.owner_confirmed !== true) {
      throw new Error("apply_plan_invalid");
    }
  }
  for (const snapshot of plan.snapshots) {
    if (
      !hasValue(snapshot.snapshot_id) ||
      !hasValue(snapshot.source_id) ||
      typeof snapshot.content_hash !== "string" ||
      !snapshot.content_hash.startsWith("sha256:") ||
      snapshot.immutable !== true ||
      snapshot.source_text_role !== "evidence_only"
    ) {
      throw new Error("apply_plan_invalid");
    }
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveStagingDir(inputPath) {
  if (!hasValue(inputPath)) {
    throw new Error("missing_commit_staging_dir");
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("commit_staging_unreadable");
  }
  return fs.realpathSync(resolved);
}

function readStagingPlan(stagingDir) {
  const manifestPath = path.join(stagingDir, "manifest.json");
  const capturePlanPath = path.join(stagingDir, "capture-plan.json");
  const sourceRegistryPath = path.join(stagingDir, "source-registry.json");
  const snapshotsPath = path.join(stagingDir, "snapshots.json");
  for (const requiredPath of [manifestPath, capturePlanPath, sourceRegistryPath, snapshotsPath]) {
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
      throw new Error("commit_staging_incomplete");
    }
  }

  const manifest = readJsonFile(manifestPath);
  const plan = readJsonFile(capturePlanPath);
  const stagedSourceRegistry = readJsonFile(sourceRegistryPath);
  const stagedSnapshots = readJsonFile(snapshotsPath);
  if (
    manifest.generated_from !== "local_manual_capture" ||
    manifest.mode !== "apply-plan" ||
    manifest.staging_only !== true ||
    manifest.vault_writes_performed !== false ||
    !Array.isArray(stagedSourceRegistry.source_registry_entries) ||
    !Array.isArray(stagedSnapshots.snapshots)
  ) {
    throw new Error("commit_staging_invalid");
  }
  validateApplyPlan(plan);
  if (
    JSON.stringify(stagedSourceRegistry.source_registry_entries) !== JSON.stringify(plan.source_registry_entries) ||
    JSON.stringify(stagedSnapshots.snapshots) !== JSON.stringify(plan.snapshots)
  ) {
    throw new Error("commit_staging_invalid");
  }
  return { manifest, plan };
}

function resolveVaultRoot(inputPath) {
  if (!hasValue(inputPath)) {
    throw new Error("missing_vault_root");
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("vault_root_unreadable");
  }
  return fs.realpathSync(resolved);
}

function registryPaths(vaultRoot) {
  const paths = {
    sourceRegistry: path.join(vaultRoot, "00_inbox", "source_registry.md"),
    snapshotRegistry: path.join(vaultRoot, "00_inbox", "snapshot_registry.md")
  };
  if (!fs.existsSync(paths.sourceRegistry) || !fs.existsSync(paths.snapshotRegistry)) {
    throw new Error("vault_registry_missing");
  }
  return paths;
}

function markdownCell(value) {
  if (value === null || value === undefined || value === "") return "none";
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function codeCell(value) {
  const normalized = markdownCell(value);
  return normalized === "none" ? normalized : `\`${normalized}\``;
}

function sourceRegistryRow(entry) {
  return [
    codeCell(entry.source_id),
    markdownCell(entry.source_kind),
    codeCell(entry.connector_id),
    codeCell(entry.original_ref),
    markdownCell(entry.mutability),
    codeCell(entry.active_snapshot_id),
    markdownCell(entry.freshness),
    markdownCell(entry.status),
    markdownCell(entry.sensitivity),
    "none"
  ].join(" | ");
}

function snapshotRegistryRow(snapshot) {
  return [
    codeCell(snapshot.snapshot_id),
    codeCell(snapshot.source_id),
    markdownCell(snapshot.captured_at),
    markdownCell(snapshot.capture_method),
    codeCell(snapshot.content_hash),
    codeCell(snapshot.previous_snapshot_id),
    "initial_capture",
    "fresh"
  ].join(" | ");
}

function prepareRegistryAppend(filePath, rows, duplicateValues, duplicateError) {
  const existing = fs.readFileSync(filePath, "utf8");
  for (const value of duplicateValues) {
    if (existing.includes(`\`${value}\``)) {
      throw new Error(duplicateError);
    }
  }
  const marker = "\n## Rules";
  const markerIndex = existing.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error("vault_registry_rules_marker_missing");
  }
  const rowsText = rows.map((row) => `| ${row} |`).join("\n");
  const prefix = existing.slice(0, markerIndex).replace(/\s*$/, "");
  const suffix = existing.slice(markerIndex);
  return `${prefix}\n${rowsText}\n${suffix}`;
}

function commitStaging(stagingPath, vaultRootPath, ownerConfirmed) {
  if (!ownerConfirmed) {
    throw new Error("owner_confirmation_required");
  }
  const stagingDir = resolveStagingDir(stagingPath);
  const { manifest, plan } = readStagingPlan(stagingDir);
  const vaultRoot = resolveVaultRoot(vaultRootPath);
  const paths = registryPaths(vaultRoot);

  const nextSourceRegistry = prepareRegistryAppend(
    paths.sourceRegistry,
    plan.source_registry_entries.map((entry) => sourceRegistryRow(entry)),
    plan.source_registry_entries.map((entry) => entry.source_id),
    "vault_source_already_exists"
  );
  const nextSnapshotRegistry = prepareRegistryAppend(
    paths.snapshotRegistry,
    plan.snapshots.map((snapshot) => snapshotRegistryRow(snapshot)),
    plan.snapshots.map((snapshot) => snapshot.snapshot_id),
    "vault_snapshot_already_exists"
  );

  fs.writeFileSync(paths.sourceRegistry, nextSourceRegistry);
  fs.writeFileSync(paths.snapshotRegistry, nextSnapshotRegistry);

  return {
    mode: "commit-staging",
    generated_from: "local_manual_capture",
    source_staging: stagingDir,
    source_plan: manifest.source_plan,
    vault_root: vaultRoot,
    network_writes: false,
    writes_performed: true,
    staging_only: false,
    vault_writes_performed: true,
    owner_confirmed: true,
    source_count: plan.source_registry_entries.length,
    snapshot_count: plan.snapshots.length,
    files_written: 2,
    destination_paths: [paths.sourceRegistry, paths.snapshotRegistry],
    validation: {
      errors: []
    }
  };
}

function applyPlanFile(planPath, outDir) {
  const resolvedPlanPath = resolveApplyPlanPath(planPath);
  const plan = readJsonFile(resolvedPlanPath);
  validateApplyPlan(plan);

  const stagingDir = resolveApplyOutDir(outDir);
  const stagedFiles = [
    ["capture-plan.json", plan],
    ["manual-captures.json", { manual_captures: plan.manual_captures }],
    ["source-registry.json", { source_registry_entries: plan.source_registry_entries }],
    ["snapshots.json", { snapshots: plan.snapshots }]
  ];

  const writtenFiles = [];
  for (const [fileName, payload] of stagedFiles) {
    const filePath = path.join(stagingDir, fileName);
    writeJsonFile(filePath, payload);
    writtenFiles.push(filePath);
  }

  const result = {
    mode: "apply-plan",
    generated_from: "local_manual_capture",
    source_plan: resolvedPlanPath,
    out_dir: stagingDir,
    network_writes: false,
    writes_performed: true,
    staging_only: true,
    vault_writes_performed: false,
    source_count: plan.source_registry_entries.length,
    snapshot_count: plan.snapshots.length,
    manual_capture_count: plan.manual_captures.length,
    files_written: writtenFiles.length + 1,
    written_files: [...writtenFiles, path.join(stagingDir, "manifest.json")],
    validation: {
      errors: []
    }
  };
  writeJsonFile(path.join(stagingDir, "manifest.json"), result);
  return result;
}

function printApplyResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`mode=${result.mode} staging_only=${result.staging_only} writes_performed=${result.writes_performed}\n`);
  process.stdout.write(`out_dir=${result.out_dir}\n`);
  process.stdout.write(`files_written=${result.files_written}\n`);
}

function printCommitResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`mode=${result.mode} vault_writes_performed=${result.vault_writes_performed} owner_confirmed=${result.owner_confirmed}\n`);
  process.stdout.write(`vault_root=${result.vault_root}\n`);
  process.stdout.write(`files_written=${result.files_written}\n`);
}

function printPlan(plan, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const capture = plan.manual_captures[0];
  const snapshot = plan.snapshots[0];
  process.stdout.write(`mode=${plan.mode} files_read=${plan.files_read} writes_performed=${plan.writes_performed}\n`);
  process.stdout.write(`source_id=${capture.source_id}\n`);
  process.stdout.write(`snapshot_id=${snapshot.snapshot_id}\n`);
  process.stdout.write(`content_hash=${snapshot.content_hash}\n`);
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    if (options.applyPlan && options.commitStaging) {
      throw new Error("capture_mode_conflict");
    }
    if (options.commitStaging) {
      const result = commitStaging(options.commitStaging, options.vaultRoot, options.ownerConfirmed);
      printCommitResult(result, options.json);
      return;
    }
    if (options.applyPlan) {
      const result = applyPlanFile(options.applyPlan, options.outDir);
      printApplyResult(result, options.json);
      return;
    }
    const result = filePlan(options);
    if (result.errors.length > 0) {
      throw new Error(result.errors.join(","));
    }
    const writtenPath = resolveWritablePlanPath(options.writePlan);
    if (writtenPath) {
      result.plan.plan_written_to = writtenPath;
      writePlanFile(result.plan, writtenPath);
    }
    printPlan(result.plan, options.json);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();
