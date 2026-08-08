import crypto from "node:crypto";
import { canonicalJson } from "./codex-redaction.mjs";

export const HINDSIGHT_TARGET_VERSION = "0.9.0";
export const HINDSIGHT_TARGET_DIGEST = "sha256:6364c3c5f1e551447976d6c3ab369040d0237c0980f10f911d76d981290913b6";

const WORKSPACE = /^ws_[A-Za-z0-9._:-]{8,}$/;
const TERMINAL = new Set(["completed", "failed", "cancelled", "not_found"]);

export class HindsightClientV2Error extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "HindsightClientV2Error";
    this.code = code;
    this.status = details.status ?? null;
    this.details = details;
  }
}

function fail(code, details) {
  throw new HindsightClientV2Error(code, details);
}

function safeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("hindsight_url_invalid");
  }
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    fail("hindsight_endpoint_insecure");
  }
  if (url.username || url.password || url.search || url.hash) fail("hindsight_url_invalid");
  return url.toString().replace(/\/+$/, "");
}

function serializeMetadata(metadata) {
  return Object.fromEntries(Object.entries(metadata ?? {}).flatMap(([key, value]) => {
    if (value === null || value === undefined) return [];
    return [[key, typeof value === "string" ? value : JSON.stringify(value)]];
  }));
}

function exactWorkspace(value) {
  if (!WORKSPACE.test(String(value ?? ""))) fail("hindsight_workspace_invalid");
  return value;
}

function uuidFrom(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cleanText(value, code, maximum = 100_000) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maximum) fail(code);
  return text;
}

function cleanTags(value) {
  if (!Array.isArray(value)) fail("hindsight_tags_invalid");
  const tags = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
  if (tags.length > 64 || tags.some((tag) => tag.length > 128)) fail("hindsight_tags_invalid");
  return tags;
}

function stableObservationScope(tags) {
  return tags.filter((tag) => (
    tag.startsWith("workspace:") || tag.startsWith("consumer:") ||
    tag.startsWith("sensitivity:") || tag.startsWith("access_policy:")
  ));
}

function jsonSchemaObject(value) {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) &&
    value.type === "object" && value.properties && typeof value.properties === "object"
  );
}

export function hindsightBankId(workspaceId) {
  exactWorkspace(workspaceId);
  return `smw_${crypto.createHash("sha256").update(workspaceId).digest("hex").slice(0, 40)}`;
}

export function deterministicHindsightOperationId({ workspaceId, documentId, payload }) {
  exactWorkspace(workspaceId);
  const document = cleanText(documentId, "hindsight_document_id_invalid", 512);
  return uuidFrom(canonicalJson({ workspace_id: workspaceId, document_id: document, payload }));
}

export function hindsightMemoryId(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  return metadata.memory_id ?? metadata.memoryId ?? item?.memory_id ?? item?.memoryId ?? null;
}

export function createHindsightClientV2({
  workspaceId,
  baseUrl = "http://127.0.0.1:8888",
  apiKey = "",
  timeoutMs = 15_000,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
} = {}) {
  const workspace = exactWorkspace(workspaceId);
  const endpoint = safeBaseUrl(baseUrl);
  const bankId = hindsightBankId(workspace);
  if (typeof fetchImpl !== "function") fail("hindsight_fetch_missing");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 180_000) {
    fail("hindsight_timeout_invalid");
  }

  const request = async (method, route, body = undefined, { timeout = timeoutMs } = {}) => {
    const response = await fetchImpl(new URL(route, `${endpoint}/`), {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    }).catch((cause) => fail("hindsight_unavailable", { cause }));
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        fail("hindsight_response_invalid", { status: response.status });
      }
    }
    if (!response.ok) {
      fail("hindsight_http_error", { status: response.status, route, response: data });
    }
    return data;
  };

  const bankRoute = (suffix = "") => `/v1/default/banks/${encodeURIComponent(bankId)}${suffix}`;

  const retain = async ({
    documentId,
    memoryId = documentId,
    content,
    timestamp = null,
    context = null,
    metadata = {},
    entities = null,
    tags = [],
    observationScopes = null,
    updateMode = "replace"
  } = {}) => {
    const normalizedTags = cleanTags(tags);
    const item = {
      content: cleanText(content, "hindsight_content_invalid"),
      document_id: cleanText(documentId, "hindsight_document_id_invalid", 512),
      metadata: serializeMetadata({ ...metadata, memory_id: memoryId, workspace_id: workspace }),
      tags: normalizedTags,
      update_mode: updateMode
    };
    if (timestamp !== null) item.timestamp = timestamp;
    if (context !== null) item.context = cleanText(context, "hindsight_context_invalid", 8_000);
    if (entities !== null) item.entities = entities;
    const scopes = observationScopes ?? [stableObservationScope(normalizedTags)];
    if (!Array.isArray(scopes) || scopes.some((scope) => !Array.isArray(scope))) {
      fail("hindsight_observation_scopes_invalid");
    }
    item.observation_scopes = scopes.map(cleanTags);
    const operationId = deterministicHindsightOperationId({ workspaceId: workspace, documentId: item.document_id, payload: item });
    const result = await request("POST", bankRoute("/memories"), {
      items: [item],
      async: true,
      operation_id: operationId
    });
    if (result?.operation_id !== operationId) fail("hindsight_operation_identity_mismatch");
    return { ...result, operation_id: operationId, document_id: item.document_id, payload_hash: crypto.createHash("sha256").update(canonicalJson(item)).digest("hex") };
  };

  const recall = async ({
    query,
    types = ["world", "experience", "observation"],
    budget = "mid",
    maxTokens = 4096,
    preferObservations = true,
    tagGroups = null,
    tags = null,
    tagsMatch = "all_strict",
    queryTimestamp = null,
    includeSourceFacts = true,
    trace = true
  } = {}) => {
    const body = {
      query: cleanText(query, "hindsight_query_invalid", 4_000),
      types,
      budget,
      max_tokens: maxTokens,
      prefer_observations: preferObservations,
      trace,
      include: {
        entities: {},
        ...(includeSourceFacts ? { source_facts: {} } : {})
      }
    };
    if (tagGroups !== null) body.tag_groups = tagGroups;
    else if (tags !== null) {
      body.tags = cleanTags(tags);
      body.tags_match = tagsMatch;
    }
    if (queryTimestamp !== null) body.query_timestamp = queryTimestamp;
    return request("POST", bankRoute("/memories/recall"), body);
  };

  const reflect = async ({ query, responseSchema, tags = null, tagGroups = null, maxTokens = 4096 } = {}) => {
    if (!jsonSchemaObject(responseSchema)) fail("hindsight_reflect_schema_invalid");
    const body = {
      query: cleanText(query, "hindsight_query_invalid", 4_000),
      max_tokens: maxTokens,
      include: { facts: {} },
      response_schema: responseSchema,
      exclude_mental_models: true
    };
    if (tagGroups !== null) body.tag_groups = tagGroups;
    else if (tags !== null) {
      body.tags = cleanTags(tags);
      body.tags_match = "all_strict";
    }
    return request("POST", bankRoute("/reflect"), body, { timeout: Math.max(timeoutMs, 30_000) });
  };

  const operation = (operationId) => request("GET", bankRoute(`/operations/${encodeURIComponent(operationId)}`));
  const retryOperation = (operationId) => request("POST", bankRoute(`/operations/${encodeURIComponent(operationId)}/retry`));
  const cancelOperation = (operationId) => request("DELETE", bankRoute(`/operations/${encodeURIComponent(operationId)}`));
  const listOperations = () => request("GET", bankRoute("/operations"));
  const consolidate = (observationScopes) => request("POST", bankRoute("/consolidate"), {
    observation_scopes: observationScopes
  });
  const deleteDocument = (documentId) => request("DELETE", bankRoute(`/documents/${encodeURIComponent(documentId)}`));
  const templateSchema = () => request("GET", "/v1/bank-template-schema");
  const importTemplate = (manifest, { dryRun = false } = {}) => request(
    "POST",
    `${bankRoute("/import")}?dry_run=${dryRun ? "true" : "false"}`,
    manifest
  );
  const updateConfig = (updates) => request("PATCH", bankRoute("/config"), { updates });
  const readBank = () => request("GET", bankRoute());
  const ensureBankTemplate = async (manifest) => {
    const dryRun = await importTemplate(manifest, { dryRun: true });
    if (dryRun?.valid === false || dryRun?.status === "invalid") fail("hindsight_bank_template_invalid");
    const imported = await importTemplate(manifest);
    const resolved = await readBank();
    const expected = canonicalJson(manifest?.bank_config ?? manifest?.config ?? manifest);
    const actualConfig = resolved?.bank_config ?? resolved?.config ?? resolved;
    const drift = actualConfig && canonicalJson(actualConfig) !== expected;
    return {
      schema: "supermemory.hindsight-bank-template-application.v1",
      status: drift ? "drift" : "applied",
      dry_run: dryRun,
      imported,
      drift
    };
  };

  const waitOperation = async (operationId, { pollIntervalMs = 500, operationTimeoutMs = 120_000 } = {}) => {
    const started = Date.now();
    while (Date.now() - started <= operationTimeoutMs) {
      const status = await operation(operationId);
      if (TERMINAL.has(status?.status)) return status;
      await sleep(pollIntervalMs);
    }
    fail("hindsight_operation_timeout", { operation_id: operationId });
  };

  const status = async () => {
    const version = await request("GET", "/version", undefined, { timeout: Math.min(timeoutMs, 3_000) });
    const banks = await request("GET", "/v1/default/banks", undefined, { timeout: Math.min(timeoutMs, 3_000) });
    const items = Array.isArray(banks) ? banks : banks?.items ?? banks?.banks ?? [];
    const bank = items.find((item) => item.bank_id === bankId) ?? null;
    return { available: true, version: version?.version ?? version?.api_version ?? null, bank_id: bankId, last_write_at: bank?.last_write_at ?? null };
  };

  const preflight = async ({ imageDigest, behavioralProbe = null, requireBehavioralProbe = false } = {}) => {
    const failures = [];
    if (imageDigest !== HINDSIGHT_TARGET_DIGEST) failures.push("digest_mismatch");
    const version = await request("GET", "/version");
    const actualVersion = version?.version ?? version?.api_version ?? null;
    if (actualVersion !== HINDSIGHT_TARGET_VERSION) failures.push("version_mismatch");
    const openapi = await request("GET", "/openapi.json");
    const contract = JSON.stringify(openapi);
    for (const capability of [
      "prefer_observations", "observation_scopes", "source_fact_ids", "source_facts",
      "tag_groups", "query_timestamp", "response_schema", "operation_id",
      "enable_temporal_retrieval", "enable_graph_retrieval", "enable_reranking", "last_write_at"
    ]) if (!contract.includes(capability)) failures.push(`capability_missing:${capability}`);
    const schema = await templateSchema();
    if (!schema || typeof schema !== "object") failures.push("bank_template_schema_missing");
    if (behavioralProbe) {
      const probe = await behavioralProbe({ client: publicApi, bankId });
      if (probe?.sensitive_data_redacted !== true) failures.push("memory_defense_probe_failed");
    } else if (requireBehavioralProbe) failures.push("memory_defense_probe_missing");
    return {
      schema: "supermemory.hindsight-capability-report.v1",
      status: failures.length === 0 ? "pass" : "fail",
      version: actualVersion,
      image_digest: imageDigest,
      bank_id: bankId,
      failures
    };
  };

  const publicApi = Object.freeze({
    workspaceId: workspace,
    bankId,
    baseUrl: endpoint,
    request,
    retain,
    recall,
    reflect,
    operation,
    retryOperation,
    cancelOperation,
    listOperations,
    consolidate,
    deleteDocument,
    templateSchema,
    importTemplate,
    readBank,
    ensureBankTemplate,
    updateConfig,
    waitOperation,
    status,
    preflight
  });
  return publicApi;
}
