import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyWorkingEvent,
  estimateWorkingTokens,
  selectWorkingEvidence
} from "../scripts/lib/codex-working-set-index.mjs";

test("token estimates and event classification are deterministic", () => {
  assert.equal(estimateWorkingTokens({ text: "12345678" }), estimateWorkingTokens({ text: "12345678" }));
  const rich = classifyWorkingEvent({
    capture_coverage: "rich",
    envelope: { event_type: "tool.completed", capture_level: "rich" }
  }, { output: "ok" });
  assert.equal(rich.eligible, true);
  assert.equal(rich.complete, true);
  assert.equal(classifyWorkingEvent({ envelope: { event_type: "turn.completed" } }, {}).eligible, false);
  assert.equal(classifyWorkingEvent({
    capture_coverage: "partial",
    envelope: { event_type: "tool.completed", capture_level: "backfill" }
  }, {}).complete, false);
});

test("selection respects capacity, pins, and deterministic diversity-aware eviction", () => {
  const entries = [
    { evidence_id: "a", family: "tool", token_estimate: 70, priority: 10, source_sequence: 1, status: "selected", pinned: false },
    { evidence_id: "b", family: "tool", token_estimate: 70, priority: 20, source_sequence: 2, status: "selected", pinned: false },
    { evidence_id: "c", family: "prompt", token_estimate: 40, priority: 90, source_sequence: 3, status: "selected", pinned: true }
  ];
  const selected = selectWorkingEvidence(entries, { capacityTokens: 110, preserveRecentTurns: 0 });
  assert.equal(selected.selected_tokens <= 110, true);
  assert.equal(selected.entries.find((entry) => entry.evidence_id === "c").status, "selected");
  assert.equal(selected.entries.filter((entry) => entry.status === "evicted").length, 1);
  assert.equal(selected.entries.find((entry) => entry.evidence_id === "a").status, "evicted");
  assert.deepEqual(selectWorkingEvidence(entries, { capacityTokens: 110, preserveRecentTurns: 0 }), selected);
});
