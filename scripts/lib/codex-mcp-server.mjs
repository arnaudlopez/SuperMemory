import readline from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INSTRUCTIONS = [
  "Use SuperMemory when a task depends on a prior project decision, durable user choice,",
  "constraint, incident, migration, or fact not established by current files.",
  "Search first, cite returned memory evidence, and never infer access to archives.",
  "Do not call memory tools when current project files fully answer the question."
].join(" ");

function tool(name, description, properties = {}, required = []) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false
    }
  };
}

const BOUND_TOOLS = Object.freeze([
  tool("supermemory_status", "Show this immutable project binding and memory health. Returns no archive content."),
  tool("supermemory_recall", "Recall cited working, durable, graph, hybrid, or temporal memory for the exact working set.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" },
    query: { type: "string", minLength: 1, maxLength: 4000 },
    strategy: { enum: ["auto", "working", "durable", "graph", "hybrid", "temporal"] },
    limit: { type: "integer", minimum: 1, maximum: 50 },
    types: { type: "array", items: { type: "string" }, maxItems: 20 },
    as_of: { type: ["string", "null"], format: "date-time" },
    entity_ids: { type: "array", items: { type: "string" }, maxItems: 20 },
    relation_types: { type: "array", items: { type: "string" }, maxItems: 20 },
    direction: { enum: ["outbound", "inbound", "both"] },
    max_hops: { type: "integer", minimum: 1, maximum: 5 }
  }, ["working_set_id", "query"]),
  tool("supermemory_search", "Search approved durable memory for the exact working set.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" },
    query: { type: "string", minLength: 1, maxLength: 4000 },
    limit: { type: "integer", minimum: 1, maximum: 50 },
    types: { type: "array", items: { type: "string" }, maxItems: 20 },
    as_of: { type: ["string", "null"], format: "date-time" }
  }, ["working_set_id", "query"]),
  tool("supermemory_get", "Get one active authorized memory from the bound project.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" },
    memory_id: { type: "string", pattern: "^mem_" }
  }, ["working_set_id", "memory_id"]),
  tool("supermemory_explain_citation", "Explain memory provenance without returning conversation archives.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" },
    memory_id: { type: "string", pattern: "^mem_" }
  }, ["working_set_id", "memory_id"]),
  tool("supermemory_working_map", "Return the bounded map for one exact working set.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" }
  }, ["working_set_id"]),
  tool("supermemory_working_search", "Search active evidence inside one exact working set.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" },
    query: { type: "string", minLength: 1, maxLength: 4000 },
    limit: { type: "integer", minimum: 1, maximum: 20 }
  }, ["working_set_id", "query"]),
  tool("supermemory_working_open", "Open one cited working evidence page without listing the working set.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" },
    evidence_id: { type: "string", pattern: "^wev_[0-9a-f-]{36}$" },
    max_tokens: { type: "integer", minimum: 1, maximum: 20000 },
    cursor: { type: "string", maxLength: 2048 }
  }, ["working_set_id", "evidence_id"]),
  tool("supermemory_working_neighbors", "Return bounded evidence neighbors around one cited item.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" },
    evidence_id: { type: "string", pattern: "^wev_[0-9a-f-]{36}$" },
    before: { type: "integer", minimum: 0, maximum: 10 },
    after: { type: "integer", minimum: 0, maximum: 10 }
  }, ["working_set_id", "evidence_id"]),
  tool("supermemory_graph_query", "Run a typed, workspace-bound graph query; raw Cypher is never accepted.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" },
    query: { type: "string", minLength: 1, maxLength: 4000 },
    entity_ids: { type: "array", items: { type: "string" }, maxItems: 20 },
    relation_types: { type: "array", items: { type: "string" }, maxItems: 20 },
    direction: { enum: ["outbound", "inbound", "both"] },
    max_hops: { type: "integer", minimum: 1, maximum: 5 },
    as_of: { type: ["string", "null"], format: "date-time" },
    limit: { type: "integer", minimum: 1, maximum: 20 }
  }, ["working_set_id", "query"]),
  tool("supermemory_graph_explain_path", "Explain one short-lived path returned by a prior graph recall.", {
    working_set_id: { type: "string", pattern: "^wset_[0-9a-f-]{36}$" },
    path_id: { type: "string", minLength: 1, maxLength: 256 }
  }, ["working_set_id", "path_id"])
]);

const DIAGNOSTIC_TOOLS = Object.freeze([
  tool("supermemory_status", "Show global SuperMemory diagnostics. Never returns memory content."),
  tool("supermemory_resolve_project", "Resolve a local path without creating a binding or exposing content.", {
    cwd: { type: "string", minLength: 1, maxLength: 4096 }
  }, ["cwd"])
]);

function errorMessage(id, code, message, data = undefined) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) }
  };
}

function resultMessage(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function toolResult(value, isError = false) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(value)
    }],
    structuredContent: value,
    ...(isError ? { isError: true } : {})
  };
}

function assertPlainArguments(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("arguments_invalid");
    error.code = "arguments_invalid";
    throw error;
  }
  return value;
}

export function createCodexMcpServer({
  mode = "bound",
  recall = null,
  diagnostics = null,
  serverVersion = "0.1.0"
} = {}) {
  if (!["bound", "diagnostic"].includes(mode)) throw new Error("mcp_mode_invalid");
  if (mode === "bound" && !recall) throw new Error("mcp_recall_required");
  if (mode === "diagnostic" && !diagnostics) throw new Error("mcp_diagnostics_required");
  const tools = mode === "bound" ? BOUND_TOOLS : DIAGNOSTIC_TOOLS;

  const callBound = async (method, args) => {
    if (typeof recall.assertBound !== "function") {
      throw Object.assign(new Error("backend_unavailable"), { code: "backend_unavailable" });
    }
    await recall.assertBound({ working_set_id: args.working_set_id });
    if (typeof recall[method] !== "function") {
      throw Object.assign(new Error("backend_unavailable"), { code: "backend_unavailable" });
    }
    return recall[method](args);
  };

  const callTool = async (name, rawArguments) => {
    const args = assertPlainArguments(rawArguments);
    const descriptor = tools.find((entry) => entry.name === name);
    if (!descriptor) {
      const error = new Error("tool_not_found");
      error.code = "tool_not_found";
      throw error;
    }
    if (
      mode === "bound" &&
      ["workspace_id", "workspaceId", "project_id", "projectId", "cwd", "session_id", "sessionId"]
        .some((key) => Object.hasOwn(args, key))
    ) throw Object.assign(new Error("scope_argument_forbidden"), { code: "scope_argument_forbidden" });
    if (
      Object.keys(args).some((key) => !Object.hasOwn(descriptor.inputSchema.properties, key)) ||
      descriptor.inputSchema.required.some((key) => !Object.hasOwn(args, key))
    ) throw Object.assign(new Error("arguments_invalid"), { code: "arguments_invalid" });
    if (mode === "diagnostic") {
      if (name === "supermemory_status") {
        if (Object.keys(args).length > 0) throw Object.assign(new Error("arguments_invalid"), {
          code: "arguments_invalid"
        });
        return diagnostics.status();
      }
      if (name === "supermemory_resolve_project") {
        if (Object.keys(args).some((key) => key !== "cwd") || typeof args.cwd !== "string") {
          throw Object.assign(new Error("arguments_invalid"), { code: "arguments_invalid" });
        }
        return diagnostics.resolveProject(args.cwd);
      }
    }
    if (name === "supermemory_status") {
      if (Object.keys(args).length > 0) throw Object.assign(new Error("arguments_invalid"), {
        code: "arguments_invalid"
      });
      return recall.status();
    }
    if (name === "supermemory_recall") return callBound("recall", args);
    if (name === "supermemory_search") return callBound("search", args);
    if (name === "supermemory_get") return callBound("get", args);
    if (name === "supermemory_explain_citation") return callBound("explainCitation", args);
    if (name === "supermemory_working_map") return callBound("workingMap", args);
    if (name === "supermemory_working_search") return callBound("workingSearch", args);
    if (name === "supermemory_working_open") return callBound("workingOpen", args);
    if (name === "supermemory_working_neighbors") return callBound("workingNeighbors", args);
    if (name === "supermemory_graph_query") return callBound("graphQuery", args);
    if (name === "supermemory_graph_explain_path") return callBound("explainPath", args);
    throw Object.assign(new Error("tool_not_found"), { code: "tool_not_found" });
  };

  const handle = async (message) => {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return errorMessage(message?.id ?? null, -32600, "Invalid Request");
    }
    const id = message.id;
    if (message.method === "notifications/initialized" || message.method.startsWith("notifications/")) {
      return null;
    }
    if (id === undefined) return null;
    if (message.method === "initialize") {
      return resultMessage(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: mode === "bound" ? "supermemory" : "supermemory-diagnostics", version: serverVersion },
        instructions: mode === "bound"
          ? SERVER_INSTRUCTIONS
          : "Diagnostic-only server. It cannot read candidates, memories, archives, or projections."
      });
    }
    if (message.method === "ping") return resultMessage(id, {});
    if (message.method === "tools/list") return resultMessage(id, { tools });
    if (message.method === "tools/call") {
      try {
        const value = await callTool(message.params?.name, message.params?.arguments);
        return resultMessage(id, toolResult(value));
      } catch (error) {
        return resultMessage(id, toolResult({
          error: error?.code ?? error?.message ?? "tool_failed"
        }, true));
      }
    }
    return errorMessage(id, -32601, "Method not found");
  };

  return {
    mode,
    tools,
    instructions: SERVER_INSTRUCTIONS,
    handle
  };
}

export async function runMcpStdio(server, {
  input = process.stdin,
  output = process.stdout
} = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(errorMessage(null, -32700, "Parse error"))}\n`);
      continue;
    }
    const response = await server.handle(message);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}
