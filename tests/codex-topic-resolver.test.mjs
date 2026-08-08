import assert from "node:assert/strict";
import test from "node:test";
import { createCodexTopicResolver } from "../scripts/lib/codex-topic-resolver.mjs";

const A = "wset_018f1234-5678-7abc-8def-0123456789ad";
const B = "wset_018f1234-5678-7abc-8def-0123456789ae";

function harness({ fork = false } = {}) {
  const contexts = new Map([[A, { topic: { topic_id: "topic-a" }, current_membership: { resolution: "exact" } }]]);
  let created = 0;
  const topicStore = {
    getContext: ({ workingSetId }) => {
      if (!contexts.has(workingSetId)) throw Object.assign(new Error("miss"), { code: "topic_not_found_or_not_authorized" });
      return contexts.get(workingSetId);
    },
    bind: ({ topicId, workingSetId, resolution }) => contexts.set(workingSetId, { topic: { topic_id: topicId }, current_membership: { resolution } }),
    createRoot: ({ workingSetId }) => {
      created += 1;
      const value = { topic: { topic_id: `topic-new-${created}` }, current_membership: { resolution: "exact" } };
      contexts.set(workingSetId, value);
      return value;
    },
    suggestLink: () => ({ active: false })
  };
  const workingStore = {
    resolveWorkingSet: ({ workingSetId }) => ({ manifest: {
      working_set_id: workingSetId,
      session_id: workingSetId === A ? "ses-a" : "ses-b",
      forked_from_working_set_id: workingSetId === B && fork ? A : null
    } })
  };
  return { resolver: createCodexTopicResolver({ topicStore, workingStore }), contexts, created: () => created };
}

test("TC-AC02: a verified fork inherits its parent topic", () => {
  const { resolver } = harness({ fork: true });
  const result = resolver.resolve({ workspaceId: "ws", projectId: "prj", workingSetId: B });
  assert.equal(result.topic_id, "topic-a");
  assert.equal(result.continuity, "inherited");
  assert.equal(result.created, false);
});

test("TC-AC03/13: ambiguous or semantic-only candidates create a new isolated topic", () => {
  const { resolver, created } = harness();
  const result = resolver.resolve({
    workspaceId: "ws", projectId: "prj", workingSetId: B,
    candidates: [
      { working_set_id: A, score: 0.91, semantic_only: true },
      { working_set_id: "wset-other", score: 0.89 }
    ]
  });
  assert.equal(result.continuity, "new");
  assert.equal(created(), 1);
});
