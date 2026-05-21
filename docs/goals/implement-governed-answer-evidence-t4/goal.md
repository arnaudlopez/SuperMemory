# T4 Governed Answer Evidence

## Objective

Implement Tranche 4: prove that SuperMemory answers cannot become `current` just because recall returned something. A governed answer must carry auditable `AnswerEvidence`, cite snapshots, link through `supports_answer`, respect adapter traces, and degrade or refuse when memory is stale, changed, restricted, unavailable, or forbidden.

## Original Request

`/goal Follow docs/goals/implement-governed-answer-evidence-t4/goal.md.`

## Intake Summary

- Input shape: `specific`
- Audience: SuperMemory maintainers and future answer-producing agents
- Authority: `requested`
- Proof type: `test`
- Completion proof: A T4 fixture/verifier proves governed answer evidence behavior, the global SuperMemory specs pass, GoalBuddy final checks pass, and the work is committed and pushed.
- Goal oracle: `node scripts/verify-supermemory-specs.mjs` passes after adding `node scripts/verify-governed-answer-evidence.mjs`, while T0/T1/T2/T3 remain green.
- Likely misfire: Only checking that answers contain text, or relying on T3 recall traces without proving the final answer's evidence chain and degradation states.
- Blind spots considered: T1 already checks minimal `AnswerEvidence`; T3 checks adapter traces; T4 must bind final answers to memory, snapshots, adapter traces, and answer state policy.
- Existing plan facts: `docs/golden-case-tdd-matrix.md` defines T4.1-T4.6; `identity-vault/75_governance/answer_policy.md` defines answer states; T3 already has adapter trace proof.

## Goal Oracle

The oracle for this goal is:

`node scripts/verify-supermemory-specs.mjs` passes with a T4 verifier that proves current, stale, changed/needs_review, restricted, forbidden, and complete evidence-chain behavior.

The PM must keep comparing task receipts to this oracle. The goal finishes only when final audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`specific`

## Current Tranche

Build an executable local contract for governed answer evidence. This is not an LLM judge and not a runtime answer generator. It is a deterministic acceptance verifier for the hard boundaries an LLM-first answering agent must satisfy.

## Non-Negotiable Constraints

- Do not weaken T0/T1/T2/T3.
- Do not require exact natural-language answer wording when the answer state, citations, relations, and policy outcome are correct.
- Do not let `do_not_use`, changed, `needs_review`, stale, or restricted memory masquerade as an unconstrained current answer.
- Current answers require used memory, cited snapshots, adapter traces when recall-backed, and a `supports_answer` relation.
- Keep the vault and deterministic governance contracts as the source of truth.

## Canonical Board

Machine truth lives at:

`docs/goals/implement-governed-answer-evidence-t4/state.yaml`

## Run Command

```text
/goal Follow docs/goals/implement-governed-answer-evidence-t4/goal.md.
```
