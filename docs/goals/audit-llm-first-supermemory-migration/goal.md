# Audit LLM-First SuperMemory Migration

## Objective

Audit the current SuperMemory implementation and prepare a precise migration plan that makes the system more LLM-first while preserving the governed Markdown vault, existing T1/M1 work, current verification, and project memory decisions.

## Original Request

Use GoalBuddy goal-prep to prepare an audit/proposal board for improving SuperMemory so it is less over-programmatic and more LLM-first, taking into account all existing development and memory, not only M1.

## Intake Summary

- Input shape: `audit`
- Audience: SuperMemory implementers and Arnaud
- Authority: `approved`
- Proof type: `artifact`
- Completion proof: A final audit receipt maps repository evidence and project-memory decisions to a precise migration plan: files to modify later, order of migration, risks, tests to preserve or add, and no unauthorized product-code/script/fixture/test edits.
- Goal oracle: The migration plan is specific enough that a later implementation goal can execute it without rediscovering the architecture, and it explicitly accounts for T1, M1, global verification wiring, governance docs, eval fixtures, GoalBuddy boards, and recent memory-backed decisions.
- Likely misfire: Producing a philosophical LLM-first essay, or proposing a parallel architecture, without grounding the plan in the already developed SuperMemory artifacts and memory-backed decisions.
- Blind spots considered: Existing work extends beyond M1; deterministic gates are still valuable; docs edits are allowed only when they clarify the migration; scripts, fixtures, tests, and product logic are out of scope for this tranche.
- Existing plan facts: The user selected audit/proposal first, plan-of-migration proof, docs edits allowed, and a fresh GoalBuddy board.

## Goal Oracle

The oracle for this goal is:

`A repository-grounded migration plan exists, with exact files/areas, preserved invariants, proposed LLM-first contract changes, verification strategy, migration order, and explicit exclusions, and final audit says full_outcome_complete: true.`

The PM must keep comparing task receipts to this oracle. Discovery alone, a conceptual recommendation, or a clean-looking board is not enough.

## Goal Kind

`audit`

## Current Tranche

This tranche is an audit plus optional documentation-clarification tranche. It may read the repository and project memory, classify the existing implementation, and write or update documentation that records the proposed migration. It must not edit implementation scripts, fixtures, tests, runtime code, or verification logic.

## Non-Negotiable Constraints

- Preserve the governed Markdown/Obsidian identity vault as the human-readable source of truth.
- Treat the current repository and project memory as authoritative inputs; do not reason from M1 alone.
- Preserve T1 and M1 work as migration inputs, not disposable prototypes.
- Keep deterministic checks for hard governance invariants.
- Shift interpretation, ambiguity handling, and unknown-case adaptation toward LLM-first contracts.
- Do not modify scripts, fixtures, tests, compiled vault content, or runtime/product logic in this tranche.
- Documentation edits are allowed only when they clarify the audit findings or migration plan.
- Do not start `/goal`; this board is preparation only.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete: an evidence-backed migration plan exists and no unauthorized file classes were modified.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. For this goal, useful work is not a tiny note; it is a coherent evidence-backed audit that can drive a later implementation tranche.

## Canonical Board

Machine truth lives at:

`docs/goals/audit-llm-first-supermemory-migration/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/audit-llm-first-supermemory-migration/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter.
2. Read `state.yaml`.
3. Run the bundled GoalBuddy update checker when available and mention a newer version without blocking.
4. Work only on the active board task.
5. Keep the audit grounded in file evidence and project-memory decisions.
6. Write compact receipts to `state.yaml`; use `notes/` only when the evidence is too large for a task card.
7. Do not edit non-documentation product artifacts in this tranche.
8. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.
