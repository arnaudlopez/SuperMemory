# Acceptance Contract

## Goal

# Hindsight Reviewed Promotion Plan Notes

## Intent

Move Hindsight promotion from a direct fixture/input execution to an operator-reviewed promotion workflow:

```text
governed input -> dry-run promotion plan -> reviewed plan artifact -> apply reviewed plan with mock or explicit live mode
```

This makes the path safer before using real local Hindsight writes beyond smoke tests.

- No broad vault scan.
- No promotion from arbitrary vault content.
- No source capture, refresh, compilation, review queue, or answer generation behavior changes.
- No committed secrets, env files, bank ids, raw live responses, or live evidence.
- No Hindsight Cloud fallback.
- No live write in CI.
- No UI.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

The reviewed promotion plan goal is complete when an operator can produce a redacted Hindsight promotion plan from an explicit governed input, apply that reviewed plan through mock transport in tests, and see fail-closed behavior for tampering, missing approval, unsafe live/cloud use, validation errors, and secret leakage, while existing direct hindsight-promote behavior, node --test tests/hindsight-promote.test.mjs, node scripts/verify-golden-end-state-workflow.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check stay green.

## Suggested Mode

implementation

## Acceptance Hints

- Add an operator-reviewed promotion plan gate for Hindsight promotion.
- The first step writes a reviewable plan artifact outside the vault with no network writes and no secrets.
- Applying a plan refuses tampering, validation errors, missing approval, stale command mode, cloud fallback by default, raw secret-like values, and direct writes without explicit live opt-in.
- Apply can run in mock mode for CI and targeted tests.
- Live apply remains possible only with explicit local env and `SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1`, but should not run in CI.
- The existing `hindsight-promote` direct dry-run/live behavior remains compatible.
- `node --test tests/hindsight-promote.test.mjs`, the new reviewed-plan tests/verifier, `node scripts/verify-golden-end-state-workflow.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` pass.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/hindsight-reviewed-promotion-plan/brief.md --mode implementation --oracle "The reviewed promotion plan goal is complete when an operator can produce a redacted Hindsight promotion plan from an explicit governed input, apply that reviewed plan through mock transport in tests, and see fail-closed behavior for tampering, missing approval, unsafe live/cloud use, validation errors, and secret leakage, while existing direct hindsight-promote behavior, node --test tests/hindsight-promote.test.mjs, node scripts/verify-golden-end-state-workflow.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check stay green." --out docs/goals/hindsight-reviewed-promotion-plan-notes
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/hindsight-reviewed-promotion-plan-notes.md

> # Hindsight Reviewed Promotion Plan Notes
> 
> Date: 2026-05-24
> 
> ## Intent
> 
> Move Hindsight promotion from a direct fixture/input execution to an operator-reviewed promotion workflow:
> 
> ```text
> governed input -> dry-run promotion plan -> reviewed plan artifact -> apply reviewed plan with mock or explicit live mode
> ```
> 
> This makes the path safer before using real local Hindsight writes beyond smoke tests.
> 
> ## Current State
> 
> - `scripts/hindsight-promote.mjs` can read `promotion_payloads` or explicit `validated_memories`.
> - Dry-run is default and validates provenance, review state, recall scope, `do_not_use`, and candidate type blockers.
> - `--live --mock-transport` is covered by tests.
> - Local Hindsight live smoke has passed against `http://127.0.0.1:8888` with fake local credentials and sacrificial bank `bank-local-smoke`.
> - Capture and refresh CLIs already use an operator pattern with `--write-plan`, `--apply-plan`, and owner-confirmed commit gates.
> 
> ## Non-Goals
> 
> - No broad vault scan.
> - No promotion from arbitrary vault content.
> - No source capture, refresh, compilation, review queue, or answer generation behavior changes.
> - No committed secrets, env files, bank ids, raw live responses, or live evidence.
> - No Hindsight Cloud fallback.
> - No live write in CI.
> - No UI.
> 
> ## Acceptance
> 
> - Add an operator-reviewed promotion plan gate for Hindsight promotion.
> - The first step writes a reviewable plan artifact outside the vault with no network writes and no secrets.
> - Applying a plan refuses tampering, validation errors, missing approval, stale command mode, cloud fallback by default, raw secret-like values, and direct writes without explicit live opt-in.
> - Apply can run in mock mode for CI and targeted tests.
> - Live apply remains possible only with explicit local env and `SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1`, but should not run in CI.
> - The existing `hindsight-promote` direct dry-run/live behavior remains compatible.
> - `node --test tests/hindsight-promote.test.mjs`, the new reviewed-plan tests/verifier, `node scripts/verify-golden-end-state-workflow.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` pass.
> 
> ## Observable Oracle
> 
> The reviewed promotion plan goal is complete when an operator can produce a redacted Hindsight promotion plan from an explicit governed input, apply that reviewed plan through mock transport in tests, and see fail-closed behavior for tampering, missing approval, unsafe live/cloud use, validation errors, and secret leakage, while all existing global specs stay green.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

The reviewed promotion plan goal is complete when an operator can produce a redacted Hindsight promotion plan from an explicit governed input, apply that reviewed plan through mock transport in tests, and see fail-closed behavior for tampering, missing approval, unsafe live/cloud use, validation errors, and secret leakage, while existing direct hindsight-promote behavior, node --test tests/hindsight-promote.test.mjs, node scripts/verify-golden-end-state-workflow.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check stay green.

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
