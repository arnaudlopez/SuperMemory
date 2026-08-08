import { buildHindsightRequests, executeHindsightRequests } from "../hindsight-transport.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8888";
const DEFAULT_BANK_ID = "supermemory-local";
const DEFAULT_TIMEOUT_MS = 15_000;
const SENSITIVITY_SCOPES = ["standard", "restricted_review"];

export class ProductHindsightError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "ProductHindsightError";
    this.code = code;
    this.cause = cause;
  }
}

function parsedLoopbackUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ProductHindsightError("hindsight_url_invalid", "L’adresse Hindsight locale est invalide.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
  ) {
    throw new ProductHindsightError(
      "hindsight_remote_forbidden",
      "Le produit local refuse toute adresse Hindsight hors boucle locale."
    );
  }
  return url.toString().replace(/\/+$/, "");
}

function cleanBankId(value) {
  const bankId = String(value || DEFAULT_BANK_ID).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(bankId)) {
    throw new ProductHindsightError("hindsight_bank_invalid", "L’identifiant de banque Hindsight est invalide.");
  }
  return bankId;
}

function projectionTags(memory, sensitivity = memory.sensitivity || "standard") {
  return [
    "visibility:private",
    `sensitivity:${sensitivity}`,
    "domain:personal_knowledge",
    `source_kind:${memory.sourceKind || "document"}`,
    "entity_type:memory",
    "schema_status:stable",
    `workspace:${memory.workspaceId || "workspace:local"}`,
    "access_policy:owner_only",
    "consumer:supermemory",
    "status:active"
  ];
}

function projectionMetadata(memory) {
  return {
    source_id: memory.sourceId,
    snapshot_id: memory.snapshotId,
    observation_id: memory.candidateId,
    interpretation_id: memory.candidateId,
    memory_id: memory.memoryId,
    source_version: memory.snapshotId,
    freshness: "current",
    data_owner: "local_owner",
    derived_from: [memory.snapshotId],
    workspace_id: memory.workspaceId || "workspace:local",
    access_policy: "owner_only",
    allowed_consumers: ["supermemory"],
    review_status: memory.admissionDecision ? "admitted" : "approved",
    admission_id: memory.admissionId ?? null,
    admission_decision: memory.admissionDecision ?? "legacy_manual",
    admission_policy_version: memory.admissionPolicyVersion ?? null,
    valid_until: memory.validUntil ?? null,
    source_path: memory.relativePath,
    locator: memory.locator || null
  };
}

function recallTags(workspaceId, sensitivity) {
  return [
    "visibility:private",
    `sensitivity:${sensitivity}`,
    "domain:personal_knowledge",
    "entity_type:memory",
    "schema_status:stable",
    `workspace:${workspaceId}`,
    "access_policy:owner_only",
    "consumer:supermemory",
    "status:active"
  ];
}

function numberScore(item) {
  for (const value of [item?.relevance, item?.score, item?.similarity]) {
    const score = Number(value);
    if (Number.isFinite(score)) return score;
  }
  return 0;
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
  return metadata.memory_id || metadata.memoryId || item?.memory_id || item?.memoryId || null;
}

function authorizationHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function createProductHindsight(options = {}) {
  const enabled = options.enabled ?? process.env.SUPERMEMORY_HINDSIGHT_DISABLED !== "1";
  const baseUrl = parsedLoopbackUrl(
    options.baseUrl ?? process.env.HINDSIGHT_BASE_URL ?? DEFAULT_BASE_URL
  );
  const bankId = cleanBankId(options.bankId ?? process.env.HINDSIGHT_BANK_ID ?? DEFAULT_BANK_ID);
  const apiKey = options.apiKey ?? process.env.HINDSIGHT_API_KEY ?? "";
  const timeoutMs = Number(
    options.timeoutMs ?? process.env.HINDSIGHT_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS
  );
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new ProductHindsightError("hindsight_timeout_invalid", "Le délai Hindsight est invalide.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (enabled && typeof fetchImpl !== "function") {
    throw new ProductHindsightError("hindsight_fetch_missing", "Le transport HTTP local est indisponible.");
  }
  const customFetch = options.fetchImpl !== undefined;

  const execute = async (requests) => {
    try {
      return await executeHindsightRequests(requests, {
        apiKey,
        timeoutMs,
        ...(customFetch ? { fetchImpl } : {})
      });
    } catch (error) {
      throw new ProductHindsightError(
        error?.code || "hindsight_unavailable",
        "Hindsight local est indisponible ; la mémoire canonique reste intacte.",
        error
      );
    }
  };

  return {
    enabled,
    baseUrl,
    bankId,

    async status() {
      if (!enabled) {
        return { status: "disabled", available: false, baseUrl, bankId };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 3_000));
      try {
        const response = await fetchImpl(`${baseUrl}/health`, {
          method: "GET",
          headers: authorizationHeaders(apiKey),
          signal: controller.signal
        });
        return {
          status: response.ok ? "ready" : "unavailable",
          available: response.ok,
          baseUrl,
          bankId
        };
      } catch {
        return { status: "unavailable", available: false, baseUrl, bankId };
      } finally {
        clearTimeout(timeout);
      }
    },

    async project(memory) {
      if (!enabled) {
        throw new ProductHindsightError("hindsight_disabled", "La projection Hindsight est désactivée.");
      }
      const documentId = memory.projection?.documentId || memory.memoryId;
      const requests = buildHindsightRequests({
        bank_id: bankId,
        operations: [{
          operation: "upsert",
          document_id: documentId,
          memory_id: memory.memoryId,
          content: `${memory.title}\n\n${memory.text}`,
          tags: projectionTags(memory),
          metadata: projectionMetadata(memory)
        }]
      }, { baseUrl, bankId });
      const result = await execute(requests);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(
          `${baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents/${encodeURIComponent(documentId)}`,
          {
            method: "GET",
            headers: authorizationHeaders(apiKey),
            signal: controller.signal
          }
        );
        if (!response.ok) {
          throw new ProductHindsightError(
            "hindsight_projection_unverified",
            "Hindsight n’a pas permis de vérifier la projection."
          );
        }
        const document = await response.json();
        if (Number(document?.memory_unit_count) === 0) {
          throw new ProductHindsightError(
            "hindsight_projection_empty",
            "Hindsight a reçu le document mais son moteur n’a extrait aucune mémoire."
          );
        }
      } catch (error) {
        if (error instanceof ProductHindsightError) throw error;
        throw new ProductHindsightError(
          "hindsight_projection_unverified",
          "Hindsight n’a pas permis de vérifier la projection.",
          error
        );
      } finally {
        clearTimeout(timeout);
      }
      return { documentId, requestsSent: result.requests_sent };
    },

    async recall(query, { workspaceId = "workspace:local" } = {}) {
      if (!enabled) {
        throw new ProductHindsightError("hindsight_disabled", "La projection Hindsight est désactivée.");
      }
      const recall_policies = SENSITIVITY_SCOPES.map((sensitivity) => ({
        policy_id: `product-recall-${sensitivity}`,
        query,
        required_tags: recallTags(workspaceId, sensitivity),
        fail_closed: true
      }));
      const requests = buildHindsightRequests({
        bank_id: bankId,
        operations: [],
        recall_policies
      }, { baseUrl, bankId });
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
          const score = numberScore(item);
          if (!current || score > current.score) {
            byMemory.set(memoryId, { memoryId, score });
          }
        }
      }
      return {
        results: [...byMemory.values()].sort((left, right) => right.score - left.score),
        trace: {
          bankId,
          policyIds: recall_policies.map((policy) => policy.policy_id),
          tagsMatch: "all_strict",
          requestsSent: result.requests_sent,
          discardedUnreconciled: discarded
        }
      };
    },

    async deleteDocument(documentId) {
      if (!enabled) {
        throw new ProductHindsightError("hindsight_disabled", "La projection Hindsight est désactivée.");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(
          `${baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents/${encodeURIComponent(documentId)}`,
          {
            method: "DELETE",
            headers: authorizationHeaders(apiKey),
            signal: controller.signal
          }
        );
        if (!response.ok && ![404, 410].includes(response.status)) {
          throw new ProductHindsightError(
            "hindsight_delete_failed",
            "La suppression de la projection Hindsight a échoué."
          );
        }
        return { documentId, deleted: true, alreadyAbsent: [404, 410].includes(response.status) };
      } catch (error) {
        if (error instanceof ProductHindsightError) throw error;
        throw new ProductHindsightError(
          "hindsight_unavailable",
          "Hindsight local est indisponible ; la suppression dérivée reste en attente.",
          error
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
