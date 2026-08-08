import crypto from "node:crypto";
import {
  buildHindsightRequests,
  executeHindsightRequests
} from "../hindsight-transport.mjs";

const WORKSPACE_ID = /^ws_[0-9a-f-]{36}$/i;
const DEFAULT_BASE_URL = "http://127.0.0.1:8888";

export class CodexHindsightError extends Error {
  constructor(code, cause = null) {
    super(code);
    this.name = "CodexHindsightError";
    this.code = code;
    this.cause = cause;
  }
}

function fail(code) {
  throw new CodexHindsightError(code);
}

function loopbackBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("hindsight_url_invalid");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)
  ) fail("hindsight_remote_forbidden");
  return parsed.toString().replace(/\/+$/, "");
}

function bankFor(workspaceId) {
  return `smw_${crypto.createHash("sha256").update(workspaceId).digest("hex").slice(0, 40)}`;
}

function tags(workspaceId) {
  return [
    `workspace:${workspaceId}`,
    "consumer:codex",
    "status:active",
    "access_policy:owner_only",
    "schema_status:stable",
    "sensitivity:standard"
  ];
}

function recalledItems(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["results", "memories", "items"]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function recalledMemoryId(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  return metadata.memory_id ?? metadata.memoryId ?? item?.memory_id ?? item?.memoryId ?? null;
}

function score(item) {
  for (const value of [item?.relevance, item?.score, item?.similarity]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

export function createCodexHindsight({
  workspaceId,
  enabled = true,
  baseUrl = DEFAULT_BASE_URL,
  apiKey = "",
  timeoutMs = 15_000,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!WORKSPACE_ID.test(String(workspaceId))) fail("scope_unresolved");
  const localBaseUrl = loopbackBaseUrl(baseUrl);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) {
    fail("hindsight_timeout_invalid");
  }
  if (enabled && typeof fetchImpl !== "function") fail("hindsight_fetch_missing");
  const bankId = bankFor(workspaceId);

  const execute = async (requests) => {
    if (!enabled) fail("hindsight_disabled");
    try {
      return await executeHindsightRequests(requests, {
        apiKey,
        timeoutMs,
        fetchImpl
      });
    } catch (error) {
      throw new CodexHindsightError(error?.code ?? "hindsight_unavailable", error);
    }
  };

  const project = async (memory) => {
    if (
      memory?.workspace_id !== workspaceId ||
      memory.status !== "active" ||
      memory.sensitivity !== "standard" ||
      !memory.allowed_consumers?.includes("codex")
    ) fail("hindsight_projection_forbidden");
    const requests = buildHindsightRequests({
      bank_id: bankId,
      operations: [{
        operation: "upsert",
        document_id: memory.memory_id,
        memory_id: memory.memory_id,
        content: `${memory.title}\n\n${memory.text}`,
        tags: tags(workspaceId),
        metadata: {
          memory_id: memory.memory_id,
          candidate_id: memory.candidate_id,
          workspace_id: workspaceId,
          project_id: memory.project_id,
          evidence: memory.evidence,
          allowed_consumers: memory.allowed_consumers,
          sensitivity: memory.sensitivity
        }
      }]
    }, { baseUrl: localBaseUrl, bankId });
    await execute(requests);
    return { status: "synced", documentId: memory.memory_id, bankId };
  };

  const recall = async (query) => {
    const normalized = String(query ?? "").trim();
    if (!normalized || normalized.length > 4_000) fail("hindsight_query_invalid");
    const policyId = `codex-${bankId}`;
    const requests = buildHindsightRequests({
      bank_id: bankId,
      operations: [],
      recall_policies: [{
        policy_id: policyId,
        query: normalized,
        required_tags: tags(workspaceId),
        fail_closed: true
      }]
    }, { baseUrl: localBaseUrl, bankId });
    const result = await execute(requests);
    const byMemory = new Map();
    let discarded = 0;
    for (const response of result.responses) {
      for (const item of recalledItems(response.data)) {
        const memoryId = recalledMemoryId(item);
        if (!memoryId) {
          discarded += 1;
          continue;
        }
        const current = byMemory.get(memoryId);
        const candidate = { memoryId, score: score(item) };
        if (!current || candidate.score > current.score) byMemory.set(memoryId, candidate);
      }
    }
    return {
      results: [...byMemory.values()].sort((left, right) => right.score - left.score),
      trace: {
        bankId,
        policyId,
        requiredTags: tags(workspaceId),
        tagsMatch: "all_strict",
        discardedUnidentified: discarded
      }
    };
  };

  const deleteMemory = async (memory) => {
    if (memory?.workspace_id !== workspaceId || !memory.memory_id) fail("scope_mismatch");
    const requests = buildHindsightRequests({
      bank_id: bankId,
      operations: [{
        operation: "delete",
        document_id: memory.memory_id,
        memory_id: memory.memory_id
      }]
    }, { baseUrl: localBaseUrl, bankId });
    await execute(requests);
    return { status: "deleted", documentId: memory.memory_id, bankId };
  };

  const status = async () => {
    if (!enabled) return { status: "disabled", available: false, bankId };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 3_000));
    try {
      const response = await fetchImpl(`${localBaseUrl}/health`, {
        method: "GET",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: controller.signal
      });
      return { status: response.ok ? "ready" : "unavailable", available: response.ok, bankId };
    } catch {
      return { status: "unavailable", available: false, bankId };
    } finally {
      clearTimeout(timer);
    }
  };

  const rebuild = async (memories) => {
    let synced = 0;
    for (const memory of [...memories].sort((left, right) => (
      left.memory_id.localeCompare(right.memory_id)
    ))) {
      await project(memory);
      synced += 1;
    }
    return { status: "synced", bankId, synced };
  };

  return {
    enabled,
    workspaceId,
    baseUrl: localBaseUrl,
    bankId,
    requiredTags: tags(workspaceId),
    project,
    recall,
    delete: deleteMemory,
    status,
    rebuild
  };
}
