# Acceptance Contract

## Goal

# Local File Refresh Commit Gate

## Intent

Implement the next SuperMemory tranche after the local-file refresh staging gate: a controlled commit gate from reviewed refresh staging into final vault registries.

The current `local-file-source-refresh.mjs` can dry-run a registered `local_file` refresh, persist a plan, and apply that plan to a reviewable staging directory. The next step is to let an operator commit reviewed staging into the final vault source and snapshot registries, without compiling active memory and without promoting to Hindsight.

A maintainer can run a local command against a reviewed local-file refresh staging directory and an explicit `identity-vault` root. With owner confirmation, the command updates only the final source and snapshot registries needed to record the refreshed snapshot state. It must fail closed for incomplete or tampered staging, duplicate snapshot ids, raw content leakage, missing owner confirmation, unsafe vault roots, and any attempt to compile memory or promote to Hindsight.

- Do not compile active memory.
- Do not promote, delete, or mutate anything in Hindsight.
- Do not implement remote connectors, background jobs, database migrations, UI, or env files.
- Do not scan the vault, disk, mailbox, Drive, web, or any broad source.
- Do not commit unavailable or `do_not_use` staging as a fresh active snapshot.
- Do not weaken existing local-file refresh, refresh staging, manual capture, source refresh connector boundary, source snapshot refresh, Hindsight, or global specs.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

Local file refresh commit gate is complete when node --test tests/local-file-source-refresh-cli.test.mjs, node scripts/verify-local-file-source-refresh-workflow.mjs, node scripts/verify-source-refresh-connector-boundary.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

## Suggested Mode

implementation

## Acceptance Hints

- A reviewed changed-source local-file refresh staging directory can be committed with `--commit-staging <dir> --vault-root <identity-vault> --owner-confirmed`.
- The commit step reads only staging artifacts and the two final vault registry files.
- The source registry records the refreshed active snapshot and freshness state for the source.
- The snapshot registry records the new immutable snapshot with `previous_snapshot_id`, `connector_result_id`, content hash, and refresh/change status.
- The command refuses missing owner confirmation, incomplete/tampered staging, malformed lineage, non-empty promotion payloads, duplicate snapshot ids, unavailable staging, `do_not_use` staging, and direct raw-content-like fields.
- No raw source content, source instructions, secrets, or neighboring-file content appear in stdout, stderr, committed registries, or staged artifacts.
- The command does not compile memory and does not promote anything in Hindsight.
- Existing specs remain green.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/local-file-refresh-commit-gate/brief.md --mode implementation --oracle "Local file refresh commit gate is complete when node --test tests/local-file-source-refresh-cli.test.mjs, node scripts/verify-local-file-source-refresh-workflow.mjs, node scripts/verify-source-refresh-connector-boundary.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass." --out docs/goals/local-file-refresh-commit-gate
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/local-file-refresh-commit-gate-notes.md

> # Local File Refresh Commit Gate
> 
> ## Intent
> 
> Implement the next SuperMemory tranche after the local-file refresh staging gate: a controlled commit gate from reviewed refresh staging into final vault registries.
> 
> The current `local-file-source-refresh.mjs` can dry-run a registered `local_file` refresh, persist a plan, and apply that plan to a reviewable staging directory. The next step is to let an operator commit reviewed staging into the final vault source and snapshot registries, without compiling active memory and without promoting to Hindsight.
> 
> ## User Outcome
> 
> A maintainer can run a local command against a reviewed local-file refresh staging directory and an explicit `identity-vault` root. With owner confirmation, the command updates only the final source and snapshot registries needed to record the refreshed snapshot state. It must fail closed for incomplete or tampered staging, duplicate snapshot ids, raw content leakage, missing owner confirmation, unsafe vault roots, and any attempt to compile memory or promote to Hindsight.
> 
> ## Non-Goals
> 
> - Do not compile active memory.
> - Do not promote, delete, or mutate anything in Hindsight.
> - Do not implement remote connectors, background jobs, database migrations, UI, or env files.
> - Do not scan the vault, disk, mailbox, Drive, web, or any broad source.
> - Do not commit unavailable or `do_not_use` staging as a fresh active snapshot.
> - Do not weaken existing local-file refresh, refresh staging, manual capture, source refresh connector boundary, source snapshot refresh, Hindsight, or global specs.
> 
> ## Acceptance
> 
> - A reviewed changed-source local-file refresh staging directory can be committed with `--commit-staging <dir> --vault-root <identity-vault> --owner-confirmed`.
> - The commit step reads only staging artifacts and the two final vault registry files.
> - The source registry records the refreshed active snapshot and freshness state for the source.
> - The snapshot registry records the new immutable snapshot with `previous_snapshot_id`, `connector_result_id`, content hash, and refresh/change status.
> - The command refuses missing owner confirmation, incomplete/tampered staging, malformed lineage, non-empty promotion payloads, duplicate snapshot ids, unavailable staging, `do_not_use` staging, and direct raw-content-like fields.
> - No raw source content, source instructions, secrets, or neighboring-file content appear in stdout, stderr, committed registries, or staged artifacts.
> - The command does not compile memory and does not promote anything in Hindsight.
> - Existing specs remain green.
> 
> ## Oracle
> 
> Local file refresh commit gate is complete when `node --test tests/local-file-source-refresh-cli.test.mjs`, `node scripts/verify-local-file-source-refresh-workflow.mjs`, `node scripts/verify-source-refresh-connector-boundary.mjs`, `node scripts/verify-source-snapshot-refresh-preflight.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

Local file refresh commit gate is complete when node --test tests/local-file-source-refresh-cli.test.mjs, node scripts/verify-local-file-source-refresh-workflow.mjs, node scripts/verify-source-refresh-connector-boundary.mjs, node scripts/verify-source-snapshot-refresh-preflight.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

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
