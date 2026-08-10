import assert from "node:assert/strict";
import test from "node:test";
import { createPersonalManagerApi } from "../scripts/lib/personal-manager-api.mjs";

const scope = Object.freeze({
  ownerId: "owner_personal",
  agentId: "agent_personal_manager",
  ownerWorkspaceId: "ws_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  allowedProjectIds: ["prj_11111111-1111-4111-8111-111111111111"]
});

test("Personal Manager API routes use agent auth and keep checkout routes separate", async () => {
  const calls = [];
  const api = createPersonalManagerApi({
    resolveScope: ({ capability, input }) => {
      calls.push({ capability, input });
      return scope;
    },
    contextCard: async () => ({ schema: "supermemory.personal-context-card.v1", token_count: 10, text: "context", entries: [] }),
    recallOrchestrator: { recall: async ({ mode }) => ({ results: [], coverage: { status: mode === "portfolio" ? "complete" : "partial" } }) },
    commandBus: { execute: async () => ({ status: "committed", operation_id: "op_1" }), planForget: () => ({ plan_id: "plan_1", plan_hash: "sha256:test" }), applyForget: () => ({ status: "committed" }) },
    capture: async () => ({ status: "queued" }),
    getMemory: async () => ({ memory_id: "mem_1" }),
    operationStatus: () => ({ operation_id: "op_1", status: "completed" }),
    status: () => ({ enabled: true })
  });
  const request = (path, body = {}) => api.handle({
    method: path.includes("status") || path.includes("operations") ? "GET" : "POST",
    path,
    headers: { "x-supermemory-agent-token": "sma_test" },
    body
  });
  assert.equal((await request("/v1/personal-manager/context")).status, 200);
  assert.equal((await request("/v1/personal-manager/recall", { query: "all", mode: "portfolio" })).body.coverage.status, "complete");
  assert.equal((await request("/v1/personal-manager/commands", { operation: "add" })).status, 200);
  assert.equal((await request("/v1/personal-manager/capture", { messages: [] })).status, 202);
  assert.equal((await request("/v1/personal-manager/operations/op_1")).body.status, "completed");
  assert.ok(calls.some((item) => item.capability === "pm:recall"));
  assert.ok(calls.some((item) => item.capability === "pm:write"));
  assert.equal(await api.handle({ method: "POST", path: "/v1/recall", headers: {}, body: {} }), null);
});

test("Personal Manager API fails closed on oversized and unsupported requests", async () => {
  const api = createPersonalManagerApi({
    resolveScope: () => scope,
    contextCard: async () => ({}),
    recallOrchestrator: { recall: async () => ({}) },
    commandBus: {},
    capture: async () => ({}),
    maxBodyBytes: 64
  });
  const oversized = await api.handle({
    method: "POST",
    path: "/v1/personal-manager/recall",
    headers: {},
    body: { query: "x".repeat(100) }
  });
  assert.equal(oversized.status, 413);
  const unsupported = await api.handle({ method: "DELETE", path: "/v1/personal-manager/status", headers: {}, body: {} });
  assert.equal(unsupported.status, 405);
});

test("Personal Manager API applies mutation limits per agent and minute", async () => {
  let now = 1_000;
  const api = createPersonalManagerApi({
    resolveScope: () => scope,
    contextCard: async () => ({}),
    recallOrchestrator: { recall: async () => ({}) },
    commandBus: { execute: async () => ({ status: "committed" }) },
    capture: async () => ({}),
    clock: () => now,
    rateLimits: { mutation: 1, capture: 1, recall: 1, read: 1 }
  });
  const request = {
    method: "POST",
    path: "/v1/personal-manager/commands",
    headers: { "x-supermemory-agent-token": "sma_test" },
    body: { operation: "add" }
  };
  assert.equal((await api.handle(request)).status, 200);
  assert.equal((await api.handle(request)).status, 429);
  now = 61_000;
  assert.equal((await api.handle(request)).status, 200);
});
