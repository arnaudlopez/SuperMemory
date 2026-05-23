# Source Refresh Connector Boundary Notes

## Original Request

# Source Refresh Connector Boundary Notes

## Intent

Implement the next SuperMemory tranche after source snapshot refresh preflight: a local, deterministic connector boundary contract for source refresh.

The system should prove what a connector-backed refresh report must contain before any real connector is allowed to feed snapshot refresh. This is still not a real web, Gmail, Drive, CRM, or API connector.

A maintainer can run a local verifier proving that connector-backed refresh input is scoped, authorized, explicit, and safe before it can become source refresh candidates.

- Do not implement real external connectors.
- Do not fetch remote sources.
- Do not scan the whole vault automatically.
- Do not run live Hindsight writes.
- Do not add dependencies, env files, migrations, jobs, or UI.
- Do not weaken existing source refresh, source-change, Hindsight promotion, or global specs.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

Source refresh connector boundary is complete when node scripts/verify-source-refresh-connector-boundary.mjs, node --test tests/source-refresh-connector-boundary.test.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

## Suggested Mode

implementation

## Acceptance Hints

- Connector refresh reports require `connector_id`, `connector_type`, `connector_scope`, `workspace_id`, and `access_policy`.
- Connector scope must be selected-source or explicitly bounded; broad/all-vault scans fail closed.
- Every refresh candidate must point to a registered mutable source.
- Connector candidates must carry either a content hash, connector version, or unavailable result.
- `do_not_use` sources cannot produce active refresh candidates.
- The connector boundary feeds the existing source snapshot refresh preflight shape without doing network work.
- Existing source refresh, source-change, Hindsight promotion, and global specs remain green.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/source-refresh-connector-boundary/brief.md --mode implementation --oracle "Source refresh connector boundary is complete when node scripts/verify-source-refresh-connector-boundary.mjs, node --test tests/source-refresh-connector-boundary.test.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass." --out docs/goals/source-refresh-connector-boundary-notes
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/source-refresh-connector-boundary-notes.md

> # Source Refresh Connector Boundary Notes
> 
> ## Intent
> 
> Implement the next SuperMemory tranche after source snapshot refresh preflight: a local, deterministic connector boundary contract for source refresh.
> 
> The system should prove what a connector-backed refresh report must contain before any real connector is allowed to feed snapshot refresh. This is still not a real web, Gmail, Drive, CRM, or API connector.
> 
> ## User Outcome
> 
> A maintainer can run a local verifier proving that connector-backed refresh input is scoped, authorized, explicit, and safe before it can become source refresh candidates.
> 
> ## Non-Goals
> 
> - Do not implement real external connectors.
> - Do not fetch remote sources.
> - Do not scan the whole vault automatically.
> - Do not run live Hindsight writes.
> - Do not add dependencies, env files, migrations, jobs, or UI.
> - Do not weaken existing source refresh, source-change, Hindsight promotion, or global specs.
> 
> ## Acceptance
> 
> - Connector refresh reports require `connector_id`, `connector_type`, `connector_scope`, `workspace_id`, and `access_policy`.
> - Connector scope must be selected-source or explicitly bounded; broad/all-vault scans fail closed.
> - Every refresh candidate must point to a registered mutable source.
> - Connector candidates must carry either a content hash, connector version, or unavailable result.
> - `do_not_use` sources cannot produce active refresh candidates.
> - The connector boundary feeds the existing source snapshot refresh preflight shape without doing network work.
> - Existing source refresh, source-change, Hindsight promotion, and global specs remain green.
> 
> ## Oracle
> 
> Source refresh connector boundary is complete when `node scripts/verify-source-refresh-connector-boundary.mjs`, `node --test tests/source-refresh-connector-boundary.test.mjs`, `node scripts/verify-source-snapshot-refresh-preflight.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass.

## Ready Mode Instruction

Use this goal as a implementation Ready Mode run.

LLM first principle: the free-form conversation already did the exploration work. This board starts only after the owner says the spec is mature enough to freeze into proof.

1. Clarify the design concept and domain language before implementation.
2. Turn the desired end state into observable acceptance tests or equivalent proof.
3. Follow the board policy for red tests before production code.
4. Complete the largest safe useful slice inside approved boundaries.
5. Verify, review, commit, push, and finish only when the oracle is true.

## Oracle

Source refresh connector boundary is complete when node scripts/verify-source-refresh-connector-boundary.mjs, node --test tests/source-refresh-connector-boundary.test.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

## Files

- `state.yaml`: GoalBuddy board state.
- `acceptance-contract.md`: initial owner-facing acceptance contract to refine during T001/T002.
