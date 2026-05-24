# Acceptance Contract

## Goal

# Local File Refresh Staging Gate

## Intent

Implement the next SuperMemory tranche after the local-file source refresh CLI and workflow smoke: a controlled staging/review gate for refresh plans.

The current `local-file-source-refresh.mjs` can produce and persist a dry-run plan for a registered `local_file` source. The next step is to let an operator apply a reviewed refresh plan into a staging directory, without writing directly to `identity-vault`, without compiling active memory, and without promoting to Hindsight.

A maintainer can run a local command against a saved refresh plan and get reviewable staging artifacts that contain source registry deltas, snapshot candidates, connector run/result evidence, affected memory review items, and a manifest. The command must fail closed for invalid plans, raw content leakage, malformed lineage, duplicate or unsafe destination paths, and direct vault writes.

- Do not write directly to the final vault.
- Do not compile active memory.
- Do not promote or delete anything in Hindsight.
- Do not implement remote connectors, background jobs, database migrations, UI, or env files.
- Do not scan the vault, disk, mailbox, Drive, web, or any broad source.
- Do not weaken existing local-file refresh, source refresh connector boundary, source snapshot refresh, Hindsight, or global specs.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

Local file refresh staging gate is complete when node --test tests/local-file-source-refresh-cli.test.mjs, node scripts/verify-local-file-source-refresh-workflow.mjs, node scripts/verify-source-refresh-connector-boundary.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

## Suggested Mode

implementation

## Acceptance Hints

- A saved local-file refresh plan can be applied to a new empty staging directory.
- The staging directory contains reviewable JSON artifacts for the original plan, connector runs/results, refresh candidates/plans, snapshot candidates, review items, and manifest.
- The apply step refuses plans with validation errors, missing lineage, raw-content-like fields, non-empty promotion payloads, or direct `identity-vault` destinations.
- Changed-source staging preserves `previous_snapshot_id`, `connector_result_id`, `created_snapshot_id`, and `needs_review` routing.
- Unavailable and `do_not_use` plans stage without creating fresh snapshots or active promotions.
- No raw source content, source instructions, secrets, or neighboring-file content appear in stdout, stderr, or staged artifacts.
- Existing specs remain green.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/local-file-refresh-staging-gate/brief.md --mode implementation --oracle "Local file refresh staging gate is complete when node --test tests/local-file-source-refresh-cli.test.mjs, node scripts/verify-local-file-source-refresh-workflow.mjs, node scripts/verify-source-refresh-connector-boundary.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass." --out docs/goals/local-file-refresh-staging-gate
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/local-file-refresh-staging-gate-notes.md

> # Local File Refresh Staging Gate
> 
> ## Intent
> 
> Implement the next SuperMemory tranche after the local-file source refresh CLI and workflow smoke: a controlled staging/review gate for refresh plans.
> 
> The current `local-file-source-refresh.mjs` can produce and persist a dry-run plan for a registered `local_file` source. The next step is to let an operator apply a reviewed refresh plan into a staging directory, without writing directly to `identity-vault`, without compiling active memory, and without promoting to Hindsight.
> 
> ## User Outcome
> 
> A maintainer can run a local command against a saved refresh plan and get reviewable staging artifacts that contain source registry deltas, snapshot candidates, connector run/result evidence, affected memory review items, and a manifest. The command must fail closed for invalid plans, raw content leakage, malformed lineage, duplicate or unsafe destination paths, and direct vault writes.
> 
> ## Non-Goals
> 
> - Do not write directly to the final vault.
> - Do not compile active memory.
> - Do not promote or delete anything in Hindsight.
> - Do not implement remote connectors, background jobs, database migrations, UI, or env files.
> - Do not scan the vault, disk, mailbox, Drive, web, or any broad source.
> - Do not weaken existing local-file refresh, source refresh connector boundary, source snapshot refresh, Hindsight, or global specs.
> 
> ## Acceptance
> 
> - A saved local-file refresh plan can be applied to a new empty staging directory.
> - The staging directory contains reviewable JSON artifacts for the original plan, connector runs/results, refresh candidates/plans, snapshot candidates, review items, and manifest.
> - The apply step refuses plans with validation errors, missing lineage, raw-content-like fields, non-empty promotion payloads, or direct `identity-vault` destinations.
> - Changed-source staging preserves `previous_snapshot_id`, `connector_result_id`, `created_snapshot_id`, and `needs_review` routing.
> - Unavailable and `do_not_use` plans stage without creating fresh snapshots or active promotions.
> - No raw source content, source instructions, secrets, or neighboring-file content appear in stdout, stderr, or staged artifacts.
> - Existing specs remain green.
> 
> ## Oracle
> 
> Local file refresh staging gate is complete when `node --test tests/local-file-source-refresh-cli.test.mjs`, `node scripts/verify-local-file-source-refresh-workflow.mjs`, `node scripts/verify-source-refresh-connector-boundary.mjs`, `node scripts/verify-source-snapshot-refresh-preflight.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

Local file refresh staging gate is complete when node --test tests/local-file-source-refresh-cli.test.mjs, node scripts/verify-local-file-source-refresh-workflow.mjs, node scripts/verify-source-refresh-connector-boundary.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

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
