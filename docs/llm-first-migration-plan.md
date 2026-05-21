# LLM-First Migration Plan

## Purpose

This plan migrates SuperMemory from "deterministic lifecycle fixtures" toward "LLM-first interpretation with deterministic governance gates".

The target is not to remove deterministic verification. The target is to move determinism to the right layer:

- LLM or memory agent: interpret source-backed observations, compare plausible meanings, expose uncertainty, and propose the use pattern.
- Deterministic verifier: reject unsafe advancement when evidence, confidence, uncertainty, review state, access, freshness, status, or `do_not_use` gates fail.

## Current State

Already shipped on `main`:

- T1 memory contracts in `scripts/verify-memory-contracts.mjs`, `tests/memory-contracts.test.mjs`, and `identity-vault/90_evals/cases/memory-contracts/`.
- M1 promotion/recall fixture in `scripts/verify-m1-hindsight-promotion-recall-fixture.mjs`, `tests/m1-hindsight-promotion-recall.test.mjs`, and `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/`.
- Global verification wiring in `scripts/verify-supermemory-specs.mjs`.
- Acme and enterprise target evals.

Current uncommitted work has already started the migration:

- `identity-vault/75_governance/interpretation_contract.md` defines the LLM/deterministic boundary.
- `identity-vault/75_governance/sequential_relational_model.md` adds `InterpretationCandidate`.
- `identity-vault/75_governance/living_memory.md` adds `InterpretationCandidate` to the lifecycle.
- `identity-vault/memory_map.md` links the interpretation contract.
- M1 fixture and verifier now include `interpretation_candidates`, `interprets_observation`, `metadata.interpretation_id`, and T2.7 `interpretation_without_evidence`.

Original verification state before this implementation:

- `node scripts/verify-memory-contracts.mjs`: passes.
- `node scripts/verify-m1-hindsight-promotion-recall-fixture.mjs`: passes.
- `node scripts/verify-supermemory-specs.mjs`: failed because the enterprise target still expected the old exact lifecycle substring `Source -> SourceSnapshot -> Observation -> MemoryCandidate`.

## Target Contract

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

Deterministic checks should reject:

- missing evidence refs and missing `proposed_from`;
- missing confidence;
- missing uncertainty;
- unknown `use_pattern`;
- unsafe active promotion from `needs_review` or `rejected` interpretation;
- promotion payloads missing interpretation provenance;
- answers that claim `current` without memory and snapshot evidence;
- any `do_not_use` memory in active promotion or active recall.

Deterministic checks should not require:

- one exact natural-language interpretation;
- one exact wording of assumptions;
- one exact wording of alternatives;
- one hard-coded workflow for every business request.

## Migration Order

### 1. Restore Global Specs

Goal: make the current partial LLM-first migration coherent without changing its architecture.

Future files to modify:

- `identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/assertions.json`
- `identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/final-state.md`
- possibly `scripts/verify-enterprise-living-memory-target.mjs`

Expected changes:

- Replace the old required lifecycle substring with the new lifecycle including `InterpretationCandidate`.
- Add `InterpretationCandidate` and `interprets_observation` to enterprise target expectations.
- Keep all existing concepts: `SourceSnapshot`, `MemoryCandidate`, `ValidatedMemory`, `supports_answer`, `opens_review`, access, freshness, secrets, legal hold, and engine-port constraints.

Verification:

```bash
node scripts/verify-enterprise-living-memory-target.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

### 2. Generalize T1 With Interpretation Invariants

Goal: avoid having M1 define interpretation rules that T1 does not know about.

Future files to modify:

- `identity-vault/90_evals/cases/memory-contracts/input/contracts.fixture.json`
- `identity-vault/90_evals/cases/memory-contracts/expected/assertions.json`
- `scripts/verify-memory-contracts.mjs`
- `tests/memory-contracts.test.mjs` only if the wrapper needs naming updates

Suggested new T1 checks:

- `interpretation_without_evidence`
- `interpretation_without_confidence`
- `interpretation_without_uncertainty`
- `interpretation_unknown_use_pattern`
- `interpretation_not_reviewed_for_active_memory`
- `promotion_missing_interpretation_provenance`

Keep exact-error assertions for these hard invariant failures. Do not turn T1 into an LLM evaluator.

Verification:

```bash
node scripts/verify-memory-contracts.mjs
node --test tests/memory-contracts.test.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

### 3. Harden M1 As The First LLM-First Executable Slice

Goal: preserve the current M1 interpretation work, then make its boundary explicit enough for future adapter work.

Future files to modify:

- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/input/fixture.json`
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/expected/assertions.json`
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/expected/final-state.json`
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/expected/promotion-payload.json`
- `scripts/verify-m1-hindsight-promotion-recall-fixture.mjs`

Preserve current M1 additions:

- `interpretation_candidates`
- `interprets_observation`
- `interpretation_id`
- `required_use_pattern`
- T2.7 `interpretation_without_evidence`

Add only after T1 is generalized:

- missing confidence case;
- missing uncertainty case;
- unknown use pattern case;
- unsafe review status case;
- a positive case that accepts equivalent interpretation wording when evidence and governance fields are valid.

Verification:

```bash
node scripts/verify-m1-hindsight-promotion-recall-fixture.mjs
node --test tests/m1-hindsight-promotion-recall.test.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

### 4. Align Roadmap And PRD

Goal: prevent future GoalBuddy runs from reintroducing the old deterministic chain.

Future files to modify:

- `docs/golden-case-tdd-matrix.md`
- `docs/golden-case-implementation-roadmap.md`
- `docs/prd-memoire-agentique-v2.md`
- `README.md`
- `identity-vault/AGENTS.md`
- `identity-vault/75_governance/hindsight_contract.md`

Expected changes:

- Update flow diagrams to include `InterpretationCandidate`.
- Reframe deterministic verifier language as "property checks for governance gates".
- Keep TDD red/green, but clarify that exact natural-language answers are not the goal when multiple interpretations satisfy the same contract.
- Move the "too programmatic" risk earlier than T13.7 by adding explicit tests in the next tranche.

### 5. Future Adapter Rule

Before real Hindsight runtime integration, the adapter must consume governed interpretation output. It must not auto-retain raw LLM conclusions as stable memory.

Future adapter expectations:

- Hindsight receives only `ValidatedMemory` or approved raw audit payloads.
- Promotion metadata includes `interpretation_id` when memory depends on interpretation.
- Recall filters remain fail-closed.
- `do_not_use` still deletes or excludes active Hindsight documents.
- Adapter traces should record whether answer evidence came from observation directly, interpretation, or compiled memory.

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
- M1 `source_without_snapshot`
- M1 `observation_without_snapshot_id`
- M1 `memory_without_derives_from`
- M1 `incomplete_promotion_payload`
- M1 `answer_missing_active_snapshot`
- M1 `do_not_use_promoted`
- M1 `interpretation_without_evidence`

## Tests To Add

Add these as named hard-invariant failures:

- missing interpretation confidence;
- missing interpretation uncertainty;
- unknown use pattern;
- active memory derived from `needs_review` or `rejected` interpretation;
- promotion payload missing `interpretation_id`;
- answer evidence that skips interpretation lineage when the memory derives from an interpretation.

Add one flexible-positive test:

- two differently worded interpretation claims are accepted when they cite the same evidence, declare uncertainty/confidence, use the same allowed pattern, and route to the same safe answer state.

## What Can Be Relaxed Later

Only relax exact wording checks after the hard properties above exist.

Candidates for relaxation:

- exact `claim` wording;
- exact `assumptions` wording;
- exact `alternative_interpretations` wording;
- exact answer text when `answer_state`, memory ids, and cited snapshots are correct.

Do not relax:

- error names for hard invariant failures;
- source/snapshot ids;
- access policy;
- freshness/status;
- `do_not_use`;
- required confirmation;
- Hindsight promotion metadata;
- answer evidence requirements.

## No-Touch List For The Next Implementation Goal

Do not modify these unless the implementation goal explicitly approves it:

- raw inbox sources under `identity-vault/00_inbox/`;
- compiled professional/personal/private memory notes;
- existing logs in `identity-vault/80_logs/` except when a fixture explicitly owns new log assertions;
- connector integrations or external sources;
- Hindsight runtime setup;
- Graphiti, Memoria, or other engine ports;
- broad vault rewrites.

## Suggested Next Goal

Recommended next command shape:

```text
/goal Follow docs/goals/<new-slug>/goal.md.
```

Recommended tranche title:

```text
Implement LLM-First Interpretation Contract Migration
```

Recommended scope:

1. Repair enterprise target/global specs for the new lifecycle.
2. Add interpretation invariants to T1.
3. Harden M1 with the additional interpretation cases.
4. Update roadmap/PRD diagrams and wording.

Recommended first oracle:

```bash
node scripts/verify-enterprise-living-memory-target.mjs
node scripts/verify-memory-contracts.mjs
node scripts/verify-m1-hindsight-promotion-recall-fixture.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

## Done Criteria For The Migration

The migration is done only when:

- the canonical lifecycle includes `InterpretationCandidate` everywhere relevant;
- global specs are green;
- T1 owns generic interpretation invariants;
- M1 remains the first vertical LLM-first executable slice;
- roadmap and PRD no longer instruct future work to bypass interpretation;
- hard governance gates remain exact and deterministic;
- flexible interpretation wording is allowed only where the governance contract remains satisfied.
