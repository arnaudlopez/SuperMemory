import { deterministicHindsightOperationId, hindsightMemoryId } from "./hindsight-client-v2.mjs";
import { canonicalJson } from "./codex-redaction.mjs";
import crypto from "node:crypto";
import { validateHindsightReflectOutput } from "./hindsight-reflect-schemas.mjs";

const WORKSPACE = /^ws_[A-Za-z0-9._:-]{8,}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function score(item) {
  for (const value of [item?.scores?.final, item?.relevance, item?.score, item?.similarity]) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function recallItems(response) {
  if (Array.isArray(response)) return response;
  for (const key of ["results", "memories", "items"]) if (Array.isArray(response?.[key])) return response[key];
  return [];
}

function currentRecord(record, workspaceId, consumer, asOf, requireCurrent = false) {
  if (!record || record.workspace_id !== workspaceId || record.authorized !== true) return false;
  if (record.status && record.status !== "active") return false;
  if (Array.isArray(record.allowed_consumers) && !record.allowed_consumers.includes(consumer)) return false;
  if (record.valid_until && Date.parse(asOf) >= Date.parse(record.valid_until)) return false;
  if (record.revoked_at && Date.parse(asOf) >= Date.parse(record.revoked_at)) return false;
  const authorityState = record.authority?.state ?? record.authority_state ?? "current";
  if (["superseded", "revoked", "expired"].includes(authorityState)) return false;
  if (requireCurrent && authorityState !== "current") return false;
  return true;
}

export function createHindsightAuthorityGateway({
  workspaceId,
  client,
  authorityResolver,
  factSourceResolver = null,
  receiptStore = null,
  consumer = "codex",
  clock = () => new Date().toISOString()
} = {}) {
  if (!WORKSPACE.test(String(workspaceId ?? ""))) fail("hindsight_gateway_workspace_invalid");
  if (!client || client.workspaceId !== workspaceId) fail("hindsight_gateway_client_scope_invalid");
  if (typeof authorityResolver !== "function") fail("hindsight_authority_resolver_required");
  if (factSourceResolver !== null && typeof factSourceResolver !== "function") fail("hindsight_fact_resolver_invalid");

  const resolve = async ({ memoryId = null, hindsightFactId = null, asOf = clock(), requireCurrent = false }) => {
    const record = await authorityResolver({ workspaceId, memoryId, hindsightFactId, asOf, consumer });
    return currentRecord(record, workspaceId, consumer, asOf, requireCurrent) ? record : null;
  };

  const projectionTags = (memory) => [
    `workspace:${workspaceId}`,
    `consumer:${consumer}`,
    `sensitivity:${memory.sensitivity ?? "standard"}`,
    `domain:${memory.domain ?? "project"}`,
    `schema:${memory.schema_version ?? "memory-v3"}`,
    "status:active"
  ];

  const observationScopes = (memory) => (memory.allowed_consumers ?? [consumer])
    .filter((item) => item === consumer)
    .map((item) => [
      `consumer:${item}`,
      `sensitivity:${memory.sensitivity ?? "standard"}`,
      `domain:${memory.domain ?? "project"}`
    ]);

  const project = async (memory) => {
    if (
      memory?.workspace_id !== workspaceId || memory.status !== "active" ||
      !memory.memory_id || !memory.allowed_consumers?.includes(consumer)
    ) fail("hindsight_projection_forbidden");
    const record = await resolve({ memoryId: memory.memory_id, requireCurrent: true });
    if (!record) fail("hindsight_projection_unauthorized");
    const result = await client.retain({
      documentId: memory.projection?.document_id ?? memory.memory_id,
      memoryId: memory.memory_id,
      content: `${memory.title ?? "Memory"}\n\n${memory.text ?? memory.content}`,
      timestamp: memory.observed_at ?? memory.valid_from ?? null,
      context: memory.context ?? null,
      entities: memory.entities ?? null,
      tags: projectionTags(memory),
      observationScopes: observationScopes(memory),
      metadata: {
        candidate_id: memory.candidate_id,
        admission_id: memory.admission_id,
        project_id: memory.project_id,
        evidence_ids: memory.evidence_ids ?? memory.evidence ?? [],
        allowed_consumers: memory.allowed_consumers,
        sensitivity: memory.sensitivity,
        projection_hash: memory.projection_hash ?? memory.integrity_hash ?? null,
        authority_revision: memory.authority_revision ?? null,
        valid_until: memory.valid_until ?? null
      }
    });
    receiptStore?.put({
      operationId: result.operation_id,
      documentId: result.document_id,
      payloadHash: result.payload_hash,
      status: "pending"
    });
    return result;
  };

  const validateRaw = async (item, asOf) => {
    const memoryId = hindsightMemoryId(item);
    if (!memoryId) return null;
    const record = await resolve({ memoryId, hindsightFactId: item.id ?? null, asOf });
    if (!record) return null;
    return {
      id: item.id ?? null,
      memory_id: memoryId,
      fact_type: item.type ?? item.fact_type ?? "world",
      text: item.text ?? null,
      score: score(item),
      occurred_start: item.occurred_start ?? null,
      occurred_end: item.occurred_end ?? null,
      citation: record.citation,
      authority: record.authority ?? null,
      source_fact_ids: []
    };
  };

  const validateObservation = async (item, response, asOf) => {
    if (!Array.isArray(item.source_fact_ids) || item.source_fact_ids.length === 0) return null;
    const sourceValues = Array.isArray(response?.source_facts)
      ? response.source_facts
      : Object.values(response?.source_facts && typeof response.source_facts === "object" ? response.source_facts : {});
    const sourceMap = Object.fromEntries(sourceValues.map((source) => [source.id ?? source.fact_id, source]));
    const sources = [];
    for (const factId of item.source_fact_ids) {
      const source = sourceMap[factId];
      if (!source) return null;
      let memoryId = hindsightMemoryId(source);
      if (!memoryId && factSourceResolver) {
        const mapping = await factSourceResolver({ workspaceId, hindsightFactId: factId, fact: source });
        memoryId = mapping?.memory_id ?? null;
      }
      const record = await resolve({ memoryId, hindsightFactId: factId, asOf, requireCurrent: true });
      if (!record) return null;
      sources.push({ fact_id: factId, memory_id: memoryId, citation: record.citation });
    }
    return {
      id: item.id ?? null,
      memory_id: null,
      fact_type: "observation",
      text: item.text ?? null,
      score: score(item),
      occurred_start: item.occurred_start ?? null,
      occurred_end: item.occurred_end ?? null,
      citation: sources.map((source) => source.citation).filter(Boolean),
      authority: "derived_non_authoritative",
      source_fact_ids: item.source_fact_ids,
      sources
    };
  };

  const recall = async ({ query, asOf = null, historical = false, tags = null, tagGroups = null, maxTokens = 4096 } = {}) => {
    const point = asOf ?? clock();
    const response = await client.recall({
      query,
      types: historical ? ["world", "experience"] : ["world", "experience", "observation"],
      preferObservations: !historical,
      includeSourceFacts: !historical,
      queryTimestamp: asOf,
      tags,
      tagGroups,
      maxTokens
    });
    const accepted = [];
    let rejected = 0;
    for (const item of recallItems(response)) {
      const type = item.type ?? item.fact_type;
      const normalized = type === "observation"
        ? await validateObservation(item, response, point)
        : await validateRaw(item, point);
      if (normalized) accepted.push(normalized);
      else rejected += 1;
    }
    accepted.sort((left, right) => right.score - left.score);
    return {
      schema: "supermemory.hindsight-authorized-recall.v1",
      workspace_id: workspaceId,
      as_of: asOf,
      historical,
      authoritative: false,
      results: accepted,
      coverage: { accepted: accepted.length, rejected, source_fact_coverage: accepted.every((item) => item.fact_type !== "observation" || item.sources.length === item.source_fact_ids.length) ? 1 : 0 },
      trace: response?.trace ?? null
    };
  };

  const reflect = async ({ query, format, responseSchema, tags = null, tagGroups = null, maxTokens = 4096, asOf = null } = {}) => {
    if (asOf !== null) fail("hindsight_reflect_historical_forbidden");
    const response = await client.reflect({ query, responseSchema, tags, tagGroups, maxTokens });
    const facts = response?.based_on?.memories ?? response?.based_on?.facts ?? response?.facts;
    if (!Array.isArray(facts) || facts.length === 0) fail("reflect_grounding_failed_retryable");
    const validated = [];
    for (const fact of facts) {
      const record = await resolve({ memoryId: hindsightMemoryId(fact), hindsightFactId: fact.id ?? null, requireCurrent: true });
      if (!record) fail("reflect_grounding_failed_retryable");
      validated.push({ fact_id: fact.id, memory_id: record.memory_id ?? null, citation: record.citation });
    }
    if (!response.structured_output || typeof response.structured_output !== "object") fail("reflect_structured_output_missing");
    if (format) validateHindsightReflectOutput(format, response.structured_output);
    return {
      schema: "supermemory.reflect-result.v1",
      status: "grounded",
      workspace_id: workspaceId,
      authoritative: false,
      structured_output: response.structured_output,
      answer: response.structured_output.answer ?? response.text ?? null,
      based_on: validated,
      coverage: { facts_used: facts.length, facts_validated: validated.length, facts_rejected: 0 },
      usage: response.usage ?? null
    };
  };

  const reconcileOperation = async (operationId) => {
    const remote = await client.operation(operationId);
    const receipt = receiptStore?.read(operationId);
    if (receipt) receiptStore.put({
      operationId,
      documentId: receipt.document_id,
      operationType: receipt.operation_type,
      payloadHash: receipt.payload_hash,
      status: remote.status === "not_found" ? "failed" : remote.status,
      error: remote.error_message ?? null
    });
    return remote;
  };

  const consolidate = async (scopes) => {
    const result = await client.consolidate(scopes);
    if (result?.operation_id && receiptStore) {
      receiptStore.put({
        operationId: result.operation_id,
        documentId: `consolidation:${crypto.createHash("sha256").update(canonicalJson(scopes)).digest("hex")}`,
        operationType: "consolidation",
        payloadHash: crypto.createHash("sha256").update(canonicalJson(scopes)).digest("hex"),
        status: "pending"
      });
    }
    return result;
  };

  const deleteProjection = async (documentId) => {
    const payload = { operation: "delete", document_id: documentId };
    const operationId = deterministicHindsightOperationId({ workspaceId, documentId, payload });
    const result = await client.deleteDocument(documentId);
    receiptStore?.put({
      operationId,
      documentId,
      operationType: "delete",
      payloadHash: crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex"),
      status: "completed"
    });
    return { ...result, operation_id: operationId };
  };

  return Object.freeze({
    workspaceId,
    bankId: client.bankId,
    project,
    recall,
    reflect,
    consolidate,
    delete: deleteProjection,
    reconcileOperation,
    status: () => client.status(),
    preflight: (options) => client.preflight(options),
    ensureBankTemplate: (manifest) => client.ensureBankTemplate(manifest)
  });
}
