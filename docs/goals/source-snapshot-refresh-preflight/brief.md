# Source Snapshot Refresh Preflight Notes

## Intent

Implement the next SuperMemory runtime-preflight tranche after Hindsight promotion/live-smoke readiness: a local, deterministic source snapshot refresh preflight for mutable sources.

The goal is to prove that SuperMemory can compare a previously captured mutable source with a refreshed capture candidate, decide whether a new immutable snapshot is needed, and route downstream memory safely without adding real connectors yet.

A maintainer can run a local command against fixture data and see a refresh plan that distinguishes unchanged, changed, unavailable, and forbidden sources without mutating production data or calling external services.

- Do not implement real web, Drive, Gmail, CRM, or API connectors.
- Do not run live Hindsight writes.
- Do not scan the whole vault automatically.
- Do not add dependencies, env files, migrations, jobs, or UI.
- Do not weaken existing T0-T14, Hindsight promotion, live-smoke, or source-change contracts.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

Source snapshot refresh is complete when local tests prove unchanged, changed, unavailable, and do_not_use refresh behavior, and node scripts/verify-source-change-t0-t1.mjs, node --test tests/hindsight-promote.test.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

## Suggested Mode

implementation

## Acceptance Hints

- A deterministic fixture represents mutable source refresh candidates.
- A local verifier or test proves unchanged sources do not create new snapshots.
- Changed sources produce a new immutable snapshot plan with `previous_snapshot_id`.
- Changed derived memory is routed to `needs_review` before active promotion.
- Unavailable sources are treated as unknown or last-known/unverified, never fresh.
- `do_not_use` sources are not refreshed into active memory or Hindsight promotion.
- Existing source-change, Hindsight promotion, governed-answer, and global specs remain green.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/source-snapshot-refresh-preflight/brief.md --mode implementation --oracle "Source snapshot refresh is complete when local tests prove unchanged, changed, unavailable, and do_not_use refresh behavior, and node scripts/verify-source-change-t0-t1.mjs, node --test tests/hindsight-promote.test.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass." --out docs/goals/source-snapshot-refresh-preflight-notes
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/source-snapshot-refresh-preflight-notes.md

> # Source Snapshot Refresh Preflight Notes
> 
> ## Intent
> 
> Implement the next SuperMemory runtime-preflight tranche after Hindsight promotion/live-smoke readiness: a local, deterministic source snapshot refresh preflight for mutable sources.
> 
> The goal is to prove that SuperMemory can compare a previously captured mutable source with a refreshed capture candidate, decide whether a new immutable snapshot is needed, and route downstream memory safely without adding real connectors yet.
> 
> ## User Outcome
> 
> A maintainer can run a local command against fixture data and see a refresh plan that distinguishes unchanged, changed, unavailable, and forbidden sources without mutating production data or calling external services.
> 
> ## Non-Goals
> 
> - Do not implement real web, Drive, Gmail, CRM, or API connectors.
> - Do not run live Hindsight writes.
> - Do not scan the whole vault automatically.
> - Do not add dependencies, env files, migrations, jobs, or UI.
> - Do not weaken existing T0-T14, Hindsight promotion, live-smoke, or source-change contracts.
> 
> ## Acceptance
> 
> - A deterministic fixture represents mutable source refresh candidates.
> - A local verifier or test proves unchanged sources do not create new snapshots.
> - Changed sources produce a new immutable snapshot plan with `previous_snapshot_id`.
> - Changed derived memory is routed to `needs_review` before active promotion.
> - Unavailable sources are treated as unknown or last-known/unverified, never fresh.
> - `do_not_use` sources are not refreshed into active memory or Hindsight promotion.
> - Existing source-change, Hindsight promotion, governed-answer, and global specs remain green.
> 
> ## Oracle
> 
> Source snapshot refresh is complete when local tests prove unchanged, changed, unavailable, and `do_not_use` refresh behavior, and `node scripts/verify-source-change-t0-t1.mjs`, `node --test tests/hindsight-promote.test.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass.
