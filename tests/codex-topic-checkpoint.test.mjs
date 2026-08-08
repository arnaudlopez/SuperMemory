import assert from "node:assert/strict";
import test from "node:test";
import { buildDeterministicTopicCheckpoint, enrichTopicCheckpoint } from "../scripts/lib/codex-topic-checkpoint.mjs";

const topic = { schema: "supermemory.topic.v1", topic_id: "topic-a", workspace_id: "ws", project_id: "prj" };
const membership = { schema: "supermemory.topic-membership.v1", topic_id: "topic-a", working_set_id: "wset-a", session_id: "ses-a" };
const item = (text, id) => ({ text, evidence_ids: [id] });
const workingMap = {
  working_set_id: "wset-a", workspace_id: "ws", project_id: "prj",
  generated_at: "2026-08-08T10:00:00Z", input_hash: "sha256:input",
  evidence_ids: ["wev-1", "wev-2"],
  sections: {
    goal: [item("Ship v2.2", "wev-1")], constraints: [item("No fallback", "wev-2")],
    current_state: [], completed: [], decisions: [], open_questions: [], next_actions: [],
    files: [], errors: [], evidence_catalog: []
  }
};

test("TC-AC10/11: checkpoints are deterministic, cited and Reflect remains non-authoritative", () => {
  const first = buildDeterministicTopicCheckpoint({ topic, membership, workingMap });
  const second = buildDeterministicTopicCheckpoint({ topic, membership, workingMap });
  assert.equal(first.checkpoint_id, second.checkpoint_id);
  assert.equal(first.invariants[0].evidence_ids[0], "wev-2");
  const enriched = enrichTopicCheckpoint({ checkpoint: first, enrichment: "Résumé Hindsight", basedOn: ["fact-1"] });
  assert.equal(enriched.enrichment.authoritative, false);
  assert.equal(enriched.decisions.length, first.decisions.length);
});

test("uncited checkpoint items fail closed", () => {
  const invalid = structuredClone(workingMap);
  invalid.sections.goal = [{ text: "uncited", evidence_ids: [] }];
  assert.throws(() => buildDeterministicTopicCheckpoint({ topic, membership, workingMap: invalid }), /topic_checkpoint_uncited_item/);
});
