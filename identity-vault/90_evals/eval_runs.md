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

## Target Fixture - Enterprise Living Memory Complete

Scope:

- `90_evals/cases/enterprise-living-memory-complete/`

Purpose:

- Define the most complete V2 target before implementation.
- Cover mutable enterprise sources, snapshots, freshness, derived PRDs, adaptive type creation, filtered agents, Hindsight promotion, and optional engine ports.
- Keep the target separate from the passing Acme fixture until a dedicated implementation tranche starts.

Verification:

```bash
node scripts/verify-enterprise-living-memory-target.mjs
```
