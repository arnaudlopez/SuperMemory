const defaultBaseUrl = "https://api.hindsight.vectorize.io";

function trimSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function encodePath(value) {
  return encodeURIComponent(String(value));
}

export function serializeHindsightMetadataValue(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function serializeHindsightMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata ?? {})
      .map(([key, value]) => [key, serializeHindsightMetadataValue(value)])
      .filter(([, value]) => value !== undefined)
  );
}

function retainBody(operation) {
  return {
    items: [
      {
        content: operation.content,
        document_id: operation.document_id,
        tags: operation.tags ?? [],
        metadata: serializeHindsightMetadata({
          ...(operation.metadata ?? {}),
          memory_id: operation.memory_id
        })
      }
    ]
  };
}

export function buildHindsightRequests(plan, options = {}) {
  const bankId = options.bankId ?? plan.bank_id;
  const baseUrl = trimSlash(options.baseUrl ?? defaultBaseUrl);
  const requests = [];

  for (const operation of plan.operations ?? []) {
    if (operation.operation === "retain" || operation.operation === "upsert") {
      requests.push({
        operation: operation.operation,
        document_id: operation.document_id,
        method: "POST",
        baseUrl,
        path: `/v1/default/banks/${encodePath(bankId)}/memories`,
        body: retainBody(operation)
      });
    } else if (operation.operation === "delete") {
      requests.push({
        operation: "delete",
        document_id: operation.document_id,
        method: "DELETE",
        baseUrl,
        path: `/v1/default/banks/${encodePath(bankId)}/documents/${encodePath(operation.document_id)}`
      });
    }
  }

  for (const policy of plan.recall_policies ?? []) {
    requests.push({
      operation: "recall",
      policy_id: policy.policy_id,
      method: "POST",
      baseUrl,
      path: `/v1/default/banks/${encodePath(bankId)}/memories/recall`,
      body: {
        query: policy.query,
        trace: true,
        tags: policy.required_tags ?? [],
        tags_match: "all_strict"
      }
    });
  }

  return requests;
}

async function responseData(response) {
  if (response.status === 204 || response.status === 205) return null;
  if (typeof response.text === "function") {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { non_json_body: true };
    }
  }
  if (typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return null;
}

export class HindsightTransportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "HindsightTransportError";
    this.code = details.code ?? "hindsight_transport_error";
    this.completed_requests = details.completed_requests ?? 0;
    this.pending_requests = details.pending_requests ?? 0;
    this.operation = details.operation;
    this.status = details.status;
  }
}

export async function executeHindsightRequests(requests, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("missing fetch implementation");
  }
  const apiKey = options.apiKey ?? process.env.HINDSIGHT_API_KEY;
  const loopbackOnly = requests.every((request) => {
    try {
      return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(request.baseUrl).hostname);
    } catch {
      return false;
    }
  });
  if (!apiKey && !loopbackOnly) {
    throw new Error("missing HINDSIGHT_API_KEY");
  }
  const timeoutMs = options.timeoutMs ?? Number(process.env.HINDSIGHT_REQUEST_TIMEOUT_MS || 15000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("invalid Hindsight request timeout");

  const responses = [];
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${request.baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal
      });
      const data = await responseData(response);
      if (!response.ok) {
        throw new HindsightTransportError(
          `Hindsight request failed: ${request.method} ${request.path} ${response.status}; completed=${responses.length}; pending=${requests.length - index}`,
          {
            code: "hindsight_http_error",
            completed_requests: responses.length,
            pending_requests: requests.length - index,
            operation: request.operation,
            status: response.status
          }
        );
      }
      responses.push({
        operation: request.operation,
        document_id: request.document_id,
        policy_id: request.policy_id,
        status: response.status,
        data
      });
    } catch (error) {
      if (error instanceof HindsightTransportError) throw error;
      const timedOut = controller.signal.aborted;
      throw new HindsightTransportError(
        `Hindsight request ${timedOut ? "timed out" : "failed"}: ${request.method} ${request.path}; completed=${responses.length}; pending=${requests.length - index}`,
        {
          code: timedOut ? "hindsight_timeout" : "hindsight_network_error",
          completed_requests: responses.length,
          pending_requests: requests.length - index,
          operation: request.operation
        }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    status: options.fetchImpl ? "mocked" : "sent",
    requests_sent: responses.length,
    responses
  };
}
