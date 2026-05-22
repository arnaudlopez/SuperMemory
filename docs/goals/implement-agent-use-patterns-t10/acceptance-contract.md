# Acceptance Contract

## Goal

# T10 Agent Use Patterns

## Intent

Implement Tranche 10 from the SuperMemory Golden Case roadmap and TDD matrix.

Goal: prove that enterprise agent requests map to a small set of reusable use patterns instead of bespoke one-off workflows.

Required patterns:

- external_draft
- internal_draft
- decision_support
- strategic_analysis
- audit_and_proof
- external_system_update

- No runtime agent orchestration.
- No MCP/API implementation.
- No UI work.
- No queue infrastructure beyond fixture/proof references.
- No new Hindsight adapter behavior.
- No DB/schema migration.
- No real email, calendar, CRM, or external-system action.
- No exhaustive workflow catalog.

Acceptance evidence:

- A new fixture under identity-vault/90_evals/cases/agent-use-patterns contains valid assignments for all six patterns.
- The fixture contains invalid cases proving missing/unknown/bespoke patterns are rejected.
- The verifier checks reusable pattern names, required evidence refs, required filters, review/confirmation gates, and source/snapshot citations.
- A Node test runs the verifier.
- scripts/verify-supermemory-specs.mjs includes the verifier so T0-T10 are checked together.
- Documentation is aligned only after the verifier is green.
- Final shipping proof includes commit SHA, pushed branch, and final GoalBuddy check.

Target command:

node scripts/verify-agent-use-patterns.mjs

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

A T10 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves all six use patterns while T0-T9 remain green.

## Suggested Mode

implementation

## Acceptance Hints

- T10.1 launch-readiness email request maps to external_draft with email-safe filters.
- T10.2 stale PRD refresh maps to internal_draft and requires review.
- T10.3 API field risk/trust question maps to decision_support and cites snapshots.
- T10.4 marketing strategy request maps to strategic_analysis and cites experimental type status.
- T10.5 "what changed?" audit maps to audit_and_proof and includes relation chain plus snapshots.
- T10.6 email send maps to external_system_update and requires confirmation.
- Constraints:
- Do not implement runtime agents.
- Do not create bespoke workflows per enterprise case.
- Do not execute external sends or mutate external systems.
- Keep Hindsight and existing T0-T9 contracts green.
- Prefer deterministic local fixture/verifier/test proof.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/implement-agent-use-patterns-t10/brief.md --mode implementation --oracle "A T10 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves all six use patterns while T0-T9 remain green." --out docs/goals/t10-agent-use-patterns
```

## Source Notes

Compiled from: /tmp/supermemory-t10-notes.md

> # T10 - Agent Use Patterns
> 
> ## Intent
> 
> Implement Tranche 10 from the SuperMemory Golden Case roadmap and TDD matrix.
> 
> Goal: prove that enterprise agent requests map to a small set of reusable use patterns instead of bespoke one-off workflows.
> 
> Required patterns:
> 
> - external_draft
> - internal_draft
> - decision_support
> - strategic_analysis
> - audit_and_proof
> - external_system_update
> 
> ## Acceptance
> 
> - T10.1 launch-readiness email request maps to external_draft with email-safe filters.
> - T10.2 stale PRD refresh maps to internal_draft and requires review.
> - T10.3 API field risk/trust question maps to decision_support and cites snapshots.
> - T10.4 marketing strategy request maps to strategic_analysis and cites experimental type status.
> - T10.5 "what changed?" audit maps to audit_and_proof and includes relation chain plus snapshots.
> - T10.6 email send maps to external_system_update and requires confirmation.
> 
> Constraints:
> 
> - Do not implement runtime agents.
> - Do not create bespoke workflows per enterprise case.
> - Do not execute external sends or mutate external systems.
> - Keep Hindsight and existing T0-T9 contracts green.
> - Prefer deterministic local fixture/verifier/test proof.
> 
> ## Non-Goals
> 
> - No runtime agent orchestration.
> - No MCP/API implementation.
> - No UI work.
> - No queue infrastructure beyond fixture/proof references.
> - No new Hindsight adapter behavior.
> - No DB/schema migration.
> - No real email, calendar, CRM, or external-system action.
> - No exhaustive workflow catalog.
> 
> Acceptance evidence:
> 
> - A new fixture under identity-vault/90_evals/cases/agent-use-patterns contains valid assignments for all six patterns.
> - The fixture contains invalid cases proving missing/unknown/bespoke patterns are rejected.
> - The verifier checks reusable pattern names, required evidence refs, required filters, review/confirmation gates, and source/snapshot citations.
> - A Node test runs the verifier.
> - scripts/verify-supermemory-specs.mjs includes the verifier so T0-T10 are checked together.
> - Documentation is aligned only after the verifier is green.
> - Final shipping proof includes commit SHA, pushed branch, and final GoalBuddy check.
> 
> Target command:
> 
> node scripts/verify-agent-use-patterns.mjs
> 
> ## Oracle
> 
> A T10 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves all six use patterns while T0-T9 remain green.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

A T10 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves all six use patterns while T0-T9 remain green.

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
