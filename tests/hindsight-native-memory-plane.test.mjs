import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createHindsightClientV2,
  HINDSIGHT_TARGET_DIGEST,
  hindsightBankId
} from "../scripts/lib/hindsight-client-v2.mjs";
import { createHindsightAuthorityGateway } from "../scripts/lib/hindsight-authority-gateway.mjs";
import { createHindsightOperationReceiptStore } from "../scripts/lib/hindsight-operation-receipts.mjs";
import { hindsightReflectSchema } from "../scripts/lib/hindsight-reflect-schemas.mjs";

const WORKSPACE = "ws_018f7c0e-7b7d-7abc-8def-0123456789ab";
const OTHER_WORKSPACE = "ws_018f7c0e-7b7d-7abc-8def-0123456789ac";

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("HN-AC07/08/09: bank and retain identities are opaque, stable, rich and replay-safe", async () => {
  assert.throws(() => createHindsightClientV2({
    workspaceId: WORKSPACE,
    baseUrl: "http://remote.example.test:8888"
  }), /hindsight_endpoint_insecure/);
  assert.throws(() => createHindsightClientV2({
    workspaceId: WORKSPACE,
    baseUrl: "http://user:password@127.0.0.1:8888"
  }), /hindsight_url_invalid/);
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method, body });
    return response({ operation_id: body.operation_id });
  };
  const client = createHindsightClientV2({ workspaceId: WORKSPACE, fetchImpl });
  assert.equal(client.bankId, hindsightBankId(WORKSPACE));
  assert.notEqual(client.bankId, hindsightBankId(OTHER_WORKSPACE));
  assert.doesNotMatch(client.bankId, /018f7c0e|SuperMemory/i);
  const input = {
    documentId: "mem_018f7c0e-7b7d-7abc-8def-0123456789ad",
    content: "Décision canonique redacted",
    timestamp: "2026-08-08T10:30:00.000Z",
    context: "project memory / canonical claim",
    entities: [{ text: "SuperMemory", type: "PROJECT" }],
    tags: [
      `workspace:${WORKSPACE}`, "consumer:codex", "sensitivity:standard",
      "domain:project", "schema:memory-v3", "status:active"
    ],
    observationScopes: [["consumer:codex", "sensitivity:standard", "domain:project"]],
    metadata: { admission_id: "adm_1", evidence_ids: ["wev_1"], authority_revision: 12 }
  };
  const first = await client.retain(input);
  const replay = await client.retain(input);
  assert.equal(first.operation_id, replay.operation_id);
  assert.match(first.operation_id, /^[0-9a-f-]{36}$/);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.items[0], calls[1].body.items[0]);
  assert.equal(calls[0].body.async, true);
  assert.equal(calls[0].body.items[0].timestamp, input.timestamp);
  assert.deepEqual(calls[0].body.items[0].entities, input.entities);
  assert.deepEqual(calls[0].body.items[0].observation_scopes, [["consumer:codex", "domain:project", "sensitivity:standard"]]);
  assert.equal(calls[0].body.items[0].metadata.evidence_ids, '["wev_1"]');
});

test("HN-AC05/06: live preflight checks digest, 0.9.0 capabilities, template dry-run/import and drift", async () => {
  const manifest = JSON.parse(fs.readFileSync("deploy/hindsight/supermemory-bank-template.v1.json", "utf8"));
  const capabilities = Object.fromEntries([
    "prefer_observations", "observation_scopes", "source_fact_ids", "source_facts", "tag_groups",
    "query_timestamp", "response_schema", "operation_id", "enable_temporal_retrieval",
    "enable_graph_retrieval", "enable_reranking", "last_write_at"
  ].map((key) => [key, {}]));
  const calls = [];
  const fetchImpl = async (url, init) => {
    const target = String(url);
    calls.push({ target, method: init.method });
    if (target.endsWith("/version")) return response({ version: "0.9.0" });
    if (target.endsWith("/openapi.json")) return response(capabilities);
    if (target.endsWith("/v1/bank-template-schema")) return response({ type: "object" });
    if (target.includes("/import?dry_run=true")) return response({ valid: true });
    if (target.includes("/import?dry_run=false")) return response({ imported: true });
    if (init.method === "GET" && target.includes("/v1/default/banks/smw_")) return response(manifest);
    throw new Error(`unexpected:${init.method}:${target}`);
  };
  const client = createHindsightClientV2({ workspaceId: WORKSPACE, fetchImpl });
  const report = await client.preflight({
    imageDigest: HINDSIGHT_TARGET_DIGEST,
    requireBehavioralProbe: true,
    behavioralProbe: async () => ({ sensitive_data_redacted: true })
  });
  assert.equal(report.status, "pass");
  const applied = await client.ensureBankTemplate(manifest);
  assert.equal(applied.status, "applied");
  assert.equal(applied.drift, false);
  assert.ok(calls.some((call) => call.target.includes("dry_run=true")));
  assert.equal(manifest.bank.enable_temporal_retrieval, true);
  assert.equal(manifest.bank.enable_graph_retrieval, true);
  assert.equal(manifest.bank.enable_reranking, true);
});

function authority(memoryId, active = true) {
  return {
    workspace_id: WORKSPACE,
    memory_id: memoryId,
    authorized: true,
    status: active ? "active" : "revoked",
    allowed_consumers: ["codex"],
    citation: { memory_id: memoryId, evidence_ids: [`wev_${memoryId}`] }
  };
}

test("HN-AC11/12/14/15/16 + QA-AC12: observations are all-or-nothing, reject non-current sources and historical recall excludes them", async () => {
  const calls = [];
  const sourceFacts = {
    fact_1: { id: "fact_1", metadata: { memory_id: "mem_1" }, text: "Source one" },
    fact_2: { id: "fact_2", metadata: { memory_id: "mem_2" }, text: "Source revoked" }
  };
  const client = {
    workspaceId: WORKSPACE,
    bankId: hindsightBankId(WORKSPACE),
    async recall(input) {
      calls.push(input);
      return {
        results: [
          { id: "obs_good", type: "observation", text: "Current synthesis", score: 99, source_fact_ids: ["fact_1"] },
          { id: "obs_bad", type: "observation", text: "Stale synthesis", score: 100, source_fact_ids: ["fact_1", "fact_2"] },
          { id: "fact_1", type: "world", text: "Source one", score: 0.4, metadata: { memory_id: "mem_1" } }
        ],
        source_facts: sourceFacts
      };
    },
    status: async () => ({ available: true })
  };
  const gateway = createHindsightAuthorityGateway({
    workspaceId: WORKSPACE,
    client,
    authorityResolver: ({ memoryId }) => memoryId === "mem_1" ? authority(memoryId) : authority(memoryId, false)
  });
  const current = await gateway.recall({ query: "état actuel" });
  assert.deepEqual(current.results.map((item) => item.id).sort(), ["fact_1", "obs_good"]);
  assert.equal(current.coverage.rejected, 1);
  assert.deepEqual(current.results.find((item) => item.id === "obs_good").source_fact_ids, ["fact_1"]);
  assert.equal(current.results.find((item) => item.id === "obs_good").score, 99);
  const historical = await gateway.recall({
    query: "état passé",
    historical: true,
    asOf: "2026-01-01T00:00:00.000Z"
  });
  assert.deepEqual(calls[1].types, ["world", "experience"]);
  assert.equal(calls[1].preferObservations, false);
  assert.equal(calls[1].includeSourceFacts, false);
  assert.equal(calls[1].queryTimestamp, "2026-01-01T00:00:00.000Z");
  assert.equal(historical.authoritative, false);
});

test("HN-AC17/18: Reflect is structured and fails closed when one based_on fact is invalid", async () => {
  let invalid = false;
  const client = {
    workspaceId: WORKSPACE,
    bankId: hindsightBankId(WORKSPACE),
    async reflect() {
      return {
        text: "Generated text",
        structured_output: { answer: "Résumé", key_points: ["Point"], uncertainties: [] },
        based_on: { facts: [
          { id: "fact_1", metadata: { memory_id: "mem_1" } },
          ...(invalid ? [{ id: "fact_2", metadata: { memory_id: "mem_2" } }] : [])
        ] }
      };
    }
  };
  const gateway = createHindsightAuthorityGateway({
    workspaceId: WORKSPACE,
    client,
    authorityResolver: ({ memoryId }) => memoryId === "mem_1" ? authority(memoryId) : null
  });
  const grounded = await gateway.reflect({
    query: "résume",
    format: "summary",
    responseSchema: hindsightReflectSchema("summary"),
    maxTokens: 2048
  });
  assert.equal(grounded.status, "grounded");
  assert.equal(grounded.coverage.facts_validated, 1);
  invalid = true;
  await assert.rejects(gateway.reflect({
    query: "résume",
    format: "summary",
    responseSchema: hindsightReflectSchema("summary")
  }), /reflect_grounding_failed_retryable/);
});

test("HN-AC08/10: AEAD receipts contain no plaintext payload and reconcile native operations", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-receipts-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createHindsightOperationReceiptStore({
    vaultRoot: vault,
    encryptionKey: Buffer.alloc(32, 0x41),
    workspaceId: WORKSPACE,
    clock: () => "2026-08-08T12:00:00.000Z"
  });
  const operationId = "018f7c0e-7b7d-5abc-8def-0123456789ab";
  store.put({ operationId, documentId: "mem_secret", payloadHash: "a".repeat(64), status: "pending" });
  const sealed = fs.readFileSync(path.join(store.root, `${operationId}.aead.json`), "utf8");
  assert.doesNotMatch(sealed, /mem_secret|pending|aaaaaaaa/);
  assert.equal(store.read(operationId).document_id, "mem_secret");
  assert.throws(() => store.put({
    operationId, documentId: "mem_other", payloadHash: "b".repeat(64), status: "pending"
  }), /hindsight_operation_replay_conflict/);
});
