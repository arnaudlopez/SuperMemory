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
