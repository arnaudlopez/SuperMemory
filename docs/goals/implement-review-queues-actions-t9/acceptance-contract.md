# Acceptance Contract

## Goal

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

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

A T9 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves review queues plus action confirmation while T0-T8 remain green.

## Visible Outcome

T001/T002 must replace this placeholder with the observable user-facing behavior, generated artifact, audit answer, or verification result that should exist at the end.

## Acceptance Tests To Write First

- Given the clarified spec, when the owner exercises the main path, then the visible outcome matches the requested behavior.
- Given an important edge case from the spec, when the code handles it, then the result is deterministic and documented.
- Given a likely failure mode, when the implementation is incomplete, then a targeted test fails before production code is changed.

## Failure Modes To Prevent

- Implementation starts before the acceptance/evidence contract is specific enough.
- Tests pass but do not prove the owner-visible outcome.
- The work drifts outside the LLM-first intent, non-goals, or approved boundaries.
- Operational risks such as migrations, env/secrets, auth, external services, or shipping proof are discovered but not handled.

## Manual Or Visual Proof If Needed

If code tests cannot fully prove the outcome, T001/T002 must define the manual, artifact, source-backed, or browser proof required before final audit.

## Out Of Scope

T001/T002 must keep or revise this list:

- Do not implement behavior outside the approved acceptance contract.
- Do not change unrelated dirty files.
- Do not skip the red test stage because implementation seems obvious.

## Shipping Proof

- T998 must record commit SHA, remote branch or push string, push result, committed files, and unrelated dirty files left untouched.

## End-State Evidence To Produce

- Product behavior or artifact visible to the owner.
- Acceptance tests that fail before implementation and pass after implementation.
- Verification commands with results.
- Design review mapped back to the original request.
- Commit and push proof, or an explicit shipping blocker such as `no_git_repository` or `no_github_remote`.

## Acceptance Or Evidence Draft

T001 must replace this draft with concrete tests after reading the target repository.

- Given the clarified spec, when the owner exercises the main path, then the visible outcome matches the requested behavior.
- Given an important edge case from the spec, when the code handles it, then the result is deterministic and documented.
- Given a likely failure mode, when the implementation is incomplete, then a targeted test fails before production code is changed.

## Visual Or Demo Oracle

If the goal has UI, T001/T002 must decide whether browser or screenshot evidence is required before Worker work starts.

## Non-Goals

T001/T002 must keep or revise this list:

- Do not implement behavior outside the approved acceptance contract.
- Do not change unrelated dirty files.
- Do not skip the red test stage because implementation seems obvious.
