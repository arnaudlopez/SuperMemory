import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexTopicStore } from "../scripts/lib/codex-topic-store.mjs";

const KEY = Buffer.alloc(32, 9);
const WORKSPACE_ID = "ws_018f1234-5678-7abc-8def-0123456789ac";
const OTHER_WORKSPACE_ID = "ws_018f1234-5678-7abc-8def-0123456789af";
const PROJECT_ID = "prj_018f1234-5678-7abc-8def-0123456789ab";
const WORKING_A = "wset_018f1234-5678-7abc-8def-0123456789ad";
const WORKING_B = "wset_018f1234-5678-7abc-8def-0123456789ae";

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topic-store-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault, store: createCodexTopicStore({ vaultRoot: vault, encryptionKey: KEY, ...options }) };
}

test("TC-AC01/04/05: roots and memberships are encrypted, idempotent and exact-scope", (t) => {
  const { vault, store } = fixture(t, { clock: () => "2026-08-08T10:00:00Z" });
  const root = store.createRoot({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_A, sessionId: "ses-a", title: "Secret topic title" });
  assert.match(root.topic.topic_id, /^topic_/);
  assert.equal(store.createRoot({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_A, sessionId: "ses-a" }).topic.topic_id, root.topic.topic_id);
  const second = store.bind({
    workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, topicId: root.topic.topic_id,
    workingSetId: WORKING_B, sessionId: "ses-b", relation: "continuation", resolution: "exact",
    reasonCodes: ["public_conversation_id"]
  });
  assert.equal(second.topic.topic_id, root.topic.topic_id);
  assert.equal(store.listMembers({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_B }).length, 2);
  const journal = fs.readFileSync(path.join(vault, "00_inbox/supermemory-product/codex-topics", WORKSPACE_ID, "topic-events.jsonl.aead"), "utf8");
  assert.doesNotMatch(journal, /Secret topic title|ses-a|public_conversation_id/);
  assert.throws(() => store.getContext({ workspaceId: OTHER_WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_A }), /topic_not_found_or_not_authorized/);
});

test("suggested links remain inactive and never create membership", (t) => {
  let tick = Date.parse("2026-08-08T10:00:00Z");
  const { store } = fixture(t, { clock: () => new Date(tick++).toISOString() });
  const left = store.createRoot({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_A, sessionId: "ses-a" });
  const right = store.createRoot({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_B, sessionId: "ses-b" });
  const suggestion = store.suggestLink({
    workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_A,
    candidateTopicId: right.topic.topic_id, score: 0.89
  });
  assert.equal(suggestion.active, false);
  assert.equal(store.getContext({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_A }).memberships.length, 1);
  assert.equal(store.getContext({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_B }).memberships.length, 1);
  assert.notEqual(left.topic.topic_id, right.topic.topic_id);
});

test("journal tampering and truncation fail closed", (t) => {
  const { vault, store } = fixture(t);
  store.createRoot({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingSetId: WORKING_A, sessionId: "ses-a" });
  const journalPath = path.join(vault, "00_inbox/supermemory-product/codex-topics", WORKSPACE_ID, "topic-events.jsonl.aead");
  const bytes = fs.readFileSync(journalPath);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  fs.writeFileSync(journalPath, bytes);
  assert.throws(() => store.replay({ workspaceId: WORKSPACE_ID }), /topic_journal_corrupt|topic_journal_truncated/);
});
