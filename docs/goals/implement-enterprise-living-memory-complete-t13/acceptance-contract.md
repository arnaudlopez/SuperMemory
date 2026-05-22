# Acceptance Contract

## Goal

# T13 Enterprise Living Memory Complete

## Intent

- Implement the full executable Orion enterprise Golden Case for SuperMemory.
- Promote `enterprise-living-memory-complete` from a spec-only target to an executable fixture/verifier contract.
- Keep the implementation local, deterministic, file-backed, and TDD-driven.

- `node scripts/verify-enterprise-living-memory-complete.mjs` passes.
- `node scripts/verify-supermemory-specs.mjs` includes and passes the complete verifier.
- The complete fixture proves every mandatory Golden Case question with source-backed answers and relation chains.

- No runtime database, hosted service, live connector, real Hindsight call, UI, or external API integration.
- No weakening T0-T12 verifiers.
- No claiming production implementation beyond deterministic local fixture/verifier proof.
- No hiding missing full-case dimensions behind `pending` once this T13 goal completes.
- No new CI workflow; CI hardening remains T14.
- No migration/backfill/production data mutation.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

A complete T13 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves enterprise-living-memory-complete as executable while all T0-T12 checks remain green.

## Suggested Mode

implementation

## Acceptance Hints

- Red test first: global specs must fail because `scripts/verify-enterprise-living-memory-complete.mjs` is missing or incomplete after it is wired into `scripts/verify-supermemory-specs.mjs`.
- Green test: `node scripts/verify-enterprise-living-memory-complete.mjs` passes.
- Green integration: `node scripts/verify-supermemory-specs.mjs` passes with T0-T13.
- Node test: `node --test tests/enterprise-living-memory-complete.test.mjs` passes and includes invalid-fixture regression checks.
- Static proof: `git diff --check` passes.
- Shipping proof: committed SHA, pushed `origin/main`, final GoalBuddy quality check pass.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/implement-enterprise-living-memory-complete-t13/brief.md --mode implementation --oracle "A complete T13 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves enterprise-living-memory-complete as executable while all T0-T12 checks remain green." --out docs/goals/t13-enterprise-living-memory-complete
```

## Source Notes

Compiled from: /tmp/supermemory-t13-notes.md

> # T13 Enterprise Living Memory Complete
> 
> ## Intent
> - Implement the full executable Orion enterprise Golden Case for SuperMemory.
> - Promote `enterprise-living-memory-complete` from a spec-only target to an executable fixture/verifier contract.
> - Keep the implementation local, deterministic, file-backed, and TDD-driven.
> 
> ## Visible Outcome
> - `node scripts/verify-enterprise-living-memory-complete.mjs` passes.
> - `node scripts/verify-supermemory-specs.mjs` includes and passes the complete verifier.
> - The complete fixture proves every mandatory Golden Case question with source-backed answers and relation chains.
> 
> ## Scope
> - Cover T13.1-T13.7 from the TDD matrix.
> - Validate all mandatory questions from the roadmap.
> - Require answer evidence for current API field, retention snapshot, PRD currency, pricing exclusion, marketing strategy, contract access restrictions, secret refusal, connector unavailable fallback, support-vs-API precedence, workspace/access policy, legal hold, engine port decisions, t0/t1 changes, Hindsight document_id, email confirmation, use pattern, and relation-chain recency.
> - Require agent-scope behavior for email, marketing, product, memory, legal/compliance/security as represented by local fixtures.
> - Require queues for staleness, conflict, type creation, permission, connector unavailable, action confirmation, and secret incident or equivalent explicit governance states.
> - Require Graphiti/Memoria/other engine-port decisions to remain justified and not activated unless the fixture proves need.
> - Preserve flexibility: use patterns and adaptive business types must be validated as generic governance, not bespoke Orion-only workflows.
> 
> ## Non-Goals
> - No runtime database, hosted service, live connector, real Hindsight call, UI, or external API integration.
> - No weakening T0-T12 verifiers.
> - No claiming production implementation beyond deterministic local fixture/verifier proof.
> - No hiding missing full-case dimensions behind `pending` once this T13 goal completes.
> - No new CI workflow; CI hardening remains T14.
> - No migration/backfill/production data mutation.
> 
> ## Acceptance
> - Red test first: global specs must fail because `scripts/verify-enterprise-living-memory-complete.mjs` is missing or incomplete after it is wired into `scripts/verify-supermemory-specs.mjs`.
> - Green test: `node scripts/verify-enterprise-living-memory-complete.mjs` passes.
> - Green integration: `node scripts/verify-supermemory-specs.mjs` passes with T0-T13.
> - Node test: `node --test tests/enterprise-living-memory-complete.test.mjs` passes and includes invalid-fixture regression checks.
> - Static proof: `git diff --check` passes.
> - Shipping proof: committed SHA, pushed `origin/main`, final GoalBuddy quality check pass.
> 
> ## Oracle
> - A complete T13 verifier is wired into `scripts/verify-supermemory-specs.mjs` and proves `enterprise-living-memory-complete` as executable, while all T0-T12 checks remain green.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

A complete T13 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves enterprise-living-memory-complete as executable while all T0-T12 checks remain green.

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
