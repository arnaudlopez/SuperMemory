#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildHindsightRequests, executeHindsightRequests } from "./hindsight-transport.mjs";

const requiredPromotionMetadata = [
  "source_id",
  "snapshot_id",
  "observation_id",
  "interpretation_id",
  "memory_id",
  "source_version",
  "freshness",
  "data_owner"
];

const requiredPromotionTagPrefixes = [
  "visibility:",
  "sensitivity:",
  "domain:",
  "source_kind:",
  "entity_type:",
  "schema_status:",
  "workspace:",
  "access_policy:",
  "consumer:"
];

const requiredRecallTagPrefixes = [
  "visibility:",
  "sensitivity:",
  "domain:",
  "entity_type:",
  "schema_status:",
  "workspace:",
  "access_policy:",
  "consumer:"
];

function list(input, key) {
  return Array.isArray(input?.[key]) ? input[key] : [];
}

function hasTagWithPrefix(tags, prefix) {
  return tags.some((tag) => typeof tag === "string" && tag.startsWith(prefix));
}

function tagValue(tags, prefix) {
  const tag = tags.find((item) => typeof item === "string" && item.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : null;
}

function isDoNotUse(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  return item?.status === "do_not_use" || tags.includes("status:do_not_use");
}

function hasRequiredRecallScope(policy) {
  const requiredTags = Array.isArray(policy.required_tags) ? policy.required_tags : [];
  return (
    policy.fail_closed === true &&
    requiredRecallTagPrefixes.every((prefix) => hasTagWithPrefix(requiredTags, prefix)) &&
    requiredTags.includes("status:active")
  );
}

function promotionHasProvenance(payload) {
  const metadata = payload.metadata ?? {};
  return (
    requiredPromotionMetadata.every((key) => Boolean(metadata[key])) &&
    Array.isArray(metadata.derived_from) &&
    metadata.derived_from.includes(metadata.snapshot_id)
  );
}

function promotionHasGovernance(payload) {
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const metadata = payload.metadata ?? {};
  const consumer = tagValue(tags, "consumer:");
  return (
    requiredPromotionTagPrefixes.every((prefix) => hasTagWithPrefix(tags, prefix)) &&
    tags.includes("status:active") &&
    metadata.workspace_id === tagValue(tags, "workspace:") &&
    metadata.access_policy === tagValue(tags, "access_policy:") &&
    Array.isArray(metadata.allowed_consumers) &&
    metadata.allowed_consumers.includes(consumer) &&
    ["approved", "reviewed"].includes(metadata.review_status ?? metadata.review_state)
  );
}

function deletionHasGovernance(payload) {
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const metadata = payload.metadata ?? {};
  const consumer = tagValue(tags, "consumer:");
  return (
    requiredPromotionTagPrefixes.every((prefix) => hasTagWithPrefix(tags, prefix)) &&
    tags.includes("status:do_not_use") &&
    metadata.workspace_id === tagValue(tags, "workspace:") &&
    metadata.access_policy === tagValue(tags, "access_policy:") &&
    Array.isArray(metadata.allowed_consumers) &&
    metadata.allowed_consumers.includes(consumer) &&
    metadata.review_status === "revoked" &&
    Boolean(metadata.revocation_reason)
  );
}

function isVaultSync(input) {
  return input?.contract_mode === "vault_sync_v1";
}

function registryRows(input, key) {
  return list(input, key);
}

function entityTypeRegistryStatus(input, entityType) {
  if (!entityType) return null;
  const row = registryRows(input, "entity_type_registry").find((item) => (
    item?.entity_type === entityType || item?.type === entityType
  ));
  return row?.status ?? null;
}

function snapshotRegistry(input) {
  return [...registryRows(input, "snapshot_registry"), ...registryRows(input, "snapshots")];
}

function snapshotIsRegistered(input, metadata) {
  const registry = snapshotRegistry(input);
  if (registry.length === 0) return false;
  return registry.some((snapshot) => (
    snapshot?.snapshot_id === metadata.snapshot_id &&
    (!snapshot.source_id || snapshot.source_id === metadata.source_id)
  ));
}

function hasVaultSyncMetadata(payload) {
  const metadata = payload.metadata ?? {};
  return (
    Boolean(metadata.source_version) &&
    Boolean(metadata.freshness) &&
    Array.isArray(metadata.derived_from) &&
    metadata.derived_from.length > 0 &&
    (!metadata.snapshot_id || metadata.derived_from.includes(metadata.snapshot_id))
  );
}

function parseArgs(argv) {
  const options = {
    input: null,
    bank: null,
    dryRun: false,
    live: false,
    json: false,
    mockTransport: false,
    writePlan: null,
    applyPlan: null,
    ownerConfirmed: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      options.input = argv[index + 1];
      index += 1;
    } else if (arg === "--bank") {
      options.bank = argv[index + 1];
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--mock-transport") {
      options.mockTransport = true;
    } else if (arg === "--write-plan") {
      options.writePlan = argv[index + 1];
      index += 1;
    } else if (arg === "--apply-plan") {
      options.applyPlan = argv[index + 1];
      index += 1;
    } else if (arg === "--owner-confirmed") {
      options.ownerConfirmed = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (options.applyPlan && options.input) {
    throw new Error("--apply-plan and --input are mutually exclusive");
  }
  if (!options.applyPlan && !options.input) {
    throw new Error("missing required --input <path>");
  }
  if (options.writePlan && options.applyPlan) {
    throw new Error("--write-plan and --apply-plan are mutually exclusive");
  }
  if (options.live && options.dryRun) {
    throw new Error("--live and --dry-run are mutually exclusive");
  }
  if (options.live && !options.mockTransport && !options.applyPlan) {
    throw new Error("live transport requires reviewed --apply-plan and --owner-confirmed");
  }
  if (!options.live && !options.applyPlan) {
    options.dryRun = true;
  }
  return options;
}

function readInput(inputPath) {
  const fullPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`missing input file: ${inputPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function readJsonFile(inputPath, errorCode = "input_unreadable") {
  try {
    return JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch {
    throw new Error(errorCode);
  }
}

function normalizeInput(input) {
  return input?.valid && typeof input.valid === "object" ? input.valid : input;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function promotionSource(input) {
  return input?.promotion_source ?? "promotion_payloads";
}

function validatedMemoryIsPromotable(memory) {
  return (
    memory?.status === "active" &&
    memory?.review_status === "approved" &&
    memory?.promote_to_hindsight === true
  );
}

function validatedMemoryIsRevocable(memory) {
  return (
    (memory?.status === "do_not_use" || memory?.review_status === "revoked") &&
    memory?.revoke_from_hindsight === true
  );
}

function validatedMemoryTags(memory) {
  return unique([
    ...(Array.isArray(memory.tags) ? memory.tags : []),
    memory.visibility ? `visibility:${memory.visibility}` : null,
    memory.sensitivity ? `sensitivity:${memory.sensitivity}` : null,
    memory.domain ? `domain:${memory.domain}` : null,
    memory.workspace_id ? `workspace:${memory.workspace_id}` : null,
    memory.access_policy ? `access_policy:${memory.access_policy}` : null,
    memory.status ? `status:${memory.status}` : null,
    memory.entity_type ? `entity_type:${memory.entity_type}` : null,
    memory.schema_status ? `schema_status:${memory.schema_status}` : null,
    memory.consumer ? `consumer:${memory.consumer}` : null,
    memory.source_kind ? `source_kind:${memory.source_kind}` : null
  ]);
}

function capturedSourceById(input) {
  return new Map(
    [...list(input, "captured_sources"), ...list(input, "sources")]
      .map((source) => [source.source_id, source])
      .filter(([sourceId]) => Boolean(sourceId))
  );
}

function promotionPayloadFromValidatedMemory(memory, context = {}) {
  const derivedFrom = Array.isArray(memory.derived_from) ? memory.derived_from : [];
  const capturedSource = context.capturedSources?.get(memory.source_id ?? memory.metadata?.source_id);
  const enrichedMemory = {
    ...memory,
    source_kind: memory.source_kind ?? memory.metadata?.source_kind ?? capturedSource?.source_kind,
    visibility: memory.visibility ?? memory.metadata?.visibility ?? capturedSource?.visibility,
    sensitivity: memory.sensitivity ?? memory.metadata?.sensitivity ?? capturedSource?.sensitivity,
    domain: memory.domain ?? memory.metadata?.domain ?? capturedSource?.domain,
    workspace_id: memory.workspace_id ?? memory.metadata?.workspace_id ?? capturedSource?.workspace_id,
    access_policy: memory.access_policy ?? memory.metadata?.access_policy ?? capturedSource?.access_policy,
    data_owner: memory.data_owner ?? memory.metadata?.data_owner ?? capturedSource?.data_owner,
    allowed_consumers: memory.allowed_consumers ?? memory.metadata?.allowed_consumers ?? capturedSource?.allowed_consumers
  };
  return {
    document_id: enrichedMemory.document_id,
    memory_id: enrichedMemory.memory_id,
    status: enrichedMemory.status,
    text: enrichedMemory.text ?? enrichedMemory.content,
    tags: validatedMemoryTags(enrichedMemory),
    metadata: {
      ...(enrichedMemory.metadata ?? {}),
      source_id: enrichedMemory.source_id ?? enrichedMemory.metadata?.source_id,
      snapshot_id: enrichedMemory.snapshot_id ?? enrichedMemory.metadata?.snapshot_id,
      previous_snapshot_id: enrichedMemory.previous_snapshot_id ?? enrichedMemory.metadata?.previous_snapshot_id,
      observation_id: enrichedMemory.observation_id ?? enrichedMemory.metadata?.observation_id,
      interpretation_id: enrichedMemory.interpretation_id ?? enrichedMemory.metadata?.interpretation_id,
      memory_id: enrichedMemory.memory_id,
      replaces_memory_id: enrichedMemory.supersedes_memory_id ?? enrichedMemory.replaces_memory_id ?? enrichedMemory.metadata?.replaces_memory_id,
      source_version: enrichedMemory.source_version ?? enrichedMemory.snapshot_id ?? enrichedMemory.metadata?.source_version,
      freshness: enrichedMemory.freshness ?? enrichedMemory.metadata?.freshness,
      derived_from: derivedFrom.length > 0 ? derivedFrom : enrichedMemory.metadata?.derived_from,
      workspace_id: enrichedMemory.workspace_id ?? enrichedMemory.metadata?.workspace_id ?? capturedSource?.workspace_id,
      access_policy: enrichedMemory.access_policy ?? enrichedMemory.metadata?.access_policy ?? capturedSource?.access_policy,
      data_owner: enrichedMemory.data_owner,
      allowed_consumers: enrichedMemory.allowed_consumers,
      review_status: enrichedMemory.review_status,
      visibility: enrichedMemory.visibility,
      sensitivity: enrichedMemory.sensitivity,
      domain: enrichedMemory.domain,
      entity_type: enrichedMemory.entity_type ?? enrichedMemory.metadata?.entity_type,
      schema_status: enrichedMemory.schema_status ?? enrichedMemory.metadata?.schema_status,
      source_kind: enrichedMemory.source_kind,
      source_path: enrichedMemory.source_path ?? enrichedMemory.metadata?.source_path ?? capturedSource?.source_path,
      connector_id: enrichedMemory.connector_id ?? enrichedMemory.metadata?.connector_id ?? capturedSource?.connector_id,
      connector_type: enrichedMemory.connector_type ?? enrichedMemory.metadata?.connector_type ?? capturedSource?.connector_type,
      connector_scope: enrichedMemory.connector_scope ?? enrichedMemory.metadata?.connector_scope ?? capturedSource?.connector_scope,
      capture_method: enrichedMemory.capture_method ?? enrichedMemory.metadata?.capture_method ?? capturedSource?.capture_method,
      captured_at: enrichedMemory.captured_at ?? enrichedMemory.metadata?.captured_at ?? capturedSource?.captured_at,
      revocation_reason: enrichedMemory.revocation_reason ?? enrichedMemory.metadata?.revocation_reason ?? capturedSource?.revocation_reason
    }
  };
}

function buildEffectiveInput(input) {
  if (promotionSource(input) !== "validated_memories") return input;

  const generationErrors = [];
  const memories = list(input, "validated_memories");
  const eligibleMemories = memories.filter((memory) => memory?.status === "active" && memory?.review_status === "approved");
  const unflagged = eligibleMemories.filter((memory) => memory.promote_to_hindsight !== true);
  if (unflagged.length > 0) {
    generationErrors.push("validated_memory_not_explicitly_promotable");
  }

  return {
    ...input,
    generated_from: "validated_memories",
    generation_errors: generationErrors,
    promotion_payloads: memories
      .filter((memory) => validatedMemoryIsPromotable(memory) || validatedMemoryIsRevocable(memory))
      .map((memory) => promotionPayloadFromValidatedMemory(memory, { capturedSources: capturedSourceById(input) }))
  };
}

function validate(input) {
  const errors = new Set();
  for (const error of list(input, "generation_errors")) {
    errors.add(error);
  }

  for (const payload of list(input, "promotion_payloads")) {
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    const metadata = payload.metadata ?? {};
    if (isDoNotUse(payload)) {
      if (!payload.document_id || !payload.memory_id || !promotionHasProvenance(payload)) {
        errors.add("adapter_delete_missing_provenance");
      }
      if (!deletionHasGovernance(payload)) {
        errors.add("adapter_delete_missing_governance");
      }
      if (isVaultSync(input)) {
        if (!hasVaultSyncMetadata(payload)) errors.add("vault_sync_metadata_missing");
        if (!snapshotIsRegistered(input, metadata)) errors.add("snapshot_registry_missing");
      }
      continue;
    }
    if (payload.status !== "active") continue;
    const entityType = metadata.entity_type ?? tagValue(tags, "entity_type:");
    const schemaStatus = metadata.schema_status ?? tagValue(tags, "schema_status:");
    if (schemaStatus === "candidate" || entityTypeRegistryStatus(input, entityType) === "candidate") {
      errors.add("candidate_type_not_promotable");
    }
    if (!payload.document_id || !payload.memory_id || !payload.text) {
      errors.add("adapter_promotion_missing_provenance");
      continue;
    }
    if (!promotionHasProvenance(payload)) {
      errors.add("adapter_promotion_missing_provenance");
    }
    if (!promotionHasGovernance(payload)) {
      errors.add("adapter_promotion_missing_governance");
    }
    if (isVaultSync(input)) {
      if (!hasVaultSyncMetadata(payload)) {
        errors.add("vault_sync_metadata_missing");
      }
      if (!snapshotIsRegistered(input, metadata)) {
        errors.add("snapshot_registry_missing");
      }
    }
  }

  for (const policy of list(input, "recall_policies")) {
    if (!hasRequiredRecallScope(policy)) {
      errors.add("unsafe_adapter_recall_policy");
    }
  }

  for (const document of list(input, "adapter_documents")) {
    if (document.status === "active" && document.source_kind === "raw_llm_conclusion") {
      errors.add("raw_llm_conclusion_retained");
    }
  }

  return [...errors];
}

function isReplacementPayload(payload) {
  return Boolean(payload.metadata?.replaces_memory_id || payload.metadata?.previous_snapshot_id);
}

function envStatus(env = process.env) {
  return {
    HINDSIGHT_API_KEY: env.HINDSIGHT_API_KEY ? "set" : "not_set",
    HINDSIGHT_BANK_ID: env.HINDSIGHT_BANK_ID ? "set" : "not_set",
    HINDSIGHT_BASE_URL: env.HINDSIGHT_BASE_URL ? "set" : "not_set"
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPlan(plan) {
  const jsonStablePlan = JSON.parse(JSON.stringify(plan));
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(jsonStablePlan)).digest("hex")}`;
}

function hasSecretLikeValue(value) {
  if (typeof value === "string") {
    return /sk-[A-Za-z0-9_-]+|password\s*[:=]|api[_-]?key\s*[:=]|secret_value/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasSecretLikeValue(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => hasSecretLikeValue(item));
  }
  return false;
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWritablePlanPath(outputPath) {
  if (!outputPath) throw new Error("missing_write_plan");
  const requestedPath = path.resolve(outputPath);
  const parent = path.dirname(requestedPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("write_plan_parent_missing");
  }
  if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isDirectory()) {
    throw new Error("write_plan_target_is_directory");
  }
  if (isPathInside(path.resolve("identity-vault"), requestedPath)) {
    throw new Error("write_plan_vault_write_forbidden");
  }
  return path.join(fs.realpathSync(parent), path.basename(requestedPath));
}

function writeReviewedPlan(plan, outputPath) {
  if (plan.validation.errors.length > 0) {
    throw new Error(`governance validation failed: ${plan.validation.errors.join(", ")}`);
  }
  if (hasSecretLikeValue(plan)) {
    throw new Error("write_plan_contains_secret_like_value");
  }
  const planPath = resolveWritablePlanPath(outputPath);
  const reviewedPlan = {
    generated_from: "hindsight_reviewed_promotion_plan",
    mode: "review-required",
    created_at: new Date().toISOString(),
    review_required: true,
    network_writes: false,
    live_writes_performed: false,
    plan,
    plan_hash: hashPlan(plan)
  };
  fs.writeFileSync(planPath, `${JSON.stringify(reviewedPlan, null, 2)}\n`);
  return {
    mode: "write-plan",
    generated_from: "hindsight_reviewed_promotion_plan",
    plan_path: planPath,
    plan_hash: reviewedPlan.plan_hash,
    review_required: true,
    network_writes: false,
    writes_performed: true,
    validation: plan.validation,
    summary: plan.summary
  };
}

function readReviewedPlan(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("apply_plan_unreadable");
  }
  const reviewedPlan = readJsonFile(resolved, "apply_plan_unreadable");
  if (
    reviewedPlan?.generated_from !== "hindsight_reviewed_promotion_plan" ||
    reviewedPlan?.mode !== "review-required" ||
    reviewedPlan.review_required !== true ||
    reviewedPlan.network_writes !== false ||
    !reviewedPlan.plan ||
    !reviewedPlan.plan_hash
  ) {
    throw new Error("apply_plan_invalid");
  }
  if (hashPlan(reviewedPlan.plan) !== reviewedPlan.plan_hash) {
    throw new Error("apply_plan_tampered");
  }
  if (hasSecretLikeValue(reviewedPlan)) {
    throw new Error("apply_plan_contains_secret_like_value");
  }
  if (reviewedPlan.plan.validation?.errors?.length > 0) {
    throw new Error(`governance validation failed: ${reviewedPlan.plan.validation.errors.join(", ")}`);
  }
  const executableErrors = validateExecutablePlan(reviewedPlan.plan);
  if (executableErrors.length > 0) {
    throw new Error(`apply_plan_governance_invalid: ${executableErrors.join(", ")}`);
  }
  return {
    source_plan: fs.realpathSync(resolved),
    reviewedPlan,
    plan: reviewedPlan.plan
  };
}

function validateExecutablePlan(plan) {
  const errors = new Set();
  for (const operation of list(plan, "operations")) {
    if (["retain", "upsert"].includes(operation.operation)) {
      const payload = {
        document_id: operation.document_id,
        memory_id: operation.memory_id,
        status: "active",
        text: operation.content,
        tags: operation.tags,
        metadata: operation.metadata
      };
      if (!payload.document_id || !payload.memory_id || !payload.text || !promotionHasProvenance(payload)) {
        errors.add("adapter_promotion_missing_provenance");
      }
      if (!promotionHasGovernance(payload)) {
        errors.add("adapter_promotion_missing_governance");
      }
    } else if (operation.operation === "delete") {
      const payload = {
        document_id: operation.document_id,
        memory_id: operation.memory_id,
        status: "do_not_use",
        tags: operation.tags,
        metadata: operation.metadata
      };
      if (!payload.document_id || !payload.memory_id || !promotionHasProvenance(payload)) {
        errors.add("adapter_delete_missing_provenance");
      }
      if (!deletionHasGovernance(payload)) errors.add("adapter_delete_missing_governance");
    }
  }
  for (const policy of list(plan, "recall_policies")) {
    if (!hasRequiredRecallScope(policy)) errors.add("unsafe_adapter_recall_policy");
  }
  return [...errors];
}

function approvedLiveEndpoint(baseUrl, env = process.env) {
  if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/.test(baseUrl)) return "local";
  if (baseUrl === "https://api.hindsight.vectorize.io") {
    if (env.SUPERMEMORY_ALLOW_HINDSIGHT_CLOUD !== "1") {
      throw new Error("Hindsight Cloud requires SUPERMEMORY_ALLOW_HINDSIGHT_CLOUD=1");
    }
    return "cloud";
  }
  throw new Error("live reviewed plan requires an approved local or explicit Hindsight Cloud endpoint");
}

function requireLiveEnv(env = process.env) {
  const missing = [];
  if (!env.HINDSIGHT_API_KEY) missing.push("HINDSIGHT_API_KEY");
  if (!env.HINDSIGHT_BANK_ID) missing.push("HINDSIGHT_BANK_ID");
  if (!env.HINDSIGHT_BASE_URL) missing.push("HINDSIGHT_BASE_URL");
  return missing;
}

function buildPlan(input, options, env = process.env) {
  const operations = [];
  const traces = [];
  const activeDocuments = new Map();
  const seenDocumentIds = new Set();
  const promotedDocumentIds = new Set();

  for (const payload of list(input, "promotion_payloads")) {
    if (!payload.document_id) continue;
    promotedDocumentIds.add(payload.document_id);

    if (payload.status === "active") {
      const operation = seenDocumentIds.has(payload.document_id) || isReplacementPayload(payload) ? "upsert" : "retain";
      seenDocumentIds.add(payload.document_id);
      activeDocuments.set(payload.document_id, {
        document_id: payload.document_id,
        memory_id: payload.memory_id,
        status: "active",
        tags: payload.tags ?? [],
        metadata: payload.metadata ?? {}
      });
      operations.push({
        operation,
        document_id: payload.document_id,
        memory_id: payload.memory_id,
        content: payload.text,
        tags: payload.tags ?? [],
        metadata: payload.metadata ?? {},
        trace_id: `trace-${operation}-${payload.document_id}`
      });
      continue;
    }

    if (isDoNotUse(payload)) {
      activeDocuments.delete(payload.document_id);
      operations.push({
        operation: "delete",
        document_id: payload.document_id,
        memory_id: payload.memory_id,
        reason: payload.metadata?.revocation_reason ?? "do_not_use",
        metadata: payload.metadata ?? {},
        tags: payload.tags ?? [],
        trace_id: `trace-delete-${payload.document_id}`
      });
    }
  }

  for (const item of list(input, "vault_items")) {
    if (!item.document_id || promotedDocumentIds.has(item.document_id)) continue;
    operations.push({
      operation: "skip",
      document_id: item.document_id,
      memory_id: item.memory_id,
      reason: "not_explicitly_promoted",
      trace_id: `trace-skip-${item.document_id}`
    });
  }

  for (const policy of list(input, "recall_policies")) {
    if (!hasRequiredRecallScope(policy)) continue;
    const requiredTags = policy.required_tags ?? [];
    const matchedDocumentIds = [...activeDocuments.values()]
      .filter((document) => requiredTags.every((tag) => (document.tags ?? []).includes(tag)))
      .map((document) => document.document_id);
    traces.push({
      trace_id: `trace-${policy.policy_id}`,
      operation: "recall",
      policy_id: policy.policy_id,
      matched_document_ids: matchedDocumentIds,
      diagnostic: matchedDocumentIds.length === 0 ? "no documents matched all required tags" : undefined
    });
  }

  const summary = {
    retained: operations.filter((operation) => operation.operation === "retain").length,
    upserted: operations.filter((operation) => operation.operation === "upsert").length,
    deleted: operations.filter((operation) => operation.operation === "delete").length,
    skipped: operations.filter((operation) => operation.operation === "skip").length
  };

  return {
    mode: options.live ? "live" : "dry-run",
    network_writes: false,
    credentials_required: Boolean(options.live),
    bank_id: options.bank ?? env.HINDSIGHT_BANK_ID ?? "supermemory-main",
    generated_from: input.generated_from,
    env: envStatus(env),
    validation: {
      contract_mode: input.contract_mode ?? "promotion_payloads_v1",
      errors: validate(input)
    },
    summary,
    operations,
    traces,
    recall_policies: list(input, "recall_policies").filter(hasRequiredRecallScope)
  };
}

function printOutput(plan, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  process.stdout.write(`mode=${plan.mode} network_writes=${plan.network_writes}\n`);
  for (const operation of plan.operations) {
    process.stdout.write(`${operation.operation} ${operation.document_id}\n`);
  }
}

async function applyReviewedPlan(options) {
  if (!options.ownerConfirmed) {
    throw new Error("owner_confirmation_required");
  }
  if (!options.live && !options.mockTransport) {
    throw new Error("apply-plan requires --mock-transport or --live");
  }
  const { source_plan, reviewedPlan, plan } = readReviewedPlan(options.applyPlan);
  if (options.mockTransport) {
    const mockApiKey = process.env.HINDSIGHT_API_KEY || "mock-transport-key";
    const requests = buildHindsightRequests(plan, {
      bankId: process.env.HINDSIGHT_BANK_ID || plan.bank_id || "mock-bank",
      baseUrl: process.env.HINDSIGHT_BASE_URL || "http://127.0.0.1:8888"
    });
    const transport = await executeHindsightRequests(requests, {
      apiKey: mockApiKey,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, mocked: true })
      })
    });
    return {
      ...plan,
      mode: "apply-plan",
      reviewed_plan: true,
      owner_confirmed: true,
      source_plan,
      plan_hash: reviewedPlan.plan_hash,
      network_writes: false,
      transport: {
        mode: "mock",
        requests: sanitizedTransportRequests(requests),
        result: transport
      }
    };
  }
  const missing = requireLiveEnv();
  if (missing.length > 0) {
    throw new Error(`missing required live env: ${missing.join(", ")}`);
  }
  if (process.env.SUPERMEMORY_ALLOW_LIVE_HINDSIGHT !== "1") {
    throw new Error("live transport requires SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1 or --mock-transport");
  }
  const baseUrl = process.env.HINDSIGHT_BASE_URL ?? "";
  const endpointMode = approvedLiveEndpoint(baseUrl);
  const requests = buildHindsightRequests(plan, {
    baseUrl,
    bankId: process.env.HINDSIGHT_BANK_ID
  });
  const transport = await executeHindsightRequests(requests, {
    apiKey: process.env.HINDSIGHT_API_KEY
  });
  return {
    ...plan,
    mode: "apply-plan",
    reviewed_plan: true,
    owner_confirmed: true,
    endpoint_mode: endpointMode,
    source_plan,
    plan_hash: reviewedPlan.plan_hash,
    network_writes: true,
    transport: {
      mode: "live",
      requests: sanitizedTransportRequests(requests),
      result: transport
    }
  };
}

function sanitizedTransportRequests(requests) {
  return requests.map(({ method, path, operation, document_id, policy_id, body }) => ({
    method,
    path,
    operation,
    document_id,
    policy_id,
    body
  }));
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.applyPlan) {
      printOutput(await applyReviewedPlan(options), options.json);
      return;
    }
    const input = buildEffectiveInput(normalizeInput(readInput(options.input)));
    const plan = buildPlan(input, options);

    if (options.writePlan) {
      printOutput(writeReviewedPlan(plan, options.writePlan), options.json);
      return;
    }

    if (plan.validation.errors.length > 0) {
      printOutput(plan, options.json);
      throw new Error(`governance validation failed: ${plan.validation.errors.join(", ")}`);
    }

    if (options.live) {
      const missing = requireLiveEnv();
      if (missing.length > 0) {
        throw new Error(`missing required live env: ${missing.join(", ")}`);
      }
      const requests = buildHindsightRequests(plan, {
        baseUrl: process.env.HINDSIGHT_BASE_URL,
        apiKey: process.env.HINDSIGHT_API_KEY
      });
      if (options.mockTransport) {
        const transport = await executeHindsightRequests(requests, {
          apiKey: process.env.HINDSIGHT_API_KEY,
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ success: true, mocked: true })
          })
        });
        printOutput(
          {
            ...plan,
            network_writes: false,
            transport: {
              mode: "mock",
              requests: sanitizedTransportRequests(requests),
              result: transport
            }
          },
          options.json
        );
        return;
      }
      if (process.env.SUPERMEMORY_ALLOW_LIVE_HINDSIGHT !== "1") {
        throw new Error("live transport requires SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1 or --mock-transport");
      }
      const transport = await executeHindsightRequests(requests, {
        apiKey: process.env.HINDSIGHT_API_KEY
      });
      printOutput(
        {
          ...plan,
          network_writes: true,
          transport: {
            mode: "live",
            requests: sanitizedTransportRequests(requests),
            result: transport
          }
        },
        options.json
      );
      return;
    }

    printOutput(plan, options.json);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

void main();
