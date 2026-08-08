import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 4 * 1024 * 1024);
const NEO4J_HTTP_URL = process.env.NEO4J_HTTP_URL ?? "http://neo4j:7474";
const GRAPHITI_URL = process.env.GRAPHITI_URL ?? "http://graphiti:8000";
const IMPROVED_URL = process.env.IMPROVED_URL ?? "http://supermemory-improved:8081";
const TOKEN_FILE = process.env.GRAPHD_TOKEN_FILE ?? "/run/secrets/graphd_token";
const IMPROVED_TOKEN_FILE = process.env.IMPROVED_TOKEN_FILE ?? "/run/secrets/improved_token";
const NEO4J_AUTH_FILE = process.env.NEO4J_AUTH_FILE ?? "/run/secrets/neo4j_auth";
const WORKSPACE = /^ws_[0-9a-f-]{36}$/i;
const ENTITY = /^ent_[A-Za-z0-9:_-]{8,}$/;
const RELATION = /^rel_[A-Za-z0-9:_-]{8,}$/;
const DIRECTIONS = new Set(["outbound", "inbound", "both"]);

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function readSecret(filePath, code) {
  const value = fs.readFileSync(filePath, "utf8").trim();
  if (Buffer.byteLength(value) < 32) fail(code, 503);
  return value;
}

const apiToken = readSecret(TOKEN_FILE, "graphd_token_invalid");
const improvedToken = readSecret(IMPROVED_TOKEN_FILE, "improved_token_invalid");
const neo4jAuth = readSecret(NEO4J_AUTH_FILE, "neo4j_auth_invalid");
if (!neo4jAuth.includes("/")) fail("neo4j_auth_invalid", 503);
const [neo4jUser, ...neo4jPasswordParts] = neo4jAuth.split("/");
const neo4jPassword = neo4jPasswordParts.join("/");

export function workspaceGraphdBearer(secret, workspaceId) {
  const signature = crypto.createHmac("sha256", secret)
    .update(`supermemory.graphd.workspace.v1\0${workspaceId}`)
    .digest("base64url");
  return `smg1.${Buffer.from(workspaceId).toString("base64url")}.${signature}`;
}

function authorized(header, workspaceId) {
  if (!WORKSPACE.test(String(workspaceId ?? ""))) return false;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(workspaceGraphdBearer(apiToken, workspaceId));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  if (Object.keys(value).some((key) => !fields.has(key))) fail(code);
  return value;
}

function boundedStrings(value, pattern, maximum, code) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) fail(code);
  const unique = [...new Set(value)];
  if (unique.some((item) => typeof item !== "string" || !pattern.test(item))) fail(code);
  return unique;
}

function validateRequest(value, operation) {
  exactObject(value, new Set([
    "schema", "contract_version", "operation", "workspace_id", "statement_id", "parameters"
  ]), "graphd_request_invalid");
  if (
    value.schema !== "supermemory.graphd-request.v1" || value.contract_version !== "1.0.0" ||
    value.operation !== operation || !WORKSPACE.test(value.workspace_id)
  ) fail("graphd_request_invalid");
  const expected = operation === "query" ? "bounded_path_v1" : "replace_workspace_projection_v1";
  if (value.statement_id !== expected) fail("graphd_statement_forbidden");
  return value;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) fail("payload_too_large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("invalid_json");
  }
}

function send(response, status, body) {
  const serialized = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(serialized);
}

async function neo4jCommit(statements) {
  const response = await fetch(new URL("/db/neo4j/tx/commit", NEO4J_HTTP_URL), {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${neo4jUser}:${neo4jPassword}`).toString("base64")}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ statements }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) fail("neo4j_unavailable", 503);
  const result = await response.json();
  if (!Array.isArray(result.errors) || result.errors.length > 0 || !Array.isArray(result.results)) {
    fail("neo4j_query_failed", 503);
  }
  return result.results;
}

async function migrate() {
  await neo4jCommit([
    { statement: "CREATE CONSTRAINT sm_entity_identity IF NOT EXISTS FOR (n:SMEntity) REQUIRE (n.workspace_id, n.entity_id) IS UNIQUE" },
    { statement: "CREATE CONSTRAINT sm_claim_identity IF NOT EXISTS FOR (n:SMClaim) REQUIRE (n.workspace_id, n.claim_id) IS UNIQUE" },
    { statement: "CREATE INDEX sm_relation_identity IF NOT EXISTS FOR ()-[r:SM_RELATION]-() ON (r.workspace_id, r.relation_id)" },
    { statement: "CREATE CONSTRAINT sm_projection_identity IF NOT EXISTS FOR (n:SMProjection) REQUIRE n.workspace_id IS UNIQUE" }
  ]);
}

function projectionParameters(value, workspaceId) {
  exactObject(value, new Set(["workspace_id", "projection_hash", "records"]), "graphd_projection_invalid");
  if (value.workspace_id !== workspaceId || !/^sha256:[0-9a-f]{64}$/.test(value.projection_hash)) {
    fail("graphd_projection_invalid");
  }
  exactObject(value.records, new Set(["entities", "claims", "relations", "tombstones"]), "graphd_projection_invalid");
  for (const field of ["entities", "claims", "relations", "tombstones"]) {
    if (!Array.isArray(value.records[field]) || value.records[field].length > 50_000) fail("graphd_projection_invalid");
  }
  return value;
}

async function notifyGraphiti(workspaceId, claims) {
  const messages = claims.filter((claim) => claim.status === "active").slice(0, 1_000).map((claim) => ({
    uuid: claim.claim_id,
    name: "supermemory-authorized-claim",
    role_type: "system",
    role: "memory",
    content: claim.claim_text ?? claim.text,
    timestamp: claim.observed_at ?? claim.valid_from,
    source_description: "authorized redacted SuperMemory projection"
  }));
  if (messages.length === 0) return "empty";
  try {
    const response = await fetch(new URL("/messages", GRAPHITI_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ group_id: workspaceId, messages }),
      signal: AbortSignal.timeout(5_000)
    });
    return response.ok ? "accepted" : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function replaceProjection(input) {
  const request = validateRequest(input, "replace");
  const parameters = projectionParameters(request.parameters, request.workspace_id);
  const { records, projection_hash: projectionHash } = parameters;
  const graphitiStatus = await notifyGraphiti(request.workspace_id, records.claims);
  await neo4jCommit([
    {
      statement: "MATCH (n {workspace_id: $workspace_id}) DETACH DELETE n",
      parameters: { workspace_id: request.workspace_id }
    },
    {
      statement: "UNWIND $records AS record CREATE (n:SMEntity) SET n = record, n.workspace_id = $workspace_id",
      parameters: { workspace_id: request.workspace_id, records: records.entities }
    },
    {
      statement: "UNWIND $records AS record CREATE (n:SMClaim) SET n = record, n.workspace_id = $workspace_id",
      parameters: { workspace_id: request.workspace_id, records: records.claims }
    },
    {
      statement: [
        "UNWIND $records AS record",
        "MATCH (subject:SMEntity {workspace_id: $workspace_id, entity_id: record.subject_entity_id})",
        "MATCH (object:SMEntity {workspace_id: $workspace_id, entity_id: record.object_entity_id})",
        "CREATE (subject)-[relation:SM_RELATION]->(object)",
        "SET relation = record, relation.workspace_id = $workspace_id"
      ].join(" "),
      parameters: { workspace_id: request.workspace_id, records: records.relations }
    },
    {
      statement: "CREATE (n:SMProjection {workspace_id: $workspace_id, projection_hash: $projection_hash, replaced_at: datetime()})",
      parameters: { workspace_id: request.workspace_id, projection_hash: projectionHash }
    }
  ]);
  return { ok: true, projection_hash: projectionHash, backend: "direct-neo4j", graphiti: graphitiStatus };
}

function queryParameters(value, workspaceId) {
  exactObject(value, new Set([
    "workspace_id", "entity_ids", "relation_types", "direction", "as_of", "max_hops", "limit"
  ]), "graphd_query_invalid");
  if (value.workspace_id !== workspaceId || !Number.isFinite(Date.parse(value.as_of))) fail("graphd_query_invalid");
  const entityIds = boundedStrings(value.entity_ids, ENTITY, 20, "graphd_query_invalid");
  const relationTypes = boundedStrings(value.relation_types, /^[A-Za-z][A-Za-z0-9_:-]{1,63}$/, 20, "graphd_query_invalid");
  if (!DIRECTIONS.has(value.direction)) fail("graphd_query_invalid");
  if (!Number.isSafeInteger(value.max_hops) || value.max_hops < 1 || value.max_hops > 5) fail("graphd_query_invalid");
  if (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 20) fail("graphd_query_invalid");
  return { ...value, entity_ids: entityIds, relation_types: relationTypes };
}

async function boundedQuery(input) {
  const request = validateRequest(input, "query");
  const parameters = queryParameters(request.parameters, request.workspace_id);
  const pattern = parameters.direction === "outbound"
    ? "(start)-[:SM_RELATION*1..5]->(finish)"
    : parameters.direction === "inbound"
      ? "(start)<-[:SM_RELATION*1..5]-(finish)"
      : "(start)-[:SM_RELATION*1..5]-(finish)";
  const statement = [
    `MATCH path=${pattern}`,
    "WHERE start.workspace_id = $workspace_id AND start.entity_id IN $entity_ids",
    "AND all(node IN nodes(path) WHERE node.workspace_id = $workspace_id)",
    "AND all(relation IN relationships(path) WHERE relation.workspace_id = $workspace_id",
    "AND relation.predicate IN $relation_types",
    "AND datetime(relation.valid_from) <= datetime($as_of)",
    "AND (relation.valid_to IS NULL OR datetime($as_of) < datetime(relation.valid_to)))",
    "AND length(path) <= $max_hops",
    "RETURN [node IN nodes(path) | node.entity_id] AS entity_ids,",
    "[relation IN relationships(path) | relation.relation_id] AS relation_ids",
    "LIMIT $limit"
  ].join(" ");
  const [result] = await neo4jCommit([{ statement, parameters, resultDataContents: ["row"] }]);
  const paths = (result.data ?? []).map((entry) => ({
    entity_ids: entry.row[0],
    relation_ids: entry.row[1]
  })).filter((path) => (
    Array.isArray(path.entity_ids) && Array.isArray(path.relation_ids) &&
    path.relation_ids.every((id) => RELATION.test(id))
  ));
  return { paths, backend: "direct-neo4j" };
}

async function ready() {
  await neo4jCommit([{ statement: "RETURN 1 AS ready" }]);
  const response = await fetch(new URL("/healthcheck", GRAPHITI_URL), { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) fail("graphiti_unavailable", 503);
}

async function proxyImprovement(route, { method = "GET", body = null } = {}) {
  let response;
  try {
    response = await fetch(new URL(route, IMPROVED_URL), {
      method,
      headers: {
        authorization: `Bearer ${improvedToken}`,
        ...(body === null ? {} : { "content-type": "application/json" })
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(35_000)
    });
  } catch {
    fail("improvement_unavailable", 503);
  }
  const value = await response.json().catch(() => ({ ok: false, error: "improvement_response_invalid" }));
  if (!response.ok) fail(value.error ?? "improvement_failed", response.status);
  return value;
}

export function createGraphdServer() {
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
      if (request.method === "GET" && request.url === "/ready") {
        await ready();
        return send(response, 200, { ok: true, neo4j: "ready", graphiti: "ready" });
      }
      if (request.method === "POST" && request.url === "/v1/project") {
        const body = await readJson(request);
        if (!authorized(request.headers.authorization, body?.workspace_id)) fail("not_found_or_not_authorized", 404);
        return send(response, 200, await replaceProjection(body));
      }
      if (request.method === "POST" && request.url === "/v1/query") {
        const body = await readJson(request);
        if (!authorized(request.headers.authorization, body?.workspace_id)) fail("not_found_or_not_authorized", 404);
        return send(response, 200, await boundedQuery(body));
      }
      if (request.method === "POST" && request.url === "/v1/improve/notify") {
        const body = await readJson(request);
        if (!authorized(request.headers.authorization, body?.workspace_id)) fail("not_found_or_not_authorized", 404);
        return send(response, 202, await proxyImprovement("/v1/improve/notify", {
          method: "POST",
          body
        }));
      }
      if (request.method === "GET" && request.url?.startsWith("/v1/improve/status?")) {
        const workspaceId = new URL(request.url, "http://graphd.local").searchParams.get("workspace_id");
        if (!authorized(request.headers.authorization, workspaceId)) fail("not_found_or_not_authorized", 404);
        return send(response, 200, await proxyImprovement("/v1/improve/status"));
      }
      fail("not_found_or_not_authorized", 404);
    } catch (error) {
      send(response, error.status ?? 500, {
        ok: false,
        error: error.code ?? "graphd_failed"
      });
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  if (process.argv.includes("--migrate")) {
    await migrate();
    process.stdout.write("graphd migration complete\n");
  } else {
    createGraphdServer().listen(PORT, HOST);
  }
}
