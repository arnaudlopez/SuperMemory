# Implement Memory Contracts T1

## Original request

Lancer un goal afin d'implementer les tests T1.X de la matrice TDD vers le Golden Case.

## Interpreted outcome

Implement the Tranche 1 minimal memory contracts in TDD mode:

- create the red fixtures and verifier for `memory-contracts`;
- prove T1.1 through T1.8;
- implement only the minimal contract validation needed to make those tests pass;
- keep Hindsight runtime, connectors, UI, and engine implementation out of scope.

## Scope

- `scripts/verify-memory-contracts.mjs`
- `identity-vault/90_evals/cases/memory-contracts/**`
- optional focused test files if the Worker chooses a test runner-compatible shape;
- docs updates only if they clarify the T1 test contract.

## Non-goals

- Do not integrate Hindsight runtime.
- Do not create a memory service, API, database schema, or UI.
- Do not implement Golden Case enterprise behavior yet.
- Do not change Graphiti/Memoria port policy.

## Goal oracle

The command below proves the tranche:

```bash
node scripts/verify-memory-contracts.mjs
```

It must reject invalid T1 fixtures with the exact expected error names and accept the valid minimum contract fixture.

The broader suite must remain green:

```bash
node scripts/verify-supermemory-specs.mjs
git diff --check
```

## TDD contract

The goal must preserve red -> green evidence:

1. Create or demonstrate failing T1 fixtures first.
2. Implement the minimal validator logic.
3. Prove invalid cases fail for the expected reasons.
4. Prove the valid case passes.

Minimum T1 coverage:

- T1.1 `missing_snapshot_proof`
- T1.2 `snapshot_id_collision`
- T1.3 pending candidate cannot become active
- T1.4 `candidate_type_not_promotable`
- T1.5 `do_not_use` cannot produce active promotion
- T1.6 `unsafe_recall_policy`
- T1.7 `missing_answer_evidence`
- T1.8 `invalid_relation_endpoints`

## Likely misfire

Writing a permissive verifier that checks only that JSON exists, or implementing a pseudo-engine instead of a small deterministic contract validator.

## Completion proof

The goal is complete only when:

- the T1 fixture and verifier exist;
- all T1 invalid cases are covered with exact expected errors;
- the valid fixture passes;
- `node scripts/verify-memory-contracts.mjs` passes;
- `node scripts/verify-supermemory-specs.mjs` passes;
- `git diff --check` passes;
- the work is committed and pushed.

