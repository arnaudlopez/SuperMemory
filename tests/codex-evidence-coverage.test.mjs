import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEvidenceCoverage, repairDirective } from "../scripts/lib/codex-evidence-coverage.mjs";
import { createRetrievalPlan } from "../scripts/lib/codex-retrieval-plan.mjs";

test("TR-AC04/07: aggregation is exact only with complete interval and exhausted pagination", () => {
  const plan = createRetrievalPlan({ query: "Combien de fois ai-je couru le mois dernier ?", observedAt: "2026-08-08T10:00:00Z" });
  const partial = evaluateEvidenceCoverage({
    plan,
    sources: { events: { status: "complete", pagination_complete: false, temporal_window: "partial" }, topic_turns: { status: "complete", pagination_complete: true } },
    results: [{ event_id: "evt-1" }]
  });
  assert.equal(partial.coverage.aggregation, "bounded");
  assert.equal(partial.repair_required, true);
  assert.deepEqual(repairDirective(partial).modes, ["exhaust_interval"]);
  const exact = evaluateEvidenceCoverage({
    plan,
    sources: { events: { status: "complete", pagination_complete: true, temporal_window: "complete" }, topic_turns: { status: "complete", pagination_complete: true } },
    results: [{ event_id: "evt-1" }]
  });
  assert.equal(exact.coverage.aggregation, "exact");
  assert.equal(exact.complete, true);
});

test("TR-AC05/06: state-chain gaps repair twice then require abstention", () => {
  const plan = createRetrievalPlan({ query: "Où est-ce que je travaille actuellement ?", observedAt: "2026-08-08T10:00:00Z" });
  const first = evaluateEvidenceCoverage({ plan, round: 1, sources: { events: { state_chain: "partial" } }, results: [] });
  assert.equal(first.repair_required, true);
  assert.deepEqual(repairDirective(first).modes, ["load_state_chain"]);
  const last = evaluateEvidenceCoverage({ plan, round: 3, sources: { events: { state_chain: "partial" } }, results: [] });
  assert.equal(last.repair_required, false);
  assert.equal(last.abstention_required, true);
});
