# T9 Review Queues And External Actions

## Intent

Implement Tranche 9: prove that critical ambiguity, stale sources, conflicts, type proposals, permission uncertainty, and external-send actions become explicit review or confirmation queue items instead of silent agent decisions.

- Do not call real email, calendar, connector, API, MCP, or cloud services.
- Do not implement a runtime queue UI.
- Do not add database migrations.
- Do not weaken T0-T8 verifiers.
- Do not execute external actions; only prove confirmation gating.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

A T9 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves review queues plus action confirmation while T0-T8 remain green.

## Suggested Mode

implementation

## Acceptance Hints

- T9.1: stale source changes open a staleness queue item with owner, blocker, source/snapshot evidence, and required decision.
- T9.2: unresolved source conflicts open a conflict queue item with conflicting memory/source references and no silent winner.
- T9.3: a new business type request opens a type queue item instead of creating a stable type directly.
- T9.4: restricted-field access uncertainty opens a permission queue item instead of implicit allow/deny.
- T9.5: an email send or similar external action creates an action confirmation item and is not marked executed.
- Existing SuperMemory global specs remain green.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- Keep the work deterministic and fixture-based.
- Use simulated source/action fixtures only.
- Follow TDD: first wire a failing verifier/global spec, then implement the fixture/verifier/test.
- Ship with GoalBuddy final audit and push proof.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/implement-review-queues-actions-t9/brief.md --mode implementation --oracle "A T9 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves review queues plus action confirmation while T0-T8 remain green." --out docs/goals/t9-review-queues-and-external-actions
```

## Source Notes

Compiled from: /tmp/supermemory-t9-notes.md

> # SuperMemory T9 Review Queues And External Actions
> 
> ## Intent
> 
> Implement Tranche 9: prove that critical ambiguity, stale sources, conflicts, type proposals, permission uncertainty, and external-send actions become explicit review or confirmation queue items instead of silent agent decisions.
> 
> ## Non-Goals
> 
> - Do not call real email, calendar, connector, API, MCP, or cloud services.
> - Do not implement a runtime queue UI.
> - Do not add database migrations.
> - Do not weaken T0-T8 verifiers.
> - Do not execute external actions; only prove confirmation gating.
> 
> ## Proposed Oracle
> 
> A T9 verifier is wired into `node scripts/verify-supermemory-specs.mjs` and proves review queues plus action confirmation while T0-T8 remain green.
> 
> ## Acceptance
> 
> - T9.1: stale source changes open a staleness queue item with owner, blocker, source/snapshot evidence, and required decision.
> - T9.2: unresolved source conflicts open a conflict queue item with conflicting memory/source references and no silent winner.
> - T9.3: a new business type request opens a type queue item instead of creating a stable type directly.
> - T9.4: restricted-field access uncertainty opens a permission queue item instead of implicit allow/deny.
> - T9.5: an email send or similar external action creates an action confirmation item and is not marked executed.
> - Existing SuperMemory global specs remain green.
> 
> ## Constraints
> 
> - Keep the work deterministic and fixture-based.
> - Use simulated source/action fixtures only.
> - Follow TDD: first wire a failing verifier/global spec, then implement the fixture/verifier/test.
> - Ship with GoalBuddy final audit and push proof.
