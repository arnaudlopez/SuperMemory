import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareCodexCapture } from "../scripts/lib/codex-capture-store.mjs";
import { createCodexTopicResolver } from "../scripts/lib/codex-topic-resolver.mjs";
import { createCodexTopicStore } from "../scripts/lib/codex-topic-store.mjs";
import { createCodexTopicView } from "../scripts/lib/codex-topic-view.mjs";
import { createCodexWorkingRecall } from "../scripts/lib/codex-working-recall.mjs";
import { createCodexWorkingSetStore } from "../scripts/lib/codex-working-set-store.mjs";

const KEY = Buffer.alloc(32, 0x61);
const WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789ac";
const PROJECT = "prj_018f1234-5678-7abc-8def-0123456789ab";

function source(sessionId, index, text) {
  const timestamp = new Date(Date.UTC(2026, 7, 1 + index, 10, 0, 0)).toISOString();
  const prepared = prepareCodexCapture({
    adapter: "hook", adapter_version: "1.0.0", external_event_id: `${sessionId}-${index}`,
    workspace_id: WORKSPACE, project_id: PROJECT, checkout_id: "co_018f1234-5678-7abc-8def-0123456789ad",
    session_id: sessionId, thread_id: "thread_continuity", turn_id: `turn_test:${index}`,
    item_id: `item-${index}`, event_type: "prompt.submitted",
    occurred_at: timestamp, capture_level: "standard", sequence: 1,
    payload: { text }
  }, { encryptionKey: KEY, observedAt: new Date(Date.parse(timestamp) + 1_000).toISOString() });
  return {
    payload: prepared.payload,
    record: {
      schema: "supermemory.codex-journal-record.v1",
      envelope: { ...prepared.envelope, payload_ref: `blob:${prepared.envelope.payload_hash}` },
      order_status: "in_order", capture_coverage: "standard", applied: true, durable: true
    }
  };
}

test("E2E-AC01/TC-AC08/09/12: a new session recalls, opens and immediately tombstones old cited topic evidence", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topic-recall-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workingStore = createCodexWorkingSetStore({ vaultRoot: vault, encryptionKey: KEY });
  const topicStore = createCodexTopicStore({ vaultRoot: vault, encryptionKey: KEY });
  const resolver = createCodexTopicResolver({ topicStore, workingStore });
  const firstSource = source("ses_hook:session-a", 1, "Décision historique unique : utiliser le protocole azur.");
  const first = workingStore.admit(firstSource);
  const firstResolution = resolver.resolve({ workspaceId: WORKSPACE, projectId: PROJECT, workingSetId: first.state.manifest.working_set_id });
  assert.equal(firstResolution.continuity, "new");
  const captures = new Map([["ses_hook:session-a", [firstSource]]]);
  let second;
  let secondResolution;
  for (let index = 1; index <= 21; index += 1) {
    const sessionId = `ses_hook:session-${index}`;
    const nextSource = source(sessionId, index + 1, `Continuité intermédiaire ${index}.`);
    captures.set(sessionId, [nextSource]);
    second = workingStore.admit(nextSource);
    secondResolution = resolver.resolve({ workspaceId: WORKSPACE, projectId: PROJECT, workingSetId: second.state.manifest.working_set_id });
  }
  assert.equal(secondResolution.continuity, "exact");
  assert.equal(secondResolution.topic_id, firstResolution.topic_id);
  const captureStore = {
    readEvents: ({ sessionId }) => (captures.get(sessionId) ?? []).map(({ record, payload }) => ({ ...record, payload }))
  };
  const topicView = createCodexTopicView({ topicStore, workingStore });
  const recall = createCodexWorkingRecall({
    workingStore, captureStore, workspaceId: WORKSPACE, projectId: PROJECT, topicStore, topicView
  });
  const found = recall.search({
    working_set_id: second.state.manifest.working_set_id,
    query: "protocole azur"
  });
  assert.equal(found.scope, "topic");
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].working_set_id, first.state.manifest.working_set_id);
  const opened = recall.open({
    working_set_id: second.state.manifest.working_set_id,
    source_working_set_id: first.state.manifest.working_set_id,
    evidence_id: found.results[0].evidence_ids[0]
  });
  assert.match(opened.content, /protocole azur/);
  const map = recall.map({ working_set_id: second.state.manifest.working_set_id });
  assert.equal(map.schema, "supermemory.working-map.v2");
  assert.equal(map.topic.topic_id, firstResolution.topic_id);
  assert.ok(map.estimated_tokens <= 8_000);
  assert.equal(map.lines.every((line) => line.evidence_ids.length > 0), true);
  workingStore.tombstone({
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    sessionId: first.state.manifest.session_id,
    workingSetId: first.state.manifest.working_set_id,
    evidenceId: found.results[0].evidence_ids[0]
  });
  assert.equal(recall.search({
    working_set_id: second.state.manifest.working_set_id,
    query: "protocole azur"
  }).results.length, 0);
  assert.equal(recall.map({
    working_set_id: second.state.manifest.working_set_id
  }).evidence_ids.includes(found.results[0].evidence_ids[0]), false);
});
