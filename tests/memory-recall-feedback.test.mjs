import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMemoryRecallFeedbackStore } from "../scripts/lib/memory-recall-feedback.mjs";

test("recall feedback is bounded, encrypted and contains no prompt or raw response", () => {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-feedback-"));
  const store = createMemoryRecallFeedbackStore({ vaultRoot, encryptionKey: crypto.randomBytes(32) });
  const result = store.record({
    ownerId: "owner_personal",
    agentId: "agent_personal_manager",
    sessionId: "session_feedback",
    memoryId: "mem_feedback_123456",
    revision: 1,
    outcome: "confirmed",
    occurredAt: "2026-08-10T10:00:00.000Z"
  });
  assert.equal(result.status, "stored");
  assert.equal(store.summary({ memoryId: "mem_feedback_123456" }).confirmed, 1);
  const ciphertext = fs.readFileSync(store.storePath, "utf8");
  assert.doesNotMatch(ciphertext, /owner_personal|mem_feedback_123456/);
  assert.throws(() => store.record({
    ownerId: "owner_personal", agentId: "agent_personal_manager", sessionId: "session_feedback",
    memoryId: "mem_feedback_123456", revision: 1, outcome: "confirmed",
    prompt: "hidden", occurredAt: "2026-08-10T10:00:01.000Z"
  }), { message: "recall_feedback_raw_content_forbidden" });
});

test("feedback outcomes are allowlisted and idempotent", () => {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-feedback-"));
  const store = createMemoryRecallFeedbackStore({ vaultRoot, encryptionKey: crypto.randomBytes(32) });
  const event = {
    ownerId: "owner_personal", agentId: "agent_personal_manager", sessionId: "session_feedback",
    memoryId: "mem_feedback_123456", revision: 1, outcome: "used", occurredAt: "2026-08-10T10:00:00.000Z"
  };
  assert.equal(store.record(event).status, "stored");
  assert.equal(store.record(event).status, "duplicate");
  assert.throws(() => store.record({ ...event, outcome: "executed_shell" }), { message: "recall_feedback_outcome_invalid" });
});
