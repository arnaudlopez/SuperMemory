import assert from "node:assert/strict";
import {
  buildHindsightRequests,
  executeHindsightRequests,
  serializeHindsightMetadata
} from "../scripts/hindsight-transport.mjs";

const plan = {
  bank_id: "bank-test",
  operations: [
    {
      operation: "retain",
      document_id: "doc-a",
      memory_id: "mem-a",
      content: "Retain A",
      tags: ["workspace:ws-a", "status:active"],
      metadata: {
        source_id: "src-a",
        snapshot_id: "snap-a",
        derived_from: ["snap-a"],
        reliability: { score: 0.93, rule: "owner_verified" },
        confidence: 0.93,
        owner_confirmed: true,
        nullable: null
      }
    },
    {
      operation: "upsert",
      document_id: "doc-a",
      memory_id: "mem-a2",
      content: "Retain A2",
      tags: ["workspace:ws-a", "status:active"],
      metadata: { source_id: "src-a", snapshot_id: "snap-a2" }
    },
    {
      operation: "delete",
      document_id: "doc-old",
      memory_id: "mem-old"
    },
    {
      operation: "skip",
      document_id: "doc-skip",
      memory_id: "mem-skip"
    }
  ],
  recall_policies: [
    {
      policy_id: "recall-a",
      query: "What should A recall?",
      required_tags: ["workspace:ws-a", "status:active"],
      fail_closed: true
    }
  ]
};

const requests = buildHindsightRequests(plan, {
  baseUrl: "https://api.hindsight.vectorize.io",
  apiKey: "sk-test-secret"
});

assert.equal(requests.length, 4);
assert.equal(requests[0].method, "POST");
assert.equal(requests[0].path, "/v1/default/banks/bank-test/memories");
assert.deepEqual(requests[0].body.items[0], {
  content: "Retain A",
  document_id: "doc-a",
  tags: ["workspace:ws-a", "status:active"],
  metadata: {
    source_id: "src-a",
    snapshot_id: "snap-a",
    derived_from: "[\"snap-a\"]",
    reliability: "{\"score\":0.93,\"rule\":\"owner_verified\"}",
    confidence: "0.93",
    owner_confirmed: "true",
    memory_id: "mem-a"
  }
});
assert.ok(Object.values(requests[0].body.items[0].metadata).every((value) => typeof value === "string"));
assert.equal(requests[1].body.items[0].document_id, "doc-a");
assert.equal(requests[2].method, "DELETE");
assert.equal(requests[2].path, "/v1/default/banks/bank-test/documents/doc-old");
assert.equal(requests[3].method, "POST");
assert.equal(requests[3].path, "/v1/default/banks/bank-test/memories/recall");
assert.deepEqual(requests[3].body, {
  query: "What should A recall?",
  trace: true,
  tags: ["workspace:ws-a", "status:active"],
  tags_match: "all_strict"
});
assert.equal(JSON.stringify(requests).includes("sk-test-secret"), false);
assert.deepEqual(serializeHindsightMetadata({
  keep: "as-string",
  list: ["a", "b"],
  object: { nested: true },
  number: 42,
  bool: false,
  nil: null,
  missing: undefined
}), {
  keep: "as-string",
  list: "[\"a\",\"b\"]",
  object: "{\"nested\":true}",
  number: "42",
  bool: "false"
});

const calls = [];
const result = await executeHindsightRequests(requests, {
  apiKey: "sk-test-secret",
  fetchImpl: async (url, request) => {
    calls.push({ url, request });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true })
    };
  }
});

assert.equal(result.status, "mocked");
assert.equal(result.requests_sent, 4);
assert.equal(calls.length, 4);
assert.equal(calls[0].url, "https://api.hindsight.vectorize.io/v1/default/banks/bank-test/memories");
assert.equal(calls[0].request.headers.Authorization, "Bearer sk-test-secret");
