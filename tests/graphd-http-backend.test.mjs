import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGraphdHttpBackend } from "../scripts/lib/graphd-http-backend.mjs";

const WORKSPACE_ID = "ws_018f7c0e-7b7d-7abc-8def-0123456789ab";

test("remote graphd client is loopback-or-TLS only and binds bearer to one workspace", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "graphd-client-"));
  const tokenFile = path.join(root, "token");
  fs.writeFileSync(tokenFile, "workspace-token-000000000000000000000000", { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(() => createGraphdHttpBackend({
    endpoint: "http://graph.example.test",
    tokenFile,
    workspaceId: WORKSPACE_ID
  }), /graphd_endpoint_insecure/);

  let received;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = {
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ paths: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const backend = createGraphdHttpBackend({ endpoint, tokenFile, workspaceId: WORKSPACE_ID });
  await backend.query({
    schema: "supermemory.graphd-request.v1",
    contract_version: "1.0.0",
    operation: "query",
    workspace_id: WORKSPACE_ID,
    statement_id: "bounded_path_v1",
    parameters: { workspace_id: WORKSPACE_ID }
  });
  assert.match(received.authorization, /^Bearer /);
  assert.equal(received.body.workspace_id, WORKSPACE_ID);
  await assert.rejects(() => backend.query({
    ...received.body,
    workspace_id: "ws_018f7c0e-7b7d-7abc-8def-0123456789ff"
  }), /not_found_or_not_authorized/);
});
