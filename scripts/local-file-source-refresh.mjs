#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    input: null,
    sourceId: null,
    checkedAt: new Date().toISOString(),
    writePlan: null,
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
    "",
    "Refresh-checks one registered local_file source through a bounded local file connector. Emits a dry-run refresh plan and never writes to the vault."
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

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
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
