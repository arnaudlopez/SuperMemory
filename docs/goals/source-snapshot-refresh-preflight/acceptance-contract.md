# Acceptance Contract

## Goal

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

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

Source snapshot refresh is complete when local tests prove unchanged, changed, unavailable, and do_not_use refresh behavior, and node scripts/verify-source-change-t0-t1.mjs, node --test tests/hindsight-promote.test.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

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
