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

## Eval Run - 2026-05-22 - Engine Port Evals

Scope:

- `90_evals/cases/engine-port-evals/`
- `80_logs/engine_port_evals.jsonl`

Purpose:

- Keep Graphiti and Memoria as optional ports, not implicit dependencies.
- Record `not_activated` decisions when Hindsight or vault snapshots/logs satisfy the current eval.
- Allow a `candidate_port` only when an eval is red and justified.
- Reject any port that wants to own permissions, revocation, source freshness, or agent contracts.

Expected:

- Graphiti remains `not_activated` while Hindsight passes current temporal evals.
- Memoria remains `not_activated` while vault snapshots and logs cover rollback and audit.
- A red temporal eval creates only a justified `candidate_port`.
- A port that wants to own permissions, revocation, freshness, or agent contracts is rejected.

Verification:

```bash
node scripts/verify-engine-port-evals.mjs
```
