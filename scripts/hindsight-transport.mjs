const defaultBaseUrl = "https://api.hindsight.vectorize.io";

function trimSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function encodePath(value) {
  return encodeURIComponent(String(value));
}

function retainBody(operation) {
  return {
    items: [
      {
        content: operation.content,
        document_id: operation.document_id,
        tags: operation.tags ?? [],
        metadata: {
          ...(operation.metadata ?? {}),
          memory_id: operation.memory_id
        }
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
        tags: policy.required_tags ?? []
      }
    });
  }

  return requests;
}

export async function executeHindsightRequests(requests, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("missing fetch implementation");
  }
  const apiKey = options.apiKey ?? process.env.HINDSIGHT_API_KEY;
  if (!apiKey) {
    throw new Error("missing HINDSIGHT_API_KEY");
  }

  const responses = [];
  for (const request of requests) {
    const response = await fetchImpl(`${request.baseUrl}${request.path}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: request.body ? JSON.stringify(request.body) : undefined
    });
    const data = typeof response.json === "function" ? await response.json() : null;
    if (!response.ok) {
      throw new Error(`Hindsight request failed: ${request.method} ${request.path} ${response.status}`);
    }
    responses.push({
      operation: request.operation,
      document_id: request.document_id,
      policy_id: request.policy_id,
      status: response.status,
      data
    });
  }

  return {
    status: options.fetchImpl ? "mocked" : "sent",
    requests_sent: responses.length,
    responses
  };
}
