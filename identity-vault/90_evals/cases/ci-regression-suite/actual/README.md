# Actual State - CI Regression Suite

This fixture proves T14.

The CI regression suite keeps the existing Node verifier stack as the source of truth. It checks the global SuperMemory specs, whitespace via `git diff --check`, GitHub Actions wiring, and representative invalid-case coverage from the complete Orion Golden Case.

Run:

```bash
node scripts/verify-ci-regression-suite.mjs
```

Promptfoo remains optional and is not a required dependency or CI command in this tranche.
