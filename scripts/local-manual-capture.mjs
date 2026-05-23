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
    "Usage: node scripts/local-manual-capture.mjs --file <path> --scope <dir> --workspace <id> --requested-by <owner> --capture-reason <reason> [--json]",
    "",
    "Dry-runs one explicit local/manual source capture. Reads only --file, emits source registry and snapshot plan, and performs no writes."
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
    const result = filePlan(options);
    if (result.errors.length > 0) {
      throw new Error(result.errors.join(","));
    }
    printPlan(result.plan, options.json);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();
