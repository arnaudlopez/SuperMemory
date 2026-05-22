# LLM-First Migration Record

## Purpose

This document records the completed LLM-first interpretation migration and the remaining runtime implications.

SuperMemory is LLM-first for meaning and deterministic for governance:

- LLMs and memory agents interpret source-backed observations, compare plausible meanings, expose uncertainty, and propose a known use pattern.
- Deterministic verifiers reject unsafe advancement when evidence, confidence, uncertainty, review state, access, freshness, status, or `do_not_use` gates fail.

The migration did not remove deterministic verification. It moved determinism to the governance boundary.

## Completed State

Already shipped on `main`:

- T1 memory contracts in `scripts/verify-memory-contracts.mjs`, `tests/memory-contracts.test.mjs`, and `identity-vault/90_evals/cases/memory-contracts/`.
- M1 promotion/recall fixture in `scripts/verify-m1-hindsight-promotion-recall-fixture.mjs`, `tests/m1-hindsight-promotion-recall.test.mjs`, and `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/`.
- LLM-first governance docs, including `identity-vault/75_governance/interpretation_contract.md`.
- Sequential/relational lifecycle docs with `InterpretationCandidate`.
- Global verification wiring in `scripts/verify-supermemory-specs.mjs`.
- Enterprise target and complete Golden Case evals with `InterpretationCandidate` and `interprets_observation`.
- T14 CI regression suite and GitHub Actions workflow.

Current verification:

```bash
node scripts/verify-memory-contracts.mjs
node scripts/verify-m1-hindsight-promotion-recall-fixture.mjs
node scripts/verify-enterprise-living-memory-target.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

## Canonical Contract

Canonical lifecycle:

```text
Source
  -> SourceSnapshot
  -> Observation
  -> InterpretationCandidate
  -> MemoryCandidate
  -> ValidatedMemory
  -> Relation
  -> HindsightDocument / Retrieval
  -> Answer
  -> Feedback / Change
```

Required `InterpretationCandidate` fields:

```yaml
interpretation_id: <stable id>
proposed_from: [<observation ids>]
claim: <proposed meaning>
confidence: <high|medium|low>
uncertainty: <known uncertainty or none>
assumptions: [<assumptions>]
alternative_interpretations: [<other plausible readings>]
use_pattern: <pattern from 75_governance/use_patterns.md>
review_status: <approved|needs_review|rejected>
evidence_refs: [<observation ids or snapshot ids>]
```

Deterministic checks reject:

- missing evidence refs or missing `proposed_from`;
- missing confidence;
- missing uncertainty;
- unknown `use_pattern`;
- unsafe active promotion from `needs_review` or `rejected` interpretation;
- promotion payloads missing interpretation provenance;
- answers that claim `current` without memory and snapshot evidence;
- any `do_not_use` memory in active promotion or active recall.

Deterministic checks do not require:

- one exact natural-language interpretation;
- one exact wording of assumptions;
- one exact wording of alternatives;
- one hard-coded workflow for every business request.

## Implemented Migration

### 1. Global Specs Restored

The enterprise target and global specs now expect the lifecycle with `InterpretationCandidate`.

Relevant files:

- `identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/assertions.json`
- `identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/final-state.md`
- `identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/target-structure.md`
- `scripts/verify-enterprise-living-memory-target.mjs`

### 2. T1 Owns Generic Interpretation Invariants

T1 now includes hard interpretation gates:

- `interpretation_without_evidence`
- `interpretation_without_confidence`
- `interpretation_without_uncertainty`
- `interpretation_unknown_use_pattern`
- `interpretation_not_reviewed_for_active_memory`
- `promotion_missing_interpretation_provenance`

Relevant files:

- `identity-vault/90_evals/cases/memory-contracts/input/contracts.fixture.json`
- `identity-vault/90_evals/cases/memory-contracts/expected/assertions.json`
- `scripts/verify-memory-contracts.mjs`
- `tests/memory-contracts.test.mjs`

### 3. M1 Is The First LLM-First Executable Slice

M1 preserves the source -> snapshot -> observation -> interpretation -> validated memory -> promotion -> answer path and adds a flexible-positive interpretation case.

M1 includes:

- `interpretation_candidates`
- `interprets_observation`
- `metadata.interpretation_id`
- `required_use_pattern`
- missing evidence, confidence, uncertainty, use pattern, review status, and promotion provenance invalid cases
- `required_equivalent_interpretation_ids`, proving different wording can pass when the same governance contract is satisfied

Relevant files:

- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/input/fixture.json`
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/expected/assertions.json`
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/expected/final-state.json`
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/expected/promotion-payload.json`
- `scripts/verify-m1-hindsight-promotion-recall-fixture.mjs`

### 4. Roadmap, PRD, And README Are Aligned

The core docs now describe SuperMemory as LLM-first for meaning and deterministic for governance. Future work should preserve this split instead of reintroducing an exact-answer or workflow-per-case model.

## Tests To Preserve

Never weaken these checks without replacement:

- T1 `missing_snapshot_proof`
- T1 `snapshot_id_collision`
- T1 `candidate_not_validated`
- T1 `candidate_type_not_promotable`
- T1 `do_not_use_not_promotable`
- T1 `unsafe_recall_policy`
- T1 `missing_answer_evidence`
- T1 `invalid_relation_endpoints`
- T1 `interpretation_without_evidence`
- T1 `interpretation_without_confidence`
- T1 `interpretation_without_uncertainty`
- T1 `interpretation_unknown_use_pattern`
- T1 `interpretation_not_reviewed_for_active_memory`
- T1 `promotion_missing_interpretation_provenance`
- M1 `source_without_snapshot`
- M1 `observation_without_snapshot_id`
- M1 `memory_without_derives_from`
- M1 `incomplete_promotion_payload`
- M1 `answer_missing_active_snapshot`
- M1 `do_not_use_promoted`
- M1 interpretation invalid cases
- M1 flexible-positive equivalent interpretation case

## What Can Be Relaxed Later

Exact wording can be relaxed only where hard governance properties remain satisfied.

Candidates for relaxation:

- exact `claim` wording;
- exact `assumptions` wording;
- exact `alternative_interpretations` wording;
- exact answer text when `answer_state`, memory ids, relation chain, and cited snapshots are correct.

Do not relax:

- error names for hard invariant failures;
- source/snapshot ids;
- access policy;
- freshness/status;
- `do_not_use`;
- required confirmation;
- Hindsight promotion metadata;
- answer evidence requirements.

## Runtime Implications

Before real Hindsight runtime integration, the adapter must consume governed interpretation output. It must not auto-retain raw LLM conclusions as stable memory.

Future adapter expectations:

- Hindsight receives only `ValidatedMemory` or approved raw audit payloads.
- Promotion metadata includes `interpretation_id` when memory depends on interpretation.
- Recall filters remain fail-closed.
- `do_not_use` still deletes or excludes active Hindsight documents.
- Adapter traces record whether answer evidence came from observation directly, interpretation, compiled memory, or recall.
- Dry-run promotion should exist before live writes.

## No-Touch List For Runtime Preflight

Do not modify these unless the implementation goal explicitly approves it:

- raw inbox sources under `identity-vault/00_inbox/`;
- compiled professional/personal/private memory notes;
- existing logs in `identity-vault/80_logs/` except when a fixture explicitly owns new log assertions;
- broad vault rewrites;
- Graphiti, Memoria, or other engine ports.

## Suggested Next Goal

Recommended next implementation tranche:

```text
Runtime Preflight For Vault-To-Hindsight Promotion
```

Recommended scope:

1. Choose the promotion CLI shape, including dry-run behavior.
2. Define required environment variables without committing secrets.
3. Map one governed fixture payload to real Hindsight retain/delete/recall calls.
4. Preserve the local fake adapter as the contract oracle.
5. Keep answer evidence and adapter traces auditable.

Recommended oracle:

```bash
node scripts/verify-hindsight-adapter-minimal.mjs
node scripts/verify-governed-answer-evidence.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```
