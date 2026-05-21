# Implement M1 Hindsight Promotion Recall Fixture

## Original request

Prepare the next GoalBuddy goal after T1 memory contracts, for Tranche 2: Fixture M1 Acme gouvernee.

## Interpreted outcome

Create an executable M1 fixture that proves the first vertical SuperMemory chain:

```text
Source -> SourceSnapshot -> Observation -> ValidatedMemory -> HindsightPromotionPayload -> AnswerEvidence
```

This tranche should remain fixture/verifier focused. It must not integrate the real Hindsight runtime yet.

## Scope

- Create the `m1-hindsight-promotion-recall` eval case.
- Create a deterministic verifier script for the M1 fixture.
- Add a Node test wrapper if useful for TDD.
- Wire the M1 verifier into the global SuperMemory spec suite after it is green.
- Preserve the T1 memory-contract verifier as a regression dependency.

## Non-goals

- Do not install or run Hindsight.
- Do not create a memory service, API, database schema, connector, or UI.
- Do not implement the enterprise Golden Case yet.
- Do not add Graphiti, Memoria, or any engine port runtime.

## Goal oracle

The tranche is complete when:

```bash
node scripts/verify-m1-hindsight-promotion-recall-fixture.mjs
node --test tests/m1-hindsight-promotion-recall.test.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

all pass, and the verifier proves:

- a source without snapshot is rejected;
- an observation without `snapshot_id` is rejected;
- a derived memory without `derives_from` is rejected;
- the expected promotion payload contains `document_id`, tags, and provenance metadata;
- the expected answer evidence cites the active `snapshot_id`;
- a `do_not_use` item is absent from active promotion.

## TDD contract

1. Create red fixture/verifier evidence first.
2. Implement only the minimal fixture validator required to pass.
3. Keep the work local and deterministic.
4. Do not weaken invalid fixtures or skip assertions to obtain green.

## Likely misfire

The run could accidentally jump into Hindsight runtime integration. That would be premature. This tranche proves fixture shape and expected handoff behavior only.

## Completion proof

Final audit must map the implementation to all M1 tests, cite passing verification, prove commit/push, and confirm no runtime engine work was added.

