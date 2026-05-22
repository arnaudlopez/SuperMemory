# Acceptance Contract

## Goal

# T14 CI Regression Suite

## Intent

- Add the first local regression/CI harness for SuperMemory.
- Make the Golden Case invariants automatically checked by one CI-oriented command.
- Keep the Node verifier scripts as the source of truth.

- `node scripts/verify-ci-regression-suite.mjs` passes locally.
- The regression suite runs `node scripts/verify-supermemory-specs.mjs` and `git diff --check`.
- The regression suite proves representative invalid regressions fail for provenance, permissions, `do_not_use`, relation chains, and secrets.
- A GitHub Actions workflow runs the regression suite on push/PR.

- No promptfoo dependency or mandatory promptfoo runner in this tranche.
- No package manager setup unless strictly required.
- No runtime DB, hosted service, live connector, Hindsight API, Graphiti, or Memoria integration.
- No weakening T0-T13 verifiers.
- No changing the Golden Case contract just to make CI easier.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

A CI regression suite is wired locally and in GitHub Actions so provenance, permission, do_not_use, secret, or relation-chain regressions fail before the Golden Case can drift.

## Suggested Mode

implementation

## Acceptance Hints

- Red test first: global/target T14 command fails because `scripts/verify-ci-regression-suite.mjs` is missing.
- Green target: `node scripts/verify-ci-regression-suite.mjs` passes.
- Node test: `node --test tests/ci-regression-suite.test.mjs` passes.
- Global specs: `node scripts/verify-supermemory-specs.mjs` remains green.
- Static proof: `git diff --check` passes.
- CI proof: `.github/workflows/supermemory-regression.yml` invokes the regression suite.
- Shipping proof: committed SHA, pushed `origin/main`, final GoalBuddy quality check pass.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/implement-ci-regression-suite-t14/brief.md --mode implementation --oracle "A CI regression suite is wired locally and in GitHub Actions so provenance, permission, do_not_use, secret, or relation-chain regressions fail before the Golden Case can drift." --out docs/goals/t14-ci-regression-suite
```

## Source Notes

Compiled from: /tmp/supermemory-t14-notes.md

> # T14 Regression CI
> 
> ## Intent
> 
> - Add the first local regression/CI harness for SuperMemory.
> - Make the Golden Case invariants automatically checked by one CI-oriented command.
> - Keep the Node verifier scripts as the source of truth.
> 
> ## Visible Outcome
> 
> - `node scripts/verify-ci-regression-suite.mjs` passes locally.
> - The regression suite runs `node scripts/verify-supermemory-specs.mjs` and `git diff --check`.
> - The regression suite proves representative invalid regressions fail for provenance, permissions, `do_not_use`, relation chains, and secrets.
> - A GitHub Actions workflow runs the regression suite on push/PR.
> 
> ## Scope
> 
> - Implement T14.1-T14.5 from the TDD matrix.
> - Add a deterministic Node regression-suite script.
> - Add a focused Node test for the regression-suite script.
> - Add `.github/workflows/supermemory-regression.yml`.
> - Document the command and keep promptfoo optional.
> 
> ## Non-Goals
> 
> - No promptfoo dependency or mandatory promptfoo runner in this tranche.
> - No package manager setup unless strictly required.
> - No runtime DB, hosted service, live connector, Hindsight API, Graphiti, or Memoria integration.
> - No weakening T0-T13 verifiers.
> - No changing the Golden Case contract just to make CI easier.
> 
> ## Acceptance
> 
> - Red test first: global/target T14 command fails because `scripts/verify-ci-regression-suite.mjs` is missing.
> - Green target: `node scripts/verify-ci-regression-suite.mjs` passes.
> - Node test: `node --test tests/ci-regression-suite.test.mjs` passes.
> - Global specs: `node scripts/verify-supermemory-specs.mjs` remains green.
> - Static proof: `git diff --check` passes.
> - CI proof: `.github/workflows/supermemory-regression.yml` invokes the regression suite.
> - Shipping proof: committed SHA, pushed `origin/main`, final GoalBuddy quality check pass.
> 
> ## Oracle
> 
> - A CI regression suite is wired locally and in GitHub Actions so provenance, permission, `do_not_use`, secret, or relation-chain regressions fail before the Golden Case can drift.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

A CI regression suite is wired locally and in GitHub Actions so provenance, permission, do_not_use, secret, or relation-chain regressions fail before the Golden Case can drift.

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
