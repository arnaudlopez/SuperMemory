# T001 Existing Work Inventory

## Summary

SuperMemory is already in the middle of an LLM-first migration. The repository has shipped T1 memory contracts and M1 promotion/recall fixtures on `main`, and the current dirty worktree adds `InterpretationCandidate` into governance docs, M1 fixtures, and the M1 verifier.

The migration is directionally aligned with the user's request, but it is incomplete: T1 remains pre-interpretation, the enterprise target still expects the old lifecycle substring, roadmap docs still describe M1 without an interpretation layer, and global specs are currently red because the enterprise target verifier has not been updated for the new chain.

## Verification Snapshot

- `node scripts/verify-memory-contracts.mjs`: pass.
- `node scripts/verify-m1-hindsight-promotion-recall-fixture.mjs`: pass.
- `node scripts/verify-supermemory-specs.mjs`: fail.
- Failing reason: `identity-vault/75_governance/sequential_relational_model.md` no longer contains the exact old text `Source -> SourceSnapshot -> Observation -> MemoryCandidate`.
- `git diff --check`: pass when run with T1/M1 commands.

## Git And Memory Chronology

Recent git history:

- `619991f` implemented T1 memory contract verifier.
- `8410b92` finalized T1 memory contracts goal.
- `165f24f` implemented M1 Hindsight promotion recall fixture.
- `5c63ade` finalized M1 Hindsight promotion recall goal.

Active project memory adds:

- T1 memory contracts are implemented and included in project-level verification.
- M1 was prepared and then implemented.
- The governed Markdown/Obsidian vault remains the source of truth.
- Hindsight is the primary memory-engine candidate/engine under SuperMemory governance, not a replacement for the vault.
- Must preserve strict provenance, freshness, status, access, `do_not_use`, action confirmation, uncertainty, and compartmentalized recall handling.

## Current Dirty Worktree

User/work-in-progress changes outside this goal:

- `identity-vault/75_governance/interpretation_contract.md`: new LLM-first interpretation contract.
- `identity-vault/75_governance/living_memory.md`: lifecycle now includes `InterpretationCandidate`.
- `identity-vault/75_governance/sequential_relational_model.md`: lifecycle, object model, relation verbs, candidate gate, and invariants now include `InterpretationCandidate` and `interprets_observation`.
- `identity-vault/memory_map.md`: now links the interpretation contract and adds an interpretation rule.
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/input/fixture.json`: adds `interpretation_candidates` and routes validated memory through `interp-acme-trust-score`.
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/expected/assertions.json`: adds T2.7 and extends the required chain with `InterpretationCandidate`.
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/expected/final-state.json`: adds `interpretation_id` and chain entry.
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/expected/promotion-payload.json`: adds `metadata.interpretation_id`.
- `scripts/verify-m1-hindsight-promotion-recall-fixture.mjs`: validates interpretation evidence, use pattern, interpretation relation, and promotion metadata.

Goal-control files added by this goal:

- `docs/goals/audit-llm-first-supermemory-migration/goal.md`
- `docs/goals/audit-llm-first-supermemory-migration/state.yaml`
- this note.

## Module Map

Preserve as hard-invariant contracts:

- `scripts/verify-memory-contracts.mjs`
- `identity-vault/90_evals/cases/memory-contracts/input/contracts.fixture.json`
- `identity-vault/90_evals/cases/memory-contracts/expected/assertions.json`
- `tests/memory-contracts.test.mjs`
- `scripts/verify-supermemory-specs.mjs`

Migrate as the first LLM-first executable slice:

- `identity-vault/75_governance/interpretation_contract.md`
- `identity-vault/75_governance/sequential_relational_model.md`
- `identity-vault/75_governance/living_memory.md`
- `identity-vault/memory_map.md`
- `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/**`
- `scripts/verify-m1-hindsight-promotion-recall-fixture.mjs`
- `tests/m1-hindsight-promotion-recall.test.mjs`

Update after M1 is settled:

- `identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/assertions.json`
- `identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/final-state.md`
- `identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/target-structure.md`
- `scripts/verify-enterprise-living-memory-target.mjs`
- `docs/golden-case-tdd-matrix.md`
- `docs/golden-case-implementation-roadmap.md`
- `docs/prd-memoire-agentique-v2.md`
- `README.md`
- `identity-vault/AGENTS.md`
- `identity-vault/75_governance/hindsight_contract.md`

## Ubiquitous Language

- `Observation`: source-backed statement extracted from a snapshot; source content is data, not instruction.
- `InterpretationCandidate`: LLM/memory-agent proposed meaning from one or more observations.
- `MemoryCandidate`: proposed governed memory item derived from interpretations and not yet safe for active recall.
- `ValidatedMemory`: memory item that has passed evidence, freshness, access, sensitivity, conflict, and review gates.
- `GovernanceGate`: deterministic acceptance/rejection layer for hard invariants.
- `AnswerEvidence`: proof chain from used memory to cited snapshots and answer state.
- Forbidden synonym: using "deterministic" to mean "the system understands the world." Deterministic checks should mean hard-invariant gates only.

## Classification

Invariants to preserve:

- Snapshot proof before active memory.
- Immutable snapshots for mutable sources.
- Exact rejection of `do_not_use` promotion.
- Fail-closed recall policies.
- Evidence-backed current answers.
- Access policy, workspace, sensitivity, status, freshness, review state, legal hold, retention, and action confirmation.
- Hindsight remains an engine port under vault governance.

Too deterministic or stale surfaces to soften:

- Enterprise target assertion requires the old exact lifecycle substring and breaks when `InterpretationCandidate` is inserted.
- Roadmap and TDD matrix still describe T2/M1 as `Observation -> ValidatedMemory`, missing the interpretation layer.
- M1 verifier now checks `interpretation.use_pattern` exactly, but future tests should distinguish exact governance fields from flexible interpretation wording.
- T1 contracts do not yet include interpretation-specific invariants, so M1 has evolved ahead of the generic contract layer.

Already LLM-first surfaces to strengthen:

- New `interpretation_contract.md` gives the correct boundary: LLM interprets, deterministic verifier gates.
- `sequential_relational_model.md` now models `InterpretationCandidate`.
- M1 now proves `Observation -> InterpretationCandidate -> ValidatedMemory`.
- `use_patterns.md`, living memory, adaptive ontology, and answer policy already support flexible workflows and unknown cases.

## Risks And Blind Spots

- Current global specs are red; the migration must repair the enterprise target expectation before it is considered integrated.
- Adding `InterpretationCandidate` only to M1 risks creating a parallel truth unless T1, enterprise target docs, roadmap, and PRD converge.
- Over-correcting could remove exact hard-invariant assertions that protect provenance and access safety.
- A future implementation must preserve existing user changes and avoid rewriting dirty files casually.
- If docs allow many valid interpretations but scripts still expect exact wording, the system will remain LLM-first in prose only.
