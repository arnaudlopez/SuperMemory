# Eval Runs

## Eval Run - 2026-05-19 - Acme Acceptance Fixture

Scope:

- `90_evals/cases/acme-meeting-complete/`

Expected:

- Raw-to-compiled recall passes.
- Personal availability publication is redacted.
- Ambiguous recipient remains in review.
- Signals are typed and source-backed.

Verification:

```bash
node scripts/verify-identity-vault-tdd.mjs
```
