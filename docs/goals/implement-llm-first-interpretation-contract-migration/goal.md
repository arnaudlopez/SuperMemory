# Implement LLM-First Interpretation Contract Migration

## Objective

Implement the LLM-first migration plan so SuperMemory consistently models adaptive interpretation through `InterpretationCandidate` while preserving deterministic governance gates, existing T1/M1 work, and the governed Markdown vault.

## Original Request

`goal-prep OK, maintenant passe à l'implémentation du plan prends ton temps`

## Intake Summary

- Input shape: `existing_plan`
- Audience: SuperMemory implementers and Arnaud
- Authority: `approved`
- Proof type: `test`
- Completion proof: Enterprise target, T1 contracts, M1 fixture, global specs, and diff check pass; docs/roadmap are aligned with the LLM-first interpretation contract; final audit maps all work to the migration plan.
- Goal oracle: `node scripts/verify-supermemory-specs.mjs` passes after the migration, with T1 owning generic interpretation invariants and M1 remaining the first executable LLM-first vertical slice.
- Likely misfire: Only making the current global spec failure green, or only editing docs, without generalizing interpretation invariants into T1 and preserving M1 as a governed executable slice.
- Blind spots considered: There are existing uncommitted interpretation changes that are in-scope and must be preserved; deterministic gates remain required; exact wording should only be relaxed after hard property checks exist.
- Existing plan facts: `docs/llm-first-migration-plan.md` defines the migration order and no-touch list.

## Goal Oracle

The oracle for this goal is:

```bash
node scripts/verify-enterprise-living-memory-target.mjs
node scripts/verify-memory-contracts.mjs
node scripts/verify-m1-hindsight-promotion-recall-fixture.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

The PM must keep comparing task receipts to this oracle. Planning, partial green checks, or a single repaired assertion is not enough.

## Goal Kind

`existing_plan`

## Current Tranche

Implement the plan in a bounded sequence:

1. Restore global specs by aligning the enterprise target with `InterpretationCandidate`.
2. Generalize T1 with interpretation invariants.
3. Harden M1 as the first LLM-first executable slice.
4. Align roadmap and documentation so future work does not reintroduce the old deterministic chain.
5. Verify, commit, push, and final-audit the migration.

## Non-Negotiable Constraints

- Preserve the governed Markdown/Obsidian vault as source of truth.
- Preserve existing T1/M1 work as migration inputs, not disposable prototypes.
- Keep deterministic exact-error checks for hard governance failures.
- Do not weaken `do_not_use`, provenance, freshness, access, action confirmation, or answer evidence guarantees.
- Do not add Hindsight runtime integration, Graphiti, Memoria, connectors, services, databases, or UI.
- Treat current uncommitted interpretation work as in-scope user work to preserve.
- Do not edit raw inbox sources, compiled professional/personal/private notes, or existing logs unless a task explicitly allows it.

## Stop Rule

Stop only when final audit proves the full implementation outcome complete against the oracle and the work has shipping proof or an explicit shipping blocker.

## Canonical Board

Machine truth lives at:

`docs/goals/implement-llm-first-interpretation-contract-migration/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/implement-llm-first-interpretation-contract-migration/goal.md.
```

