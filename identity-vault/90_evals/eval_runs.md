# Eval Runs

## Eval Run - 2026-05-19 - Acme Acceptance Fixture

Scope:

- `90_evals/cases/acme-meeting-complete/`

Expected:

- Raw-to-compiled recall passes.
- Personal availability publication is redacted.
- External source registry tracks the captured PDF excerpt and email.
- Captured email resolves the ambiguous recipient, but sending still requires confirmation.
- Prompt-injection-like email text is ignored as an instruction.
- Signals are typed and source-backed.

Verification:

```bash
node scripts/verify-identity-vault-tdd.mjs
```
