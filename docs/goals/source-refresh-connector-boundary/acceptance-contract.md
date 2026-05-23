# Acceptance Contract

## Goal

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

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

Source refresh connector boundary is complete when node scripts/verify-source-refresh-connector-boundary.mjs, node --test tests/source-refresh-connector-boundary.test.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

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
