import assert from "node:assert/strict";
import test from "node:test";
import { createRetrievalPlan, validateRetrievalPlan } from "../scripts/lib/codex-retrieval-plan.mjs";

test("TR-AC03: simple recall remains deterministic and single-pass", () => {
  const plan = createRetrievalPlan({ query: "Quelle architecture avons-nous choisie ?", observedAt: "2026-08-08T10:00:00Z" });
  assert.equal(plan.intent, "simple_recall");
  assert.equal(plan.max_rounds, 1);
  assert.equal(plan.steps.some((step) => step.source === "events"), false);
});

test("aggregation and current-state questions receive bounded coverage requirements", () => {
  const aggregate = createRetrievalPlan({ query: "Combien de fois ai-je fait du sport le mois dernier ?", observedAt: "2026-08-08T10:00:00Z" });
  assert.equal(aggregate.intent, "aggregation");
  assert.equal(aggregate.max_rounds, 3);
  assert.equal(aggregate.time_window.start, "2026-07-01T00:00:00.000Z");
  assert.equal(aggregate.steps.find((step) => step.source === "events").exhaustive, true);
  const current = createRetrievalPlan({ query: "Où est-ce que je travaille actuellement ?", observedAt: "2026-08-08T10:00:00Z" });
  assert.equal(current.intent, "current_state");
  assert.equal(current.requirements.require_current_and_superseded, true);
});

test("retrieval plans reject unbounded rounds and unknown sources", () => {
  const plan = structuredClone(createRetrievalPlan({ query: "Pourquoi A dépend de B ?", observedAt: "2026-08-08T10:00:00Z" }));
  plan.max_rounds = 4;
  assert.throws(() => validateRetrievalPlan(plan), /retrieval_plan_rounds_invalid/);
  plan.max_rounds = 3;
  plan.steps[0].source = "remote_unknown";
  assert.throws(() => validateRetrievalPlan(plan), /retrieval_plan_steps_invalid/);
});
