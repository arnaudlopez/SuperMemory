import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSuperMemoryDaemon, createSuperMemoryRecallClient } from "../scripts/lib/supermemory-daemon.mjs";

const TOKEN = "daemon-token-0000000000000000000000000000";

test("daemon exposes authenticated read-only recall routes through a proxy client", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-daemon-recall-"));
  fs.mkdirSync(path.join(root, "vault"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seen = [];
  const memoryRouter = {
    rebuildFabric: async () => {
      seen.push(["rebuildFabric", {}]);
      return {
        schema: "supermemory.fabric-rebuild.v1",
        graph: { projected: true },
        topics: { working_sets: 2 },
        authority_states: 3,
        exceptions: 1
      };
    },
    recall: async (input) => { seen.push(["recall", input]); return { results: [{ text: "ok" }] }; },
    workingSearch: async (input) => { seen.push(["workingSearch", input]); return { results: [] }; },
    workingOpen: async () => ({}), workingNeighbors: async () => ({}), workingMap: async () => ({}),
    graphQuery: async () => ({ results: [] }), explainPath: async () => ({ path: {} }),
    search: async () => ({ results: [] }), get: async () => ({}), explainCitation: async () => ({}),
    status: async () => ({ strategies: ["hybrid"] })
  };
  const compiler = {
    notifyCapture() {}, recover() {}, stop: async () => {}, stats: () => ({ status: "idle" })
  };
  const daemon = createSuperMemoryDaemon({
    vaultRoot: path.join(root, "vault"),
    encryptionKey: Buffer.alloc(32, 7),
    authToken: TOKEN,
    memoryCompiler: compiler,
    memoryRouter
  });
  t.after(() => daemon.stop());
  const address = await daemon.start();
  const healthResponse = await fetch(`${address.url}/health`, {
    headers: { authorization: `Bearer ${TOKEN}` }
  });
  const health = await healthResponse.json();
  assert.equal(health.status, "ready");
  assert.deepEqual(health.fabric_rebuild, {
    status: "complete",
    error: null,
    schema: "supermemory.fabric-rebuild.v1",
    graph: "projected",
    topics: 2,
    authority_states: 3,
    exceptions: 1
  });
  const client = createSuperMemoryRecallClient({ endpoint: address.url, authToken: TOKEN, timeoutMs: 500 });
  const recalled = await client.recall({
    working_set_id: "wset_018f7c0e-7b7d-7abc-8def-0123456789ad",
    strategy: "hybrid",
    query: "architecture"
  });
  assert.equal(recalled.results[0].text, "ok");
  assert.equal(seen[0][0], "rebuildFabric");
  assert.equal(seen[1][0], "recall");
  await client.workingSearch({
    working_set_id: "wset_018f7c0e-7b7d-7abc-8def-0123456789ad",
    query: "test"
  });
  assert.equal(seen[2][0], "workingSearch");
});

test("a successful manual fabric rebuild clears a transient startup degradation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-daemon-rebuild-"));
  fs.mkdirSync(path.join(root, "vault"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let attempts = 0;
  const empty = async () => ({ results: [] });
  const memoryRouter = {
    async rebuildFabric() {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("graph unavailable"), { code: "graph_backend_unavailable" });
      return {
        schema: "supermemory.fabric-rebuild.v1",
        graph: { projected: true },
        topics: { working_sets: 1 },
        authority_states: 0,
        exceptions: 0
      };
    },
    recall: empty, workingSearch: empty, workingOpen: empty, workingNeighbors: empty, workingMap: empty,
    graphQuery: empty, explainPath: empty, search: empty, get: empty, explainCitation: empty,
    status: async () => ({ strategies: ["hybrid"] })
  };
  const compiler = {
    notifyCapture() {}, recover() {}, stop: async () => {}, stats: () => ({ status: "idle" })
  };
  const daemon = createSuperMemoryDaemon({
    vaultRoot: path.join(root, "vault"), encryptionKey: Buffer.alloc(32, 8), authToken: TOKEN,
    memoryCompiler: compiler, memoryRouter
  });
  t.after(() => daemon.stop());
  const address = await daemon.start();
  const headers = { authorization: `Bearer ${TOKEN}` };
  const degraded = await (await fetch(`${address.url}/health`, { headers })).json();
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.fabric_rebuild.error, "graph_backend_unavailable");
  const rebuilt = await fetch(`${address.url}/v1/admin/rebuild`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}"
  });
  assert.equal(rebuilt.status, 200);
  const ready = await (await fetch(`${address.url}/health`, { headers })).json();
  assert.equal(ready.status, "ready");
  assert.equal(ready.fabric_rebuild.status, "complete");
  assert.equal(ready.fabric_rebuild.graph, "projected");
});
