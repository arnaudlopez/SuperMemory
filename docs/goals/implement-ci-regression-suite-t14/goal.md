# Goal: Implement T14 CI Regression Suite

## Outcome

Implement the executable T14 contract proving that the SuperMemory Golden Case invariants are regression-checked automatically in CI, while promptfoo remains optional.

## Oracle

The goal is complete when `node scripts/verify-ci-regression-suite.mjs` is wired into `node scripts/verify-supermemory-specs.mjs`, proves T14.1-T14.5, a GitHub Actions workflow runs the critical checks, all prior T0-T13 specs remain green, docs are aligned, and the work is committed and pushed.

## Non-Goals

- Do not make promptfoo a required dependency.
- Do not add package dependencies, hosted services, databases, migrations, or runtime integrations.
- Do not weaken T0-T13 contracts.

## Command

```bash
node scripts/verify-ci-regression-suite.mjs
```
