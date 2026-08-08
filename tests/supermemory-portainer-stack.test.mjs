import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");
const composePath = path.join(root, "deploy/portainer/supermemory-ai-stack.yml");
const envPath = path.join(root, "deploy/portainer/supermemory-ai.env.example");

function composeConfig() {
  const result = spawnSync("docker", [
    "compose", "--env-file", envPath, "-f", composePath, "config", "--format", "json"
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("Portainer artifact is one complete six-service private brain stack", () => {
  const config = composeConfig();
  const required = ["hindsight", "neo4j", "neo4j-migrate", "supermemory-graphd", "supermemory-daemon", "supermemory-web"];
  assert.deepEqual(Object.keys(config.services).sort(), required.sort());
  for (const name of ["hindsight", "neo4j", "supermemory-graphd", "supermemory-daemon", "supermemory-web"]) {
    const service = config.services[name];
    assert.ok(service.healthcheck, `${name} healthcheck`);
    assert.ok(service.mem_limit, `${name} memory limit`);
    assert.ok(service.cpus, `${name} cpu limit`);
    assert.ok(service.pids_limit, `${name} pids limit`);
    assert.equal(service.restart, "unless-stopped");
  }
  assert.equal(config.services.neo4j.ports, undefined);
  assert.equal(config.services["supermemory-graphd"].ports[0].host_ip, "127.0.0.1");
  assert.deepEqual(
    Object.keys(config.services["supermemory-graphd"].networks).sort(),
    ["supermemory_ai", "supermemory_graph"]
  );
  assert.equal(config.services["supermemory-graphd"].depends_on["neo4j-migrate"].condition, "service_completed_successfully");
  assert.equal(config.services["neo4j-migrate"].depends_on.neo4j.condition, "service_healthy");
  assert.equal(config.services["supermemory-daemon"].network_mode, "host");
  assert.equal(config.services["supermemory-web"].network_mode, "host");
  assert.equal(config.services["supermemory-daemon"].depends_on.hindsight.condition, "service_healthy");
  assert.equal(config.services["supermemory-web"].depends_on["supermemory-daemon"].condition, "service_healthy");
  assert.equal(config.services.hindsight.environment.HINDSIGHT_API_LLM_PROVIDER, "openai-codex");
  assert.equal(config.services.hindsight.environment.HINDSIGHT_API_LLM_MODEL, "gpt-5.6-luna");
  assert.equal(config.services.hindsight.environment.HINDSIGHT_API_LLM_REASONING_EFFORT, "high");
  assert.equal(config.services.hindsight.environment.HINDSIGHT_API_LLM_MAX_CONCURRENT, "1");
});

test("stack uses two mounted secrets, persistent data and pinned Hindsight 0.9.0", () => {
  const config = composeConfig();
  assert.deepEqual(Object.keys(config.secrets).sort(), ["graphd_token", "neo4j_auth"]);
  for (const secret of Object.values(config.secrets)) {
    assert.equal(path.isAbsolute(secret.file), true);
    assert.match(secret.file, /\/opt\/supermemory\/secrets\//);
  }
  assert.equal(config.services.neo4j.environment.NEO4J_AUTH_FILE, "/run/secrets/neo4j_auth");
  assert.deepEqual(config.services["neo4j-migrate"].group_add, ["7474"]);
  assert.deepEqual(config.services["supermemory-graphd"].group_add, ["7474"]);
  for (const service of Object.values(config.services)) {
    assert.notEqual(service.privileged, true);
    if (service.image) assert.doesNotMatch(service.image, /:latest(?:@|$)/);
  }
  for (const name of ["hindsight_database_v090", "hindsight_cache_v090", "neo4j_data", "neo4j_logs", "neo4j_backups"]) {
    assert.ok(config.volumes[name], `${name} volume`);
  }
  const env = fs.readFileSync(envPath, "utf8");
  assert.doesNotMatch(env, /PASSWORD\s*=|TOKEN\s*=/);
  assert.match(env, /NEO4J_IMAGE=neo4j:5\.26\.28/);
  assert.match(env, /HINDSIGHT_IMAGE=ghcr\.io\/vectorize-io\/hindsight@sha256:6364c3c5/);
  assert.equal(config.services.hindsight.environment.HINDSIGHT_API_ENABLE_OBSERVATIONS, "true");
  assert.equal(config.services.hindsight.environment.HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION, "false");
  const compose = fs.readFileSync(composePath, "utf8");
  assert.doesNotMatch(compose, /\bollama\b|qwen-model|openrouter/i);
  assert.match(compose, /gpt-5\.6-luna/);
  const runtimeDockerfile = fs.readFileSync(path.join(root, "deploy/runtime/Dockerfile"), "utf8");
  assert.match(runtimeDockerfile, /@openai\/codex@\$\{CODEX_CLI_VERSION\}/);
  assert.match(runtimeDockerfile, /^USER node$/m);
  const runtime = JSON.parse(fs.readFileSync(
    path.join(root, "deploy/runtime/runtime-contract.production.json"),
    "utf8"
  ));
  assert.equal(runtime.deployment.activation, "full");
  assert.equal(runtime.schema, "supermemory.codex-runtime.v5");
  assert.equal(runtime.deployment.canary, false);
  assert.equal(runtime.deployment.progressive, false);
  assert.equal(runtime.working_memory.capacity_tokens, 100_000);
  assert.equal(runtime.working_memory.map_max_tokens, 8_000);
  assert.equal(runtime.admission.mode, "automatic");
  assert.equal(runtime.topic_continuity.enabled, true);
  assert.equal(runtime.temporal_retrieval.max_rounds, 3);
  assert.equal(runtime.authority.mode, "quiet");
});

test("GraphD v2 is non-root and exposes only bounded authenticated Neo4j operations", () => {
  const directory = path.join(root, "services/supermemory-graphd");
  const dockerfile = fs.readFileSync(path.join(directory, "Dockerfile"), "utf8");
  const source = fs.readFileSync(path.join(directory, "server.mjs"), "utf8");
  assert.match(dockerfile, /^FROM node:22\.22\.0-alpine/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(source, /timingSafeEqual/);
  assert.doesNotMatch(source, /child_process|\beval\s*\(|new Function/);
  assert.doesNotMatch(source, /MATCH\s*\(n\)\s*RETURN\s*n/i);
  const contract = JSON.parse(fs.readFileSync(
    path.join(root, "services/supermemory-graphd/contract.v2.json"), "utf8"
  ));
  assert.equal(contract.transport.raw_cypher_accepted, false);
  assert.equal(contract.operations.query.hard_max_hops, 5);
  assert.deepEqual(contract.fallback, {
    primary: "graphd-neo4j",
    runtime_fallback: null,
    canonical_revalidation: true
  });
});

test("offline backup and exact-confirmation restore remain explicit and deployment is atomic", () => {
  const backup = fs.readFileSync(path.join(root, "deploy/portainer/neo4j-backup.sh"), "utf8");
  const restore = fs.readFileSync(path.join(root, "deploy/portainer/neo4j-restore.sh"), "utf8");
  const readme = fs.readFileSync(path.join(root, "deploy/portainer/README.md"), "utf8");
  assert.match(backup, /database dump/);
  assert.match(backup, /sha256sum/);
  assert.match(restore, /RESTORE neo4j/);
  assert.match(restore, /database load/);
  assert.match(readme, /six-service/i);
  assert.match(readme, /docker compose[\s\S]*config/);
  assert.match(readme, /rollback/i);
  assert.match(readme, /no canary or progressive rollout/i);
});

test("GraphD v2 enforces workspace auth, rejects raw Cypher and talks directly to Neo4j", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-graphd-v2-"));
  const graphToken = "graphd-token-0000000000000000000000000000";
  const graphTokenFile = path.join(temp, "graphd_token");
  const neo4jAuthFile = path.join(temp, "neo4j_auth");
  fs.writeFileSync(graphTokenFile, graphToken);
  fs.writeFileSync(neo4jAuthFile, `neo4j/${"p".repeat(40)}`);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const relationId = `rel_${"b".repeat(64)}`;
  const statements = [];
  const neo4j = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    statements.push(...body.statements.map((item) => item.statement));
    const isPath = body.statements.some((item) => item.statement.includes("MATCH path="));
    const results = body.statements.map(() => isPath ? {
      columns: ["entity_ids", "relation_ids"],
      data: [{ row: [[`ent_${"a".repeat(64)}`, `ent_${"c".repeat(64)}`], [relationId]] }]
    } : { columns: [], data: [] });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ results, errors: [] }));
  });
  const neo4jUrl = await listen(neo4j);
  t.after(() => close(neo4j));

  process.env.NEO4J_HTTP_URL = neo4jUrl;
  process.env.GRAPHD_TOKEN_FILE = graphTokenFile;
  process.env.NEO4J_AUTH_FILE = neo4jAuthFile;
  const { createGraphdServer, workspaceGraphdBearer } = await import(`../services/supermemory-graphd/server.mjs?test=${Date.now()}`);
  const graphd = createGraphdServer();
  const graphdUrl = await listen(graphd);
  t.after(() => close(graphd));

  const denied = await fetch(`${graphdUrl}/v2/query`, { method: "POST", body: "{}" });
  assert.equal(denied.status, 404);
  const workspaceId = "ws_018f7c0e-7b7d-7abc-8def-0123456789ab";
  const workspaceBearer = workspaceGraphdBearer(graphToken, workspaceId);
  assert.match(workspaceBearer, /^smg2\./);
  const unsafe = await fetch(`${graphdUrl}/v2/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${workspaceBearer}`, "content-type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId, cypher: "MATCH (n) RETURN n" })
  });
  assert.equal(unsafe.status, 400);

  const typed = await fetch(`${graphdUrl}/v2/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${workspaceBearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      schema: "supermemory.graphd-request.v2",
      contract_version: "2.0.0",
      operation: "query",
      workspace_id: workspaceId,
      statement_id: "bounded_path_v2",
      parameters: {
        workspace_id: workspaceId,
        entity_ids: [`ent_${"a".repeat(64)}`],
        relation_types: ["DEPENDS_ON"],
        direction: "both",
        as_of: "2026-08-08T00:00:00.000Z",
        max_hops: 3,
        limit: 5
      }
    })
  });
  assert.equal(typed.status, 200);
  const result = await typed.json();
  assert.equal(result.backend, "graphd-neo4j");
  assert.deepEqual(result.paths[0].relation_ids, [relationId]);
  assert.ok(statements.some((statement) => statement.includes("MATCH path=")));

  const removedRoute = await fetch(`${graphdUrl}/v1/improve/notify`, {
    method: "POST",
    headers: { authorization: `Bearer ${workspaceBearer}`, "content-type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId })
  });
  assert.equal(removedRoute.status, 404);
});
