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
  const client = createSuperMemoryRecallClient({ endpoint: address.url, authToken: TOKEN, timeoutMs: 500 });
  const recalled = await client.recall({
    working_set_id: "wset_018f7c0e-7b7d-7abc-8def-0123456789ad",
    strategy: "hybrid",
    query: "architecture"
  });
  assert.equal(recalled.results[0].text, "ok");
  assert.equal(seen[0][0], "recall");
  await client.workingSearch({
    working_set_id: "wset_018f7c0e-7b7d-7abc-8def-0123456789ad",
    query: "test"
  });
  assert.equal(seen[1][0], "workingSearch");
});
