import crypto from "node:crypto";

function response(status, body) {
  return { status, body };
}

function errorStatus(error) {
  if (["agent_token_invalid", "agent_credential_invalid", "agent_credential_revoked"].includes(error?.code ?? error?.message)) return 401;
  if (["not_authorized", "personal_memory_scope_forbidden"].includes(error?.code ?? error?.message)) return 403;
  if (["personal_memory_not_found", "forget_plan_not_found"].includes(error?.code ?? error?.message)) return 404;
  if (["revision_conflict", "idempotency_conflict", "intent_replayed"].includes(error?.code ?? error?.message)) return 409;
  return 400;
}

function tokenFrom(headers = {}) {
  return headers["x-supermemory-agent-token"] ?? headers["X-Supermemory-Agent-Token"] ?? "";
}

export function createPersonalManagerApi({
  resolveScope,
  contextCard,
  recallOrchestrator,
  commandBus,
  capture,
  getMemory = async () => null,
  lineage = async () => null,
  pinMemory = async () => null,
  recordRecallFeedback = async () => ({ status: "stored" }),
  consolidationStatus = () => ({ status: "disabled" }),
  operationStatus = () => null,
  status = () => ({ enabled: true }),
  maxBodyBytes = 1024 * 1024,
  clock = () => Date.now(),
  rateLimits = { mutation: 20, capture: 120, recall: 120, read: 240 }
} = {}) {
  if (typeof resolveScope !== "function" || typeof contextCard !== "function" || typeof recallOrchestrator?.recall !== "function" || typeof capture !== "function") {
    throw new Error("personal_manager_api_configuration_invalid");
  }

  const windows = new Map();
  const routeClass = (route) => {
    if (route === "/commands" || route.startsWith("/forget/") || /\/memories\/[^/]+\/(?:pin|unpin)$/.test(route)) return "mutation";
    if (route === "/capture") return "capture";
    if (route === "/context" || route === "/recall" || route === "/recall-feedback") return "recall";
    return "read";
  };
  const routeBodyLimit = (route) => {
    if (route === "/commands" || route.startsWith("/forget/")) return 64 * 1024;
    if (route === "/capture") return 256 * 1024;
    return maxBodyBytes;
  };
  const consume = ({ route, headers }) => {
    const kind = routeClass(route);
    const limit = Number(rateLimits[kind]);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("personal_manager_rate_limit_invalid");
    const bucket = Math.floor(Number(clock()) / 60_000);
    const subject = crypto.createHash("sha256").update(String(tokenFrom(headers))).digest("hex");
    const key = `${subject}:${kind}:${bucket}`;
    const count = (windows.get(key) ?? 0) + 1;
    windows.set(key, count);
    if (windows.size > 2_000) {
      for (const existing of windows.keys()) if (!existing.endsWith(`:${bucket}`)) windows.delete(existing);
    }
    return count <= limit;
  };

  const handle = async ({ method = "GET", path = "/", headers = {}, body = {} } = {}) => {
    const parsedUrl = new URL(String(path), "http://127.0.0.1");
    const pathname = parsedUrl.pathname;
    const prefix = "/v1/personal-manager";
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
    const route = pathname.slice(prefix.length) || "/";
    if (Buffer.byteLength(JSON.stringify(body ?? {}), "utf8") > routeBodyLimit(route)) return response(413, { error: "request_body_too_large" });
    const memoryAction = route.match(/^\/memories\/([^/]+)\/(lineage|pin|unpin)$/);
    const allowedMethod = route === "/status" || route === "/consolidation/status" || route.startsWith("/operations/") || (route.startsWith("/memories/") && (!memoryAction || memoryAction[2] === "lineage")) ? "GET" : "POST";
    if (method !== allowedMethod) return response(405, { error: "method_not_allowed" });
    if (!consume({ route, headers })) return response(429, { error: "rate_limit_exceeded", retry_after_seconds: 60 });
    try {
      if (route === "/status") {
        const scope = resolveScope({ headers, capability: "pm:context", input: body });
        return response(200, await status({ scope }));
      }
      if (route === "/context") {
        const scope = resolveScope({ headers, capability: "pm:context", input: body });
        return response(200, await contextCard({ scope, ...body }));
      }
      if (route === "/recall") {
        const scope = resolveScope({ headers, capability: "pm:recall", input: body });
        return response(200, await recallOrchestrator.recall({ scope, ...body }));
      }
      if (route === "/commands") {
        if (typeof commandBus?.execute !== "function") throw new Error("personal_memory_writes_disabled");
        const capability = body?.operation === "resolve" ? "pm:resolve" : "pm:write";
        const scope = resolveScope({ headers, capability, input: body });
        return response(200, await commandBus.execute({ scope, token: tokenFrom(headers), command: body }));
      }
      if (route === "/forget/plan") {
        if (typeof commandBus?.planForget !== "function") throw new Error("personal_memory_writes_disabled");
        const scope = resolveScope({ headers, capability: "pm:write", input: body });
        return response(200, await commandBus.planForget({ scope, token: tokenFrom(headers), userInstruction: body.user_instruction, memoryId: body.memory_id }));
      }
      if (route === "/forget/apply") {
        if (typeof commandBus?.applyForget !== "function") throw new Error("personal_memory_writes_disabled");
        const scope = resolveScope({ headers, capability: "pm:write", input: body });
        return response(200, await commandBus.applyForget({ scope, token: tokenFrom(headers), userInstruction: body.user_instruction, planId: body.plan_id, planHash: body.plan_hash }));
      }
      if (route === "/capture") {
        const scope = resolveScope({ headers, capability: "pm:capture", input: body });
        return response(202, await capture({ scope, ...body }));
      }
      if (route === "/recall-feedback") {
        const scope = resolveScope({ headers, capability: "pm:capture", input: body });
        return response(202, await recordRecallFeedback({ scope, ...body }));
      }
      if (route === "/consolidation/status") {
        const scope = resolveScope({ headers, capability: "pm:context", input: body });
        return response(200, await consolidationStatus({ scope }));
      }
      if (route.startsWith("/operations/")) {
        const scope = resolveScope({ headers, capability: "pm:context", input: body });
        const operationId = decodeURIComponent(route.slice("/operations/".length));
        const operation = await operationStatus({ scope, operationId });
        return operation ? response(200, operation) : response(404, { error: "operation_not_found" });
      }
      if (memoryAction) {
        const memoryId = decodeURIComponent(memoryAction[1]);
        const action = memoryAction[2];
        const capability = ["pin", "unpin"].includes(action) ? "pm:write" : "pm:recall";
        const scope = resolveScope({ headers, capability, input: body });
        if (action === "lineage") {
          const result = await lineage({ scope, memoryId });
          return result ? response(200, result) : response(404, { error: "personal_memory_not_found" });
        }
        const result = await pinMemory({ scope, memoryId, pinned: action === "pin" });
        return result ? response(200, result) : response(404, { error: "personal_memory_not_found" });
      }
      if (route.startsWith("/memories/")) {
        const scope = resolveScope({ headers, capability: "pm:recall", input: body });
        const memoryId = decodeURIComponent(route.slice("/memories/".length));
        const memory = await getMemory({ scope, memoryId, asOf: body?.as_of ?? parsedUrl.searchParams.get("as_of") });
        return memory ? response(200, memory) : response(404, { error: "personal_memory_not_found" });
      }
      return response(404, { error: "route_not_found" });
    } catch (error) {
      return response(errorStatus(error), { error: error?.code ?? error?.message ?? "personal_manager_request_failed" });
    }
  };
  return Object.freeze({ handle });
}
