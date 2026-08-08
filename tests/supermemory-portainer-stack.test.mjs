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
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("Portainer artifact is one complete private server stack with bounded services", () => {
  const config = composeConfig();
  const required = [
    "ollama", "qwen-model", "embedding-model", "hindsight", "neo4j", "neo4j-migrate",
    "graphiti", "supermemory-graphd", "supermemory-improved"
  ];
  assert.deepEqual(Object.keys(config.services).sort(), required.sort());
  for (const name of ["ollama", "hindsight", "neo4j", "graphiti", "supermemory-graphd", "supermemory-improved"]) {
    const service = config.services[name];
    assert.ok(service.healthcheck, `${name} healthcheck`);
    assert.ok(service.mem_limit, `${name} memory limit`);
    assert.ok(service.cpus, `${name} cpu limit`);
    assert.ok(service.pids_limit, `${name} pids limit`);
    assert.equal(service.restart, "unless-stopped");
  }
  assert.equal(config.services.neo4j.ports, undefined);
  assert.equal(config.services.graphiti.ports, undefined);
  assert.equal(config.services["supermemory-improved"].ports, undefined);
  assert.equal(config.services["supermemory-graphd"].ports[0].host_ip, "127.0.0.1");
  assert.equal(config.services["supermemory-graphd"].depends_on["neo4j-migrate"].condition, "service_completed_successfully");
  assert.equal(config.services["supermemory-improved"].depends_on["neo4j-migrate"].condition, "service_completed_successfully");
  assert.equal(config.services.graphiti.depends_on["embedding-model"].condition, "service_completed_successfully");
});

test("stack uses mounted secret files, persistent data, pinned versions and no privileged containers", () => {
  const config = composeConfig();
  assert.deepEqual(Object.keys(config.secrets).sort(), [
    "graphd_token", "improved_state_key", "improved_token", "neo4j_auth"
  ]);
  for (const secret of Object.values(config.secrets)) {
    assert.equal(path.isAbsolute(secret.file), true);
    assert.match(secret.file, /\/opt\/supermemory\/secrets\//);
  }
  assert.equal(config.services.neo4j.environment.NEO4J_AUTH_FILE, "/run/secrets/neo4j_auth");
  for (const service of Object.values(config.services)) {
    assert.notEqual(service.privileged, true);
    if (service.image) assert.doesNotMatch(service.image, /:latest(?:@|$)/);
  }
  for (const name of ["neo4j_data", "neo4j_logs", "neo4j_backups", "improved_state"]) {
    assert.ok(config.volumes[name], `${name} volume`);
  }
  const env = fs.readFileSync(envPath, "utf8");
  assert.doesNotMatch(env, /PASSWORD\s*=|TOKEN\s*=/);
  assert.match(env, /NEO4J_IMAGE=neo4j:5\.26\.28/);
  assert.match(env, /GRAPHITI_IMAGE=zepai\/graphiti:0\.22\.0/);
});

test("gateway and improvement images are non-root and expose only bounded authenticated APIs", () => {
  for (const service of ["supermemory-graphd", "supermemory-improved"]) {
    const directory = path.join(root, "services", service);
    const dockerfile = fs.readFileSync(path.join(directory, "Dockerfile"), "utf8");
    const source = fs.readFileSync(path.join(directory, "server.mjs"), "utf8");
    assert.match(dockerfile, /^FROM node:22\.22\.0-alpine/m);
    assert.match(dockerfile, /^USER node$/m);
    assert.match(source, /timingSafeEqual/);
    assert.doesNotMatch(source, /child_process|\beval\s*\(|new Function/);
    assert.doesNotMatch(source, /MATCH\s*\(n\)\s*RETURN\s*n/i);
  }
  const contract = JSON.parse(fs.readFileSync(
    path.join(root, "services/supermemory-graphd/contract.v1.json"), "utf8"
  ));
  assert.equal(contract.transport.raw_cypher_accepted, false);
  assert.equal(contract.operations.query.hard_max_hops, 5);
  assert.deepEqual(contract.fallback, {
    primary: "graphiti-neo4j",
    fallback: "direct-neo4j",
    same_typed_request: true,
    same_canonical_revalidation: true
  });
});

test("offline backup and exact-confirmation restore are explicit and deployment is atomic", () => {
  const backup = fs.readFileSync(path.join(root, "deploy/portainer/neo4j-backup.sh"), "utf8");
  const restore = fs.readFileSync(path.join(root, "deploy/portainer/neo4j-restore.sh"), "utf8");
  const readme = fs.readFileSync(path.join(root, "deploy/portainer/README.md"), "utf8");
  assert.match(backup, /database dump/);
  assert.match(backup, /sha256sum/);
  assert.match(restore, /RESTORE neo4j/);
  assert.match(restore, /database load/);
  assert.match(readme, /full stack/i);
  assert.match(readme, /docker compose[\s\S]*config/);
  assert.match(readme, /rollback/i);
  assert.match(readme, /no canary or progressive rollout/i);
});

test("graph gateway enforces typed auth and proxies an idempotent improvement job", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-portainer-services-"));
  const graphToken = "graphd-token-0000000000000000000000000000";
  const improvedToken = "improved-token-00000000000000000000000000";
  const graphTokenFile = path.join(temp, "graphd_token");
  const improvedTokenFile = path.join(temp, "improved_token");
  const improvedStateKeyFile = path.join(temp, "improved_state_key");
  const neo4jAuthFile = path.join(temp, "neo4j_auth");
  fs.writeFileSync(graphTokenFile, graphToken);
  fs.writeFileSync(improvedTokenFile, improvedToken);
  fs.writeFileSync(improvedStateKeyFile, "7a".repeat(32));
  fs.writeFileSync(neo4jAuthFile, `neo4j/${"p".repeat(40)}`);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const graphitiMessages = [];
  const graphiti = http.createServer(async (request, response) => {
    if (request.url === "/healthcheck") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"healthy"}');
      return;
    }
    if (request.url === "/messages") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      graphitiMessages.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(202, { "content-type": "application/json" });
      response.end('{"success":true}');
      return;
    }
    response.writeHead(404).end();
  });
  const graphitiUrl = await listen(graphiti);
  t.after(() => close(graphiti));

  const relationId = `rel_${"b".repeat(64)}`;
  const neo4j = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

  process.env.GRAPHITI_URL = graphitiUrl;
  process.env.IMPROVED_TOKEN_FILE = improvedTokenFile;
  process.env.IMPROVED_STATE_KEY_FILE = improvedStateKeyFile;
  process.env.IMPROVED_STATE_FILE = path.join(temp, "improved-state.json");
  const { createImprovedServer } = await import(`../services/supermemory-improved/server.mjs?test=${Date.now()}`);
  const improved = createImprovedServer();
  const improvedUrl = await listen(improved);
  t.after(() => close(improved));

  process.env.NEO4J_HTTP_URL = neo4jUrl;
  process.env.IMPROVED_URL = improvedUrl;
  process.env.GRAPHD_TOKEN_FILE = graphTokenFile;
  process.env.NEO4J_AUTH_FILE = neo4jAuthFile;
  const { createGraphdServer, workspaceGraphdBearer } = await import(`../services/supermemory-graphd/server.mjs?test=${Date.now()}`);
  const graphd = createGraphdServer();
  const graphdUrl = await listen(graphd);
  t.after(() => close(graphd));

  const denied = await fetch(`${graphdUrl}/v1/query`, { method: "POST", body: "{}" });
  assert.equal(denied.status, 404);
  const workspaceId = "ws_018f7c0e-7b7d-7abc-8def-0123456789ab";
  const workspaceBearer = workspaceGraphdBearer(graphToken, workspaceId);
  const unsafe = await fetch(`${graphdUrl}/v1/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${workspaceBearer}`, "content-type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId, cypher: "MATCH (n) RETURN n" })
  });
  assert.equal(unsafe.status, 400);

  const typed = await fetch(`${graphdUrl}/v1/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${workspaceBearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      schema: "supermemory.graphd-request.v1",
      contract_version: "1.0.0",
      operation: "query",
      workspace_id: workspaceId,
      statement_id: "bounded_path_v1",
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
  assert.deepEqual((await typed.json()).paths[0].relation_ids, [relationId]);

  const job = {
    schema: "supermemory.improve-notify.v1",
    job_id: "imj_integration_0001",
    workspace_id: workspaceId,
    cursor: 7,
    episodes: [{
      episode_id: "epi_018f7c0e-7b7d-7abc-8def-0123456789ad",
      evidence_ids: ["wev_018f7c0e-7b7d-7abc-8def-0123456789ae"],
      content: "Authorized redacted graph evidence",
      observed_at: "2026-08-08T00:00:00.000Z",
      admission_id: "adm_authorized_0001",
      ontology_version: "ontv_core_v1"
    }]
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const notified = await fetch(`${graphdUrl}/v1/improve/notify`, {
      method: "POST",
      headers: { authorization: `Bearer ${workspaceBearer}`, "content-type": "application/json" },
      body: JSON.stringify(job)
    });
    assert.ok([200, 202].includes(notified.status));
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(graphitiMessages.length, 1);
  const sealedState = fs.readFileSync(process.env.IMPROVED_STATE_FILE, "utf8");
  assert.match(sealedState, /supermemory\.improved-state-envelope\.v1/);
  assert.doesNotMatch(sealedState, /Authorized redacted graph evidence|imj_integration_0001/);
});
