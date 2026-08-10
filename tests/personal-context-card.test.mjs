import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalContextCard } from "../scripts/lib/personal-context-card.mjs";

test("Personal Context Card is cited, authorized and capped at 8000 tokens", () => {
  const results = Array.from({ length: 20 }, (_, index) => ({
    memory_id: `mem_${index}`,
    text: `Decision ${index} `.repeat(200),
    score: 1 - index / 100,
    scope: index % 2 ? "owner" : "project",
    citations: [{ evidence_id: `e_${index}` }],
    authority: "current"
  }));
  const card = buildPersonalContextCard({
    results,
    maxTokens: 8_000,
    tokenCounter: (value) => Math.ceil(String(value).length / 4)
  });
  assert.equal(card.schema, "supermemory.personal-context-card.v1");
  assert.ok(card.token_count <= 8_000);
  assert.ok(card.entries.length > 0);
  assert.ok(card.entries.every((entry) => entry.citations.length > 0));
  assert.doesNotMatch(card.text, /inactive|do_not_use/);
});
