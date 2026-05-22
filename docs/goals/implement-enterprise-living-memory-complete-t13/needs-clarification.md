# T13 Enterprise Living Memory Complete Needs Clarification

This LLM-first input is not ready for Ready Mode yet.

## Missing Inputs

- non_goals
- acceptance_evidence

## Questions To Resolve

- What should explicitly stay out of scope?
- Which user paths, edge cases, or checks should become first tests/evidence?

## Current Mode Hint

implementation

## Current Oracle Hint

A complete T13 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves enterprise-living-memory-complete as executable while all T0-T12 checks remain green.

## Next Step

Answer the questions above in the LLM conversation, then rerun:

```bash
llm-first-devloop interview --from notes.md --out brief.md
```

## Source Notes

> # T13 Enterprise Living Memory Complete
> 
> Intent:
> - Implement the full executable Orion enterprise Golden Case for SuperMemory.
> - Promote `enterprise-living-memory-complete` from a spec-only target to an executable fixture/verifier contract.
> - Keep the implementation local, deterministic, file-backed, and TDD-driven.
> 
> Visible outcome:
> - `node scripts/verify-enterprise-living-memory-complete.mjs` passes.
> - `node scripts/verify-supermemory-specs.mjs` includes and passes the complete verifier.
> - The complete fixture proves every mandatory Golden Case question with source-backed answers and relation chains.
> 
> Scope:
> - Cover T13.1-T13.7 from the TDD matrix.
> - Validate all mandatory questions from the roadmap.
> - Require answer evidence for current API field, retention snapshot, PRD currency, pricing exclusion, marketing strategy, contract access restrictions, secret refusal, connector unavailable fallback, support-vs-API precedence, workspace/access policy, legal hold, engine port decisions, t0/t1 changes, Hindsight document_id, email confirmation, use pattern, and relation-chain recency.
> - Require agent-scope behavior for email, marketing, product, memory, legal/compliance/security as represented by local fixtures.
> - Require queues for staleness, conflict, type creation, permission, connector unavailable, action confirmation, and secret incident or equivalent explicit governance states.
> - Require Graphiti/Memoria/other engine-port decisions to remain justified and not activated unless the fixture proves need.
> - Preserve flexibility: use patterns and adaptive business types must be validated as generic governance, not bespoke Orion-only workflows.
> 
> Out of scope:
> - No runtime database, hosted service, live connector, real Hindsight call, UI, or external API integration.
> - No weakening T0-T12 verifiers.
> - No claiming production implementation beyond deterministic local fixture/verifier proof.
> - No hiding missing full-case dimensions behind `pending` once this T13 goal completes.
> - No new CI workflow; CI hardening remains T14.
> - No migration/backfill/production data mutation.
> 
> Acceptance evidence:
> - Red test first: global specs must fail because `scripts/verify-enterprise-living-memory-complete.mjs` is missing or incomplete after it is wired into `scripts/verify-supermemory-specs.mjs`.
> - Green test: `node scripts/verify-enterprise-living-memory-complete.mjs` passes.
> - Green integration: `node scripts/verify-supermemory-specs.mjs` passes with T0-T13.
> - Node test: `node --test tests/enterprise-living-memory-complete.test.mjs` passes and includes invalid-fixture regression checks.
> - Static proof: `git diff --check` passes.
> - Shipping proof: committed SHA, pushed `origin/main`, final GoalBuddy quality check pass.
> 
> Oracle:
> - A complete T13 verifier is wired into `scripts/verify-supermemory-specs.mjs` and proves `enterprise-living-memory-complete` as executable, while all T0-T12 checks remain green.
