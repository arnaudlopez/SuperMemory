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

- Define the most complete V2 target and executable T13 fixture.
- Cover mutable enterprise sources, snapshots, freshness, derived PRDs, adaptive type creation, filtered agents, Hindsight promotion, and optional engine ports.
- Keep `expected/` as the target oracle and `actual/fixture.json` as the executable proof.

Verification:

```bash
node scripts/verify-enterprise-living-memory-target.mjs
node scripts/verify-enterprise-living-memory-complete.mjs
```

## Eval Run - 2026-05-22 - Enterprise Living Memory Complete

Scope:

- `90_evals/cases/enterprise-living-memory-complete/actual/fixture.json`

Expected:

- All final Orion Golden Questions are source-backed.
- Each answer carries snapshot/evidence refs and a `supports_answer` relation chain.
- Email, marketing, product, and memory agents respect scoped filters and refusals.
- Staleness, conflict, type, permission, and action-confirmation queues exist.
- Secrets are redacted and absent from recall/drafts.
- Graphiti and Memoria remain `not_activated`.
- Requests map to known use patterns, not bespoke workflows.

Verification:

```bash
node scripts/verify-enterprise-living-memory-complete.mjs
```

## Eval Run - 2026-05-22 - CI Regression Suite

Scope:

- `90_evals/cases/ci-regression-suite/`
- `.github/workflows/supermemory-specs.yml`

Expected:

- CI runs `node scripts/verify-ci-regression-suite.mjs`.
- CI runs `node scripts/verify-supermemory-specs.mjs`.
- CI runs `git diff --check`.
- Missing provenance snapshots fail regression checks.
- Missing fail-closed filters fail permission checks.
- `do_not_use` memory in active recall fails.
- promptfoo remains optional, not a required dependency or CI gate.

Verification:

```bash
node scripts/verify-ci-regression-suite.mjs
```

## Eval Run - 2026-05-22 - Enterprise Living Memory Partial

Scope:

- `90_evals/cases/enterprise-living-memory-partial/`

Purpose:

- Make the first Orion enterprise Golden Case slice executable.
- Prove API and contract t0/t1 source changes.
- Prove PRD stale/review/active lifecycle.
- Prove stable Hindsight `document_id` re-promotion.
- Prove obsolete pricing is excluded from active recall.
- Keep full-case dimensions explicit as `pending`.

Verification:

```bash
node scripts/verify-enterprise-living-memory-partial.mjs
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
