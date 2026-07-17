#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { materializeSnapshotArtifact } from "./lib/snapshot-artifacts.mjs";
import { withVaultMutationLock, writeRegistryPairRecoverable } from "./lib/registry-transaction.mjs";

function parseArgs(argv) {
  const options = {
    input: null,
    sourceId: null,
    checkedAt: new Date().toISOString(),
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
    } else if (arg === "--input") {
      options.input = argv[index + 1];
      index += 1;
    } else if (arg === "--source-id") {
      options.sourceId = argv[index + 1];
      index += 1;
    } else if (arg === "--checked-at") {
      options.checkedAt = argv[index + 1];
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
    "Usage: node scripts/local-file-source-refresh.mjs --input <registry.json> --source-id <source-id> [--checked-at <iso>] [--write-plan <file>] [--json]",
    "       node scripts/local-file-source-refresh.mjs --apply-plan <file> --out-dir <staging-dir> [--json]",
    "       node scripts/local-file-source-refresh.mjs --commit-staging <staging-dir> --vault-root <identity-vault> --owner-confirmed [--json]",
    "",
    "Refresh-checks one registered local_file source through a bounded local file connector. Emits a dry-run refresh plan and never writes to the vault.",
    "Applies a saved dry-run refresh plan only to a reviewable staging directory outside identity-vault.",
    "Commits reviewed refresh staging into the final vault source and snapshot registries only after explicit owner confirmation."
  ].join("\n");
}

function list(input, key) {
  return Array.isArray(input?.[key]) ? input[key] : [];
}

function byId(items, key) {
  return new Map(items.map((item) => [item?.[key], item]).filter(([value]) => Boolean(value)));
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

function readInput(inputPath) {
  if (!hasValue(inputPath)) throw new Error("missing_input");
  const fullPath = path.resolve(inputPath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error("input_unreadable");
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
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

function readJsonFile(inputPath, errorCode) {
  try {
    return JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch {
    throw new Error(errorCode);
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

function validateBaseApplyPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("apply_plan_invalid");
  }
  if (plan.generated_from !== "local_file_source_refresh" || plan.mode !== "dry-run") {
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

  const requiredArrays = [
    "connector_registry",
    "sources",
    "snapshots",
    "connector_runs",
    "connector_results",
    "refresh_candidates",
    "refresh_plans",
    "validated_memories",
    "review_items",
    "promotion_payloads"
  ];
  for (const key of requiredArrays) {
    if (!Array.isArray(plan[key])) {
      throw new Error("apply_plan_invalid");
    }
  }
  if (
    plan.connector_runs.length === 0 ||
    plan.connector_results.length === 0 ||
    plan.refresh_candidates.length === 0 ||
    plan.refresh_plans.length === 0 ||
    plan.promotion_payloads.length > 0
  ) {
    throw new Error("apply_plan_invalid");
  }
}

function snapshotCandidatesFor(plan) {
  const snapshotsById = byId(plan.snapshots, "snapshot_id");
  return plan.refresh_plans
    .filter((refreshPlan) => hasValue(refreshPlan.created_snapshot_id))
    .map((refreshPlan) => {
      const snapshot = snapshotsById.get(refreshPlan.created_snapshot_id);
      if (!snapshot) {
        throw new Error("apply_plan_malformed_lineage");
      }
      return snapshot;
    });
}

function validateRefreshLineage(plan) {
  const candidatesById = byId(plan.refresh_candidates, "candidate_id");
  const resultsById = byId(plan.connector_results, "result_id");
  const reviewItemsById = byId(plan.review_items, "review_id");
  const snapshotCandidates = snapshotCandidatesFor(plan);
  const snapshotCandidatesById = byId(snapshotCandidates, "snapshot_id");

  for (const refreshPlan of plan.refresh_plans) {
    if (!hasValue(refreshPlan.source_id) || !hasValue(refreshPlan.candidate_id) || !hasValue(refreshPlan.operation)) {
      throw new Error("apply_plan_invalid");
    }
    const candidate = candidatesById.get(refreshPlan.candidate_id);
    if (!candidate || candidate.source_id !== refreshPlan.source_id || !hasValue(candidate.connector_result_id)) {
      throw new Error("apply_plan_malformed_lineage");
    }
    const result = resultsById.get(candidate.connector_result_id);
    if (!result || result.source_id !== refreshPlan.source_id) {
      throw new Error("apply_plan_malformed_lineage");
    }

    if (refreshPlan.operation === "create_snapshot") {
      if (!hasValue(refreshPlan.created_snapshot_id) || !hasValue(refreshPlan.previous_snapshot_id)) {
        throw new Error("apply_plan_malformed_lineage");
      }
      const snapshot = snapshotCandidatesById.get(refreshPlan.created_snapshot_id);
      if (
        !snapshot ||
        snapshot.immutable !== true ||
        snapshot.previous_snapshot_id !== refreshPlan.previous_snapshot_id ||
        snapshot.connector_result_id !== result.result_id ||
        snapshot.source_id !== refreshPlan.source_id
      ) {
        throw new Error("apply_plan_malformed_lineage");
      }
      if (hasValue(refreshPlan.review_id)) {
        const review = reviewItemsById.get(refreshPlan.review_id);
        if (
          !review ||
          review.old_snapshot_id !== refreshPlan.previous_snapshot_id ||
          review.new_snapshot_id !== refreshPlan.created_snapshot_id ||
          review.source_id !== refreshPlan.source_id
        ) {
          throw new Error("apply_plan_malformed_lineage");
        }
      }
    } else if (hasValue(refreshPlan.created_snapshot_id)) {
      throw new Error("apply_plan_malformed_lineage");
    }
  }
}

function validateApplyPlan(plan) {
  validateBaseApplyPlan(plan);
  validateRefreshLineage(plan);
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function applyPlanFile(planPath, outDir) {
  const resolvedPlanPath = resolveApplyPlanPath(planPath);
  const plan = readJsonFile(resolvedPlanPath, "apply_plan_unreadable");
  validateApplyPlan(plan);

  const stagingDir = resolveApplyOutDir(outDir);
  const snapshotCandidates = snapshotCandidatesFor(plan);
  const stagedFiles = [
    ["refresh-plan.json", plan],
    ["connector-runs.json", { connector_runs: plan.connector_runs }],
    ["connector-results.json", { connector_results: plan.connector_results }],
    ["refresh-candidates.json", { refresh_candidates: plan.refresh_candidates }],
    ["refresh-plans.json", { refresh_plans: plan.refresh_plans }],
    ["snapshot-candidates.json", { snapshots: snapshotCandidates }],
    ["review-items.json", { review_items: plan.review_items }]
  ];

  const writtenFiles = [];
  for (const [fileName, payload] of stagedFiles) {
    const filePath = path.join(stagingDir, fileName);
    writeJsonFile(filePath, payload);
    writtenFiles.push(filePath);
  }

  const result = {
    mode: "apply-plan",
    generated_from: "local_file_source_refresh",
    source_plan: resolvedPlanPath,
    out_dir: stagingDir,
    network_writes: false,
    writes_performed: true,
    staging_only: true,
    vault_writes_performed: false,
    connector_run_count: plan.connector_runs.length,
    connector_result_count: plan.connector_results.length,
    refresh_candidate_count: plan.refresh_candidates.length,
    refresh_plan_count: plan.refresh_plans.length,
    snapshot_candidate_count: snapshotCandidates.length,
    review_item_count: plan.review_items.length,
    files_written: writtenFiles.length + 1,
    written_files: [...writtenFiles, path.join(stagingDir, "manifest.json")],
    validation: {
      errors: []
    }
  };
  writeJsonFile(path.join(stagingDir, "manifest.json"), result);
  return result;
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

function readRequiredStagingJson(stagingDir, fileName) {
  const filePath = path.join(stagingDir, fileName);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error("commit_staging_incomplete");
  }
  return readJsonFile(filePath, "commit_staging_invalid");
}

function readRefreshStaging(stagingPath) {
  const stagingDir = resolveStagingDir(stagingPath);
  const manifest = readRequiredStagingJson(stagingDir, "manifest.json");
  const plan = readRequiredStagingJson(stagingDir, "refresh-plan.json");
  const stagedConnectorRuns = readRequiredStagingJson(stagingDir, "connector-runs.json");
  const stagedConnectorResults = readRequiredStagingJson(stagingDir, "connector-results.json");
  const stagedRefreshCandidates = readRequiredStagingJson(stagingDir, "refresh-candidates.json");
  const stagedRefreshPlans = readRequiredStagingJson(stagingDir, "refresh-plans.json");
  const stagedSnapshotCandidates = readRequiredStagingJson(stagingDir, "snapshot-candidates.json");
  const stagedReviewItems = readRequiredStagingJson(stagingDir, "review-items.json");

  if (
    manifest.generated_from !== "local_file_source_refresh" ||
    manifest.mode !== "apply-plan" ||
    manifest.staging_only !== true ||
    manifest.vault_writes_performed !== false ||
    !Array.isArray(stagedConnectorRuns.connector_runs) ||
    !Array.isArray(stagedConnectorResults.connector_results) ||
    !Array.isArray(stagedRefreshCandidates.refresh_candidates) ||
    !Array.isArray(stagedRefreshPlans.refresh_plans) ||
    !Array.isArray(stagedSnapshotCandidates.snapshots) ||
    !Array.isArray(stagedReviewItems.review_items)
  ) {
    throw new Error("commit_staging_invalid");
  }

  validateApplyPlan(plan);
  const snapshotCandidates = snapshotCandidatesFor(plan);
  if (
    JSON.stringify(stagedConnectorRuns.connector_runs) !== JSON.stringify(plan.connector_runs) ||
    JSON.stringify(stagedConnectorResults.connector_results) !== JSON.stringify(plan.connector_results) ||
    JSON.stringify(stagedRefreshCandidates.refresh_candidates) !== JSON.stringify(plan.refresh_candidates) ||
    JSON.stringify(stagedRefreshPlans.refresh_plans) !== JSON.stringify(plan.refresh_plans) ||
    JSON.stringify(stagedSnapshotCandidates.snapshots) !== JSON.stringify(snapshotCandidates) ||
    JSON.stringify(stagedReviewItems.review_items) !== JSON.stringify(plan.review_items) ||
    manifest.snapshot_candidate_count !== snapshotCandidates.length ||
    manifest.refresh_plan_count !== plan.refresh_plans.length
  ) {
    throw new Error("commit_staging_invalid");
  }

  return { stagingDir, manifest, plan, snapshotCandidates };
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
  if (!fs.existsSync(paths.sourceRegistry) || fs.lstatSync(paths.sourceRegistry).isSymbolicLink() || !fs.lstatSync(paths.sourceRegistry).isFile()) {
    throw new Error("vault_registry_missing");
  }
  if (!fs.existsSync(paths.snapshotRegistry) || fs.lstatSync(paths.snapshotRegistry).isSymbolicLink() || !fs.lstatSync(paths.snapshotRegistry).isFile()) {
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

function sourceRegistryRow(source, snapshotId) {
  return [
    codeCell(source.source_id),
    markdownCell(source.source_kind),
    codeCell(source.connector_id),
    codeCell(source.original_ref),
    markdownCell(source.mutability ?? "mutable_external"),
    codeCell(snapshotId),
    "fresh",
    markdownCell(source.status === "do_not_use" ? "do_not_use" : "active"),
    markdownCell(source.sensitivity ?? "medium"),
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
    markdownCell(snapshot.change_status ?? "changed"),
    "fresh"
  ].join(" | ");
}

function replaceSourceRegistryRow(existing, sourceId, nextRow) {
  const lines = existing.split(/\r?\n/);
  const sourceToken = `\`${sourceId}\``;
  const index = lines.findIndex((line) => line.startsWith("|") && line.includes(sourceToken));
  if (index === -1) {
    throw new Error("vault_source_missing");
  }
  lines[index] = `| ${nextRow} |`;
  return lines.join("\n");
}

function appendSnapshotRegistryRow(existing, snapshot, nextRow) {
  if (existing.includes(`\`${snapshot.snapshot_id}\``)) {
    throw new Error("vault_snapshot_already_exists");
  }
  const marker = "\n## Rules";
  const markerIndex = existing.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error("vault_registry_rules_marker_missing");
  }
  const prefix = existing.slice(0, markerIndex).replace(/\s*$/, "");
  const suffix = existing.slice(markerIndex);
  return `${prefix}\n| ${nextRow} |\n${suffix}`;
}

function commitStaging(stagingPath, vaultRootPath, ownerConfirmed) {
  if (!ownerConfirmed) {
    throw new Error("owner_confirmation_required");
  }
  const { stagingDir, manifest, plan, snapshotCandidates } = readRefreshStaging(stagingPath);
  if (plan.refresh_plans.length !== 1 || snapshotCandidates.length !== 1 || plan.refresh_plans[0].operation !== "create_snapshot") {
    throw new Error("commit_staging_not_changed_source");
  }

  const refreshPlan = plan.refresh_plans[0];
  const snapshot = snapshotCandidates[0];
  if (snapshot.snapshot_id !== refreshPlan.created_snapshot_id || snapshot.change_status !== "changed") {
    throw new Error("commit_staging_invalid");
  }
  const source = byId(plan.sources, "source_id").get(refreshPlan.source_id);
  if (!source || source.status === "do_not_use") {
    throw new Error("commit_staging_not_changed_source");
  }

  const vaultRoot = resolveVaultRoot(vaultRootPath);
  return withVaultMutationLock(vaultRoot, ({ recovery }) => {
    const paths = registryPaths(vaultRoot);
    const sourceRegistry = fs.readFileSync(paths.sourceRegistry, "utf8");
    const snapshotRegistry = fs.readFileSync(paths.snapshotRegistry, "utf8");
    const nextSourceRegistry = replaceSourceRegistryRow(
      sourceRegistry,
      source.source_id,
      sourceRegistryRow(source, snapshot.snapshot_id)
    );
    const nextSnapshotRegistry = appendSnapshotRegistryRow(
      snapshotRegistry,
      snapshot,
      snapshotRegistryRow(snapshot)
    );
    const snapshotArtifacts = [materializeSnapshotArtifact({
      vaultRoot,
      originalRef: snapshot.original_ref ?? source.original_ref,
      contentHash: snapshot.content_hash,
      snapshotId: snapshot.snapshot_id
    })];
    const registryTransaction = writeRegistryPairRecoverable({
      vaultRoot,
      sourceRegistry: paths.sourceRegistry,
      snapshotRegistry: paths.snapshotRegistry,
      nextSourceRegistry,
      nextSnapshotRegistry
    });
    return {
    mode: "commit-staging",
    generated_from: "local_file_source_refresh",
    source_staging: stagingDir,
    source_plan: manifest.source_plan,
    vault_root: vaultRoot,
    network_writes: false,
    writes_performed: true,
    staging_only: false,
    vault_writes_performed: true,
    owner_confirmed: true,
    source_id: source.source_id,
    previous_snapshot_id: refreshPlan.previous_snapshot_id,
    active_snapshot_id: snapshot.snapshot_id,
    snapshot_count: 1,
    snapshot_artifacts: snapshotArtifacts,
    registry_transaction: registryTransaction,
    recovered_previous_transaction: recovery.recovered,
    files_written: 2 + snapshotArtifacts.filter((artifact) => artifact.created).length,
    destination_paths: [paths.sourceRegistry, paths.snapshotRegistry],
    validation: {
      errors: []
    }
    };
  });
}

function realPathIfExists(value) {
  return fs.realpathSync(path.resolve(value));
}

function pathInsideScope(filePath, scopePath) {
  return filePath.startsWith(ensureTrailingSeparator(scopePath));
}

function resolveLocalScope(scope) {
  if (!hasValue(scope)) throw new Error("connector_scope_escape");
  try {
    return realPathIfExists(scope);
  } catch {
    throw new Error("connector_scope_escape");
  }
}

function validateConnector(source, connector) {
  if (!source || !connector || source.connector_id !== connector.connector_id) {
    throw new Error("unauthorized_connector_used");
  }
  if (connector.connector_type !== "local_file") {
    throw new Error("unsupported_connector_type");
  }
  if (connector.status !== "enabled" || connector.auth_status !== "configured") {
    throw new Error("unauthorized_connector_used");
  }
  if (connector.workspace_id && source.workspace_id && connector.workspace_id !== source.workspace_id) {
    throw new Error("unauthorized_connector_used");
  }
  if (
    Array.isArray(connector.allowed_source_kinds) &&
    source.source_kind &&
    !connector.allowed_source_kinds.includes(source.source_kind)
  ) {
    throw new Error("unauthorized_connector_used");
  }
}

function validateLocalScope(source, connector) {
  const sourceScope = resolveLocalScope(source.connector_scope);
  const allowedScopes = Array.isArray(connector.allowed_scopes) ? connector.allowed_scopes : [];
  const allowedRealScopes = allowedScopes.map((scope) => resolveLocalScope(scope));
  if (!allowedRealScopes.some((scope) => scope === sourceScope)) {
    throw new Error("connector_scope_escape");
  }

  let sourceRef;
  try {
    sourceRef = realPathIfExists(source.original_ref);
  } catch {
    const resolvedRef = path.resolve(source.original_ref);
    const refParent = path.dirname(resolvedRef);
    const requestedRef = fs.existsSync(refParent)
      ? path.join(realPathIfExists(refParent), path.basename(resolvedRef))
      : resolvedRef;
    if (!pathInsideScope(requestedRef, sourceScope)) {
      throw new Error("connector_scope_escape");
    }
    return {
      sourceScope,
      sourceRef: requestedRef,
      refExists: false
    };
  }
  if (!pathInsideScope(sourceRef, sourceScope)) {
    throw new Error("connector_scope_escape");
  }
  return { sourceScope, sourceRef, refExists: true };
}

function contentHash(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function dateToken(iso) {
  return String(iso).replace(/\D/g, "").slice(0, 14);
}

function connectorRun(source, connector, checkedAt) {
  return {
    run_id: `run:${connector.connector_id}:${slug(source.source_id)}:${dateToken(checkedAt)}`,
    connector_id: connector.connector_id,
    connector_type: connector.connector_type,
    mode: "local_file",
    network_writes: false,
    started_at: checkedAt,
    secrets_redacted: true
  };
}

function connectorResultBase(run, source, sourceRef, checkedAt) {
  return {
    result_id: `result:${source.source_id}:${dateToken(checkedAt)}`,
    run_id: run.run_id,
    connector_id: source.connector_id,
    source_id: source.source_id,
    source_ref: sourceRef,
    checked_at: checkedAt,
    secrets_redacted: true
  };
}

function candidateFromResult(result, source, checkedAt, extra = {}) {
  return {
    candidate_id: `candidate:${source.source_id}:${dateToken(checkedAt)}`,
    connector_result_id: result.result_id,
    source_id: source.source_id,
    connector_id: source.connector_id,
    source_ref: result.source_ref,
    checked_at: checkedAt,
    result: result.result,
    ...extra
  };
}

function planFor(source, candidate, operation, extra = {}) {
  return {
    plan_id: `plan:${source.source_id}:${candidate.candidate_id}`,
    source_id: source.source_id,
    candidate_id: candidate.candidate_id,
    operation,
    ...extra
  };
}

function reviewItem(source, previousSnapshotId, newSnapshotId, affectedMemoryIds, checkedAt) {
  return {
    review_id: `review:${source.source_id}:${dateToken(checkedAt)}`,
    queue: "staleness_queue",
    source_id: source.source_id,
    old_snapshot_id: previousSnapshotId,
    new_snapshot_id: newSnapshotId,
    affected_memory_ids: affectedMemoryIds,
    status: "open"
  };
}

function affectedMemories(input, snapshotId) {
  return list(input, "validated_memories")
    .filter((memory) => Array.isArray(memory.derived_from) && memory.derived_from.includes(snapshotId))
    .map((memory) => ({
      ...memory,
      status: "needs_review",
      freshness: "changed",
      review_reason: "connector_snapshot_changed"
    }));
}

function buildRefreshPlan(input, sourceId, checkedAt) {
  if (!hasValue(sourceId)) throw new Error("missing_source_id");
  const connectors = byId(list(input, "connector_registry"), "connector_id");
  const sources = byId(list(input, "sources"), "source_id");
  const snapshots = byId(list(input, "snapshots"), "snapshot_id");
  const source = sources.get(sourceId);
  if (!source) throw new Error("source_not_registered");
  const connector = connectors.get(source.connector_id);
  validateConnector(source, connector);

  const scope = validateLocalScope(source, connector);
  const run = connectorRun(source, connector, checkedAt);
  const resultBase = connectorResultBase(run, source, scope.sourceRef, checkedAt);

  if (source.status === "do_not_use") {
    const result = {
      ...resultBase,
      result: "blocked",
      blocked_reason: "do_not_use"
    };
    const candidate = candidateFromResult(result, source, checkedAt, {
      blocked_reason: "do_not_use"
    });
    return outputPlan(input, {
      source,
      run,
      result,
      candidate,
      plan: planFor(source, candidate, "skip_do_not_use", {
        created_snapshot_id: null,
        freshness_after_check: "do_not_use"
      }),
      snapshots: list(input, "snapshots"),
      validatedMemories: list(input, "validated_memories"),
      reviewItems: [],
      filesRead: 0,
      checkedAt
    });
  }

  const activeSnapshot = snapshots.get(source.active_snapshot_id);
  if (!activeSnapshot) throw new Error("active_snapshot_missing");

  if (!scope.refExists) {
    const result = {
      ...resultBase,
      result: "unavailable",
      error_kind: "local_file_missing",
      retryable: true
    };
    const candidate = candidateFromResult(result, source, checkedAt, {
      unavailable_reason: "local_file_missing"
    });
    return outputPlan(input, {
      source,
      run,
      result,
      candidate,
      plan: planFor(source, candidate, "unavailable_last_known", {
        created_snapshot_id: null,
        freshness_after_check: "unavailable"
      }),
      snapshots: list(input, "snapshots"),
      validatedMemories: list(input, "validated_memories"),
      reviewItems: [],
      filesRead: 0,
      checkedAt
    });
  }

  if (!fs.statSync(scope.sourceRef).isFile()) {
    throw new Error("connector_scope_escape");
  }

  const content = fs.readFileSync(scope.sourceRef, "utf8");
  const hash = contentHash(content);
  const result = {
    ...resultBase,
    result: "available",
    content_hash: hash,
    connector_version: hash,
    capture_method: "connector_pull"
  };

  if (hash === activeSnapshot.content_hash) {
    const candidate = candidateFromResult(result, source, checkedAt, {
      content_hash: hash
    });
    return outputPlan(input, {
      source,
      run,
      result,
      candidate,
      plan: planFor(source, candidate, "unchanged", {
        created_snapshot_id: null,
        freshness_after_check: "fresh"
      }),
      snapshots: list(input, "snapshots"),
      validatedMemories: list(input, "validated_memories"),
      reviewItems: [],
      filesRead: 1,
      checkedAt
    });
  }

  const plannedSnapshotId = `snap:${source.source_id}:${dateToken(checkedAt)}`;
  result.planned_snapshot_id = plannedSnapshotId;
  result.previous_snapshot_id = source.active_snapshot_id;
  const candidate = candidateFromResult(result, source, checkedAt, {
    content_hash: hash,
    planned_snapshot_id: plannedSnapshotId,
    previous_snapshot_id: source.active_snapshot_id
  });
  const snapshot = {
    snapshot_id: plannedSnapshotId,
    source_id: source.source_id,
    original_ref: scope.sourceRef,
    content_hash: hash,
    previous_snapshot_id: source.active_snapshot_id,
    captured_at: checkedAt,
    capture_method: "connector_pull",
    connector_result_id: result.result_id,
    immutable: true,
    change_status: "changed"
  };
  const staleMemories = affectedMemories(input, source.active_snapshot_id);
  const review = reviewItem(
    source,
    source.active_snapshot_id,
    plannedSnapshotId,
    staleMemories.map((memory) => memory.memory_id),
    checkedAt
  );
  return outputPlan(input, {
    source,
    run,
    result,
    candidate,
    plan: planFor(source, candidate, "create_snapshot", {
      created_snapshot_id: plannedSnapshotId,
      previous_snapshot_id: source.active_snapshot_id,
      freshness_after_check: "changed",
      review_id: review.review_id
    }),
    snapshots: [...list(input, "snapshots"), snapshot],
    validatedMemories: mergeUpdatedMemories(list(input, "validated_memories"), staleMemories),
    reviewItems: staleMemories.length > 0 ? [review] : [],
    filesRead: 1,
    checkedAt
  });
}

function mergeUpdatedMemories(original, updates) {
  const updatesById = byId(updates, "memory_id");
  return original.map((memory) => updatesById.get(memory.memory_id) ?? memory);
}

function outputPlan(input, context) {
  return {
    mode: "dry-run",
    generated_from: "local_file_source_refresh",
    network_writes: false,
    writes_performed: false,
    files_read: context.filesRead,
    checked_at: context.checkedAt,
    connector_registry: list(input, "connector_registry"),
    sources: list(input, "sources"),
    snapshots: context.snapshots,
    connector_runs: [context.run],
    connector_results: [context.result],
    refresh_candidates: [context.candidate],
    refresh_plans: [context.plan],
    validated_memories: context.validatedMemories,
    review_items: context.reviewItems,
    promotion_payloads: [],
    validation: {
      errors: []
    }
  };
}

function printPlan(plan, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const refreshPlan = plan.refresh_plans[0];
  process.stdout.write(`mode=${plan.mode} operation=${refreshPlan.operation} files_read=${plan.files_read}\n`);
  process.stdout.write(`source_id=${refreshPlan.source_id}\n`);
  if (refreshPlan.created_snapshot_id) process.stdout.write(`created_snapshot_id=${refreshPlan.created_snapshot_id}\n`);
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

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    if (options.applyPlan && options.commitStaging) {
      throw new Error("refresh_mode_conflict");
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
    const input = readInput(options.input);
    const plan = buildRefreshPlan(input, options.sourceId, options.checkedAt);
    const writtenPath = resolveWritablePlanPath(options.writePlan);
    if (writtenPath) {
      plan.plan_written_to = writtenPath;
      writePlanFile(plan, writtenPath);
    }
    printPlan(plan, options.json);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
