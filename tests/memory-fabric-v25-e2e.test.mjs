import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPersonalManagerApi } from "../scripts/lib/personal-manager-api.mjs";
import { createPersonalMemoryCommandBus } from "../scripts/lib/personal-memory-command-bus.mjs";
import { createPersonalMemoryRevisionStore } from "../scripts/lib/personal-memory-revision-store.mjs";
import { createPersonalMutationIntentGate, signPersonalTurnIntent } from "../scripts/lib/personal-mutation-intent-gate.mjs";

const scope = {
  ownerId: "owner_personal",
  agentId: "agent_personal_manager",
  ownerWorkspaceId: "ws_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  allowedProjectIds: ["prj_11111111-1111-4111-8111-111111111111"]
};

test("Personal Manager exposes owner-only lineage, pin, feedback and consolidation status", async () => {
  const calls = [];
  const api = createPersonalManagerApi({
    resolveScope: ({ capability }) => { calls.push(capability); return scope; },
    contextCard: async () => ({}),
    recallOrchestrator: { recall: async () => ({ results: [], coverage: { status: "complete" } }) },
    commandBus: { execute: async () => ({ status: "committed" }) },
    capture: async () => ({ status: "queued" }),
    getMemory: async () => ({ memory_id: "mem_natural_123456" }),
    lineage: async () => ({ memory_id: "mem_natural_123456", episode_ids: ["episode_1"], evidence_ids: ["evidence_1"] }),
    pinMemory: async ({ pinned }) => ({ memory_id: "mem_natural_123456", pinned }),
    recordRecallFeedback: async () => ({ status: "stored" }),
    consolidationStatus: () => ({ status: "ready", pending: 0 }),
    status: () => ({ enabled: true })
  });
  const handle = (method, path, body = {}) => api.handle({ method, path, headers: { "x-supermemory-agent-token": "sma_test" }, body });
  assert.equal((await handle("GET", "/v1/personal-manager/memories/mem_natural_123456/lineage")).status, 200);
  assert.equal((await handle("POST", "/v1/personal-manager/memories/mem_natural_123456/pin")).body.pinned, true);
  assert.equal((await handle("POST", "/v1/personal-manager/memories/mem_natural_123456/unpin")).body.pinned, false);
  assert.equal((await handle("POST", "/v1/personal-manager/recall-feedback", { memory_id: "mem_natural_123456", outcome: "confirmed" })).status, 202);
  assert.equal((await handle("GET", "/v1/personal-manager/consolidation/status")).body.status, "ready");
  assert.ok(calls.every((capability) => capability.startsWith("pm:")));
});

test("checkout credentials cannot access owner longitudinal routes", async () => {
  const api = createPersonalManagerApi({
    resolveScope: () => { throw Object.assign(new Error("agent_token_invalid"), { code: "agent_token_invalid" }); },
    contextCard: async () => ({}), recallOrchestrator: { recall: async () => ({}) }, commandBus: {}, capture: async () => ({})
  });
  const result = await api.handle({
    method: "GET",
    path: "/v1/personal-manager/consolidation/status",
    headers: { authorization: "Bearer checkout_token" },
    body: {}
  });
  assert.equal(result.status, 401);
});

test("retiens que commits an immediate governed pin", async () => {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-v25-pin-"));
  const token = `sma_${Buffer.alloc(32, 9).toString("base64url")}`;
  const store = createPersonalMemoryRevisionStore({ vaultRoot, encryptionKey: crypto.randomBytes(32) });
  const bus = createPersonalMemoryCommandBus({
    revisionStore: store,
    intentGate: createPersonalMutationIntentGate()
  });
  const message = "Retiens que je préfère les réunions le matin.";
  const instruction = {
    agent_id: scope.agentId,
    turn_id: "turn_pin_v25",
    nonce: "nonce_pin_v25_123456",
    message,
    message_hash: `sha256:${crypto.createHash("sha256").update(message).digest("hex")}`
  };
  instruction.signature = signPersonalTurnIntent({ token, ...instruction });
  const receipt = await bus.execute({
    scope,
    token,
    command: {
      schema: "supermemory.personal-memory-command.v1",
      command_id: "pmc_pin_v25_123456",
      idempotency_key: "idem_pin_v25_123456",
      operation: "add",
      target: null,
      expected_revision: null,
      scope: { kind: "owner" },
      patch: { domain: "preference", title: "Réunions", text: "Je préfère les réunions le matin." },
      user_instruction: instruction
    }
  });
  assert.equal(receipt.revision.pinned, true);
  assert.equal(store.current({ memoryId: receipt.memory_id }).recall_priority, 1);
});
