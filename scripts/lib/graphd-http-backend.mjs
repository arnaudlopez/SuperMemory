import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WORKSPACE = /^ws_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function secureSecret(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("graphd_token_file_insecure");
  const value = fs.readFileSync(resolved, "utf8").trim();
  if (Buffer.byteLength(value) < 32) fail("graphd_token_invalid");
  return value;
}

function endpointUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("graphd_endpoint_invalid");
  }
  const loopback = url.protocol === "http:" && ["127.0.0.1", "::1", "[::1]", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) fail("graphd_endpoint_insecure");
  if (url.username || url.password || url.search || url.hash) fail("graphd_endpoint_invalid");
  return url;
}

export function workspaceGraphdBearer(secret, workspaceId) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32 || !WORKSPACE.test(workspaceId)) {
    fail("graphd_token_invalid");
  }
  const signature = crypto.createHmac("sha256", secret)
    .update(`supermemory.graphd.workspace.v1\0${workspaceId}`)
    .digest("base64url");
  return `smg1.${Buffer.from(workspaceId).toString("base64url")}.${signature}`;
}

export function createGraphdHttpBackend({
  endpoint,
  tokenFile,
  workspaceId,
  timeoutMs = 1_500,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!WORKSPACE.test(String(workspaceId ?? ""))) fail("graphd_workspace_invalid");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30_000) fail("graphd_timeout_invalid");
  if (typeof fetchImpl !== "function") fail("graphd_fetch_missing");
  const base = endpointUrl(endpoint);
  const token = workspaceGraphdBearer(secureSecret(tokenFile), workspaceId);

  const invoke = async (route, request) => {
    if (request?.workspace_id !== workspaceId || request?.parameters?.workspace_id !== workspaceId) {
      fail("not_found_or_not_authorized");
    }
    const { headers: _internalHeaders, ...wireRequest } = request;
    const response = await fetchImpl(new URL(route, base), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(wireRequest),
      signal: AbortSignal.timeout(timeoutMs)
    }).catch(() => fail("graph_backend_unavailable"));
    const body = await response.json().catch(() => fail("graph_backend_response_invalid"));
    if (!response.ok || body?.ok === false) fail(body?.error ?? "graph_backend_unavailable");
    return body;
  };

  return Object.freeze({
    workspaceId,
    endpoint: base.toString(),
    project: (request) => invoke("/v1/project", request),
    query: (request) => invoke("/v1/query", request),
    notifyImprove: (request) => invoke("/v1/improve/notify", request)
  });
}
