import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createMemorySaliencePolicy, decayRecallPriority } from "../scripts/lib/memory-salience-policy.mjs";

const corpus = JSON.parse(fs.readFileSync(new URL("./fixtures/longitudinal-memory/corpus.v1.json", import.meta.url), "utf8"));

function evidence(item) {
  return {
    verified: true,
    episode_ids: Array.from({ length: item.episodes }, (_, index) => `episode_${item.id}_${index}`),
    session_ids: Array.from({ length: item.sessions }, (_, index) => `session_${item.id}_${index}`),
    evidence_ids: Array.from({ length: item.episodes }, (_, index) => `evidence_${item.id}_${index}`)
  };
}

test("salience-v1 reproduces the authority and convergence corpus", () => {
  const policy = createMemorySaliencePolicy();
  for (const item of corpus.cases) {
    const result = policy.evaluate({
      authorityRole: item.authority_role,
      memoryClass: item.id.includes("preference") ? "preference" : item.id.includes("receipt") ? "action" : "decision",
      text: item.text,
      evidence: evidence(item),
      features: item.id === "mundane_chat"
        ? { user_commitment: 0, consequentiality: 0, future_utility: 0, recurrence: 0, stability: 0, reuse: 0, recency: 1 }
        : { user_commitment: 1, consequentiality: 0.9, future_utility: 0.9, recurrence: item.episodes >= 3 ? 1 : 0.2, stability: 0.9, reuse: 0, recency: 1 }
    });
    assert.equal(result.decision, item.expected, item.id);
    assert.equal(result.policy_version, "salience-v1");
    assert.ok(result.score >= 0 && result.score <= 1);
  }
});

test("repetition changes salience but never substitutes factual verification", () => {
  const result = createMemorySaliencePolicy().evaluate({
    authorityRole: "derived_pattern",
    memoryClass: "relationship",
    text: "Un fait externe répété.",
    evidence: { ...evidence({ id: "repeat", episodes: 8, sessions: 4 }), verified: false },
    features: { user_commitment: 0, consequentiality: 1, future_utility: 1, recurrence: 1, stability: 1, reuse: 1, recency: 1 }
  });
  assert.equal(result.decision, "archive_only");
  assert.equal(result.recall_allowed, false);
});

test("class-aware decay never deletes and does not decay stable or pinned memory", () => {
  const asOf = "2026-08-10T00:00:00.000Z";
  const old = "2026-01-01T00:00:00.000Z";
  const stable = decayRecallPriority({ memoryClass: "identity", salienceScore: 0.9, lastReinforcedAt: old, asOf, pinned: false });
  const action = decayRecallPriority({ memoryClass: "action", salienceScore: 0.9, lastReinforcedAt: old, asOf, pinned: false });
  const pinned = decayRecallPriority({ memoryClass: "action", salienceScore: 0.9, lastReinforcedAt: old, asOf, pinned: true });
  assert.equal(stable.recall_priority, 0.9);
  assert.ok(action.recall_priority < 0.2);
  assert.equal(action.deleted, false);
  assert.equal(pinned.recall_priority, 1);
});
