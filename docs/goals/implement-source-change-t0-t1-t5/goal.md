# T5 Source Change t0/t1

## Objective

Implement Tranche 5: prove that a mutable source change creates a new immutable snapshot, preserves the old snapshot, marks derived memory as `needs_review` before confident recall, and re-promotes the reviewed version with the same stable `document_id`.

## Original Request

"ok va y"

## Intake Summary

- Input shape: `specific`
- Audience: SuperMemory maintainers and future memory agents
- Authority: `requested`
- Proof type: `test`
- Completion proof: A T5 fixture/verifier proves mutable source t0/t1 handling, global specs pass, GoalBuddy final checks pass, and the work is committed and pushed.
- Goal oracle: `node scripts/verify-supermemory-specs.mjs` passes after adding `node scripts/verify-source-change-t0-t1.mjs`, while T0/T1/T2/T3/T4 remain green.
- Likely misfire: Jumping to a real Hindsight promotion script before proving source-change freshness and review semantics.
- Blind spots considered: `unavailable` must not be treated as fresh; re-promotion should keep `document_id`; old snapshots must remain auditable.
- Existing plan facts: `docs/golden-case-tdd-matrix.md` defines T5.1-T5.6; `identity-vault/75_governance/source_freshness.md` defines mutable source change handling.

## Goal Oracle

The oracle for this goal is:

`node scripts/verify-supermemory-specs.mjs` passes with a T5 verifier proving snapshot t0/t1 lineage, needs_review propagation, reviewed recompilation, stable re-promotion, and unavailable-source handling.

## Goal Kind

`specific`

## Current Tranche

Build an executable local contract for mutable source freshness. This is not a connector implementation. It is the deterministic acceptance boundary a connector or promotion script must preserve later.

## Non-Negotiable Constraints

- Do not weaken T0/T1/T2/T3/T4.
- Do not overwrite snapshots.
- Do not let changed or unavailable sources prove freshness.
- Do not re-promote changed memory as active until review is explicit.
- Keep stable `document_id` across reviewed re-promotion.

## Canonical Board

Machine truth lives at:

`docs/goals/implement-source-change-t0-t1-t5/state.yaml`

## Run Command

```text
/goal Follow docs/goals/implement-source-change-t0-t1-t5/goal.md.
```
