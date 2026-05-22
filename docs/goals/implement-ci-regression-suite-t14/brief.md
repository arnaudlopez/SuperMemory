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
