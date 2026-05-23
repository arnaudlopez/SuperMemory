#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildHindsightRequests, executeHindsightRequests } from "./hindsight-transport.mjs";

const requiredPromotionMetadata = [
  "source_id",
  "snapshot_id",
  "observation_id",
  "interpretation_id",
  "memory_id"
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
    hasTagWithPrefix(requiredTags, "workspace:") &&
    hasTagWithPrefix(requiredTags, "access_policy:") &&
    requiredTags.includes("status:active")
  );
}

function promotionHasProvenance(payload) {
  const metadata = payload.metadata ?? {};
  return requiredPromotionMetadata.every((key) => Boolean(metadata[key]));
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
    mockTransport: false
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
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!options.input) {
    throw new Error("missing required --input <path>");
  }
  if (options.live && options.dryRun) {
    throw new Error("--live and --dry-run are mutually exclusive");
  }
  if (!options.live) {
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
  return new Map(list(input, "captured_sources").map((source) => [source.source_id, source]).filter(([sourceId]) => Boolean(sourceId)));
}

function promotionPayloadFromValidatedMemory(memory, context = {}) {
  const derivedFrom = Array.isArray(memory.derived_from) ? memory.derived_from : [];
  const capturedSource = context.capturedSources?.get(memory.source_id ?? memory.metadata?.source_id);
  const enrichedMemory = {
    ...memory,
    source_kind: memory.source_kind ?? memory.metadata?.source_kind ?? capturedSource?.source_kind
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
    if (payload.status !== "active") continue;
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    const metadata = payload.metadata ?? {};
    const entityType = metadata.entity_type ?? tagValue(tags, "entity_type:");
    const schemaStatus = metadata.schema_status ?? tagValue(tags, "schema_status:");
    if (schemaStatus === "candidate" || entityTypeRegistryStatus(input, entityType) === "candidate") {
      errors.add("candidate_type_not_promotable");
    }
    const hasActiveTag = tags.includes("status:active");
    const hasScopedTags = hasTagWithPrefix(tags, "workspace:") && hasTagWithPrefix(tags, "access_policy:");
    if (!payload.document_id || !payload.memory_id || !payload.text || !hasActiveTag || !hasScopedTags) {
      errors.add("adapter_promotion_missing_provenance");
      continue;
    }
    if (!promotionHasProvenance(payload)) {
      errors.add("adapter_promotion_missing_provenance");
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

function requireLiveEnv(env = process.env) {
  const missing = [];
  if (!env.HINDSIGHT_API_KEY) missing.push("HINDSIGHT_API_KEY");
  if (!env.HINDSIGHT_BANK_ID) missing.push("HINDSIGHT_BANK_ID");
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
    const input = buildEffectiveInput(normalizeInput(readInput(options.input)));
    const plan = buildPlan(input, options);

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
