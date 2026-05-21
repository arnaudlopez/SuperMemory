# T6 Conflict Unavailable Arbitration

## Objective

Implement Tranche 6: prove that SuperMemory preserves conflicting source-backed facts, avoids silent arbitration, applies explicit reliability rules only when present, treats unavailable sources as unverified, and opens review queues for unresolved conflicts.

## Original Request

"enchaine"

## Goal Oracle

`node scripts/verify-supermemory-specs.mjs` passes after adding `node scripts/verify-conflict-unavailable-arbitration.mjs`, while T0/T1/T2/T3/T4/T5 remain green.

## Current Tranche

Build an executable local contract for conflict/unavailable arbitration. This is not a real connector or LLM judge. It verifies hard conflict state, evidence, arbitration-rule, last-known, and review-queue invariants.

## Non-Negotiable Constraints

- Preserve both sides of a source conflict.
- Do not choose one answer silently without an explicit reliability rule.
- If a rule applies, cite both the winning source and the conflict.
- Unavailable means not verified, never unchanged.
- Unresolved conflicts must open a review item.

## Run Command

```text
/goal Follow docs/goals/implement-conflict-unavailable-arbitration-t6/goal.md.
```
