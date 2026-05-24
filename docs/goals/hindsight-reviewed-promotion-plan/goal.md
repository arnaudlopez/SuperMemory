# Hindsight Reviewed Promotion Plan Notes

## Original Request

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

## Ready Mode Instruction

Use this goal as a implementation Ready Mode run.

LLM first principle: the free-form conversation already did the exploration work. This board starts only after the owner says the spec is mature enough to freeze into proof.

1. Clarify the design concept and domain language before implementation.
2. Turn the desired end state into observable acceptance tests or equivalent proof.
3. Follow the board policy for red tests before production code.
4. Complete the largest safe useful slice inside approved boundaries.
5. Verify, review, commit, push, and finish only when the oracle is true.

## Oracle

The reviewed promotion plan goal is complete when an operator can produce a redacted Hindsight promotion plan from an explicit governed input, apply that reviewed plan through mock transport in tests, and see fail-closed behavior for tampering, missing approval, unsafe live/cloud use, validation errors, and secret leakage, while existing direct hindsight-promote behavior, node --test tests/hindsight-promote.test.mjs, node scripts/verify-golden-end-state-workflow.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check stay green.

## Files

- `state.yaml`: GoalBuddy board state.
- `acceptance-contract.md`: initial owner-facing acceptance contract to refine during T001/T002.
