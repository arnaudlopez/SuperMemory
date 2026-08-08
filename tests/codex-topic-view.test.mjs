import assert from "node:assert/strict";
import test from "node:test";
import { createCodexTopicView } from "../scripts/lib/codex-topic-view.mjs";

const memberships = [
  { working_set_id: "current", session_id: "ses-current", relation: "continuation" },
  { working_set_id: "prior-a", session_id: "ses-a", relation: "root" },
  { working_set_id: "prior-b", session_id: "ses-b", relation: "continuation" }
];

function entry(id, tokens, overrides = {}) {
  return {
    evidence_id: id, episode_id: `epi-${id}`, event_id: `evt-${id}`,
    content_hash: `sha256:${id}`, token_estimate: tokens, kind: "tool.completed",
    priority: overrides.priority ?? 5, source_sequence: overrides.sequence ?? 1,
    pinned: overrides.pinned ?? false, status: "selected", complete: true,
    created_at: "2026-08-08T10:00:00Z", expires_at: null
  };
}

test("TC-AC07: topic view is bounded, reference-only and caps each prior session", () => {
  const states = new Map([
    ["current", { entries: [entry("cur", 4_000)] }],
    ["prior-a", { entries: [entry("a1", 3_000), entry("a2", 3_000)] }],
    ["prior-b", { entries: [entry("b1", 3_000)] }]
  ]);
  const view = createCodexTopicView({
    topicStore: { getContext: () => ({ topic: { topic_id: "topic-a" }, memberships, checkpoints: [] }) },
    workingStore: { resolveWorkingSet: ({ workingSetId }) => states.get(workingSetId) },
    capacityTokens: 10_000,
    clock: () => "2026-08-08T11:00:00Z"
  }).build({ workspaceId: "ws", projectId: "prj", workingSetId: "current" });
  assert.ok(view.budget.selected_tokens <= 10_000);
  assert.equal(view.selected.filter((item) => item.working_set_id === "prior-a").length, 1);
  assert.equal(Object.hasOwn(view.selected[0], "payload"), false);
  assert.equal(view.evidence_ids.includes("cur"), true);
});
