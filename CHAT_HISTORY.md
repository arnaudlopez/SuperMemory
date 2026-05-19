# Chat History - SuperMemory Design Session

Date: 2026-05-19

This file preserves the useful conversation history behind the current SuperMemory repository. It is not a verbatim transcript; it is a structured continuity record for future Codex/Claude sessions.

## Original Question

Arnaud asked for the best way to create a professional and personal "copy" of himself: Claude Code with Obsidian, Codex with Obsidian, Claude/NotebookLM, custom RAG, or another method.

## Core Decision

Start with a Markdown/Obsidian vault maintained by Codex or Claude Code. Do not begin with a custom RAG.

Reason:

- Markdown remains human-readable and durable.
- Obsidian provides local graph/navigation.
- Codex/Claude Code can maintain files, indexes, review queues, and conventions.
- RAG can be added later when evaluation shows retrieval failure.

## Memory Architecture

The memory should work like a library with a catalogue, not like one giant context dump.

Layers:

- Boot instructions: `AGENTS.md` / `CLAUDE.md`
- Navigation: `memory_map.md`
- Raw sources: `00_inbox/`
- Compiled memories: professional, personal, shared
- Review queues: ambiguity, publication, calendar, health
- Signals: typed minimal consumable facts for agents
- Agent contracts: what each agent can read/write/do
- Governance: threat model, forgetting, ontology, time, source reliability, conflicts
- Evals: golden questions, canaries, test runs

## Important Design Points

- Raw notes stay immutable proof sources.
- Compiled notes are source-backed views, not replacements.
- Agents should read indexes and compiled notes before raw sources.
- Specialized agents must not read the full personal memory.
- Personal facts can affect professional operations only through redacted shared signals.
- Inferred links are hypotheses until confirmed.
- Ambiguities go to review instead of silently becoming facts.

## Example Discussed

Meeting note:

- Acme is worried about timing.
- Paul asks for an analytics proposal.
- The note says "send him the proposal" without clear recipient.

Expected memory behavior:

- Acme client page gets the confirmed concern.
- Project Y link is probable if inferred from context.
- Paul Martin page records role and aliases.
- Action signal is created but `needs_review`.
- Ambiguity queue asks who "him" refers to.

Personal note:

- Arnaud has a private appointment next Wednesday morning.

Expected memory behavior:

- Personal source keeps the private detail.
- Shared layer publishes only "personal unavailability".
- Calendar agent consumes the redacted availability signal.
- Medical/private detail must not leak into professional/calendar outputs.

## Monitoring Decision

Monitoring is part of V1, not a future nice-to-have.

Use:

- `90_evals/golden_questions.md`
- `90_evals/eval_runs.md`
- canaries
- permission tests
- ambiguity tests
- routing tests

Measure:

- recall
- precision
- source quality
- context budget
- permission violations
- hypotheses promoted to facts

## Retrieval Escalation

Do not add RAG immediately.

Escalation ladder:

1. Markdown links and indexes.
2. Text search/BM25.
3. Embeddings/RAG light.
4. Hybrid retrieval plus reranking.
5. Knowledge graph/entity resolution/coreference.
6. Memory service with API and ACL.

Benchmarks and research themes reviewed:

- BEIR
- MTEB/MMTEB
- MIRACL
- KILT
- RAGChecker
- Contextual retrieval / hybrid retrieval / reranking

Conclusion:

SuperMemory will not beat top retrieval systems on pure benchmark recall in V1. It can beat a generic RAG for personal/professional memory because it governs provenance, sensitivity, time, permissions, publication, review, and agent action.

## Governance Added

The system needs `75_governance/`:

- `threat_model.md`
- `prompt_injection_policy.md`
- `forgetting_policy.md`
- `ontology.md`
- `temporal_model.md`
- `source_reliability.md`
- `conflict_arbitration.md`
- `academic_research_map.md`

Key principle:

> The next level is not more AI. It is better memory governance.

## TDD Turn

Arnaud asked for a TDD approach: create the final architecture skeleton with representative data and a complete test showing the final result.

GoalBuddy was used to prepare and execute:

- `docs/goals/tdd-identity-vault-skeleton/goal.md`
- `docs/goals/tdd-identity-vault-skeleton/state.yaml`

The first acceptance case is:

- `identity-vault/90_evals/cases/acme-meeting-complete/`

Verification:

```bash
node scripts/verify-identity-vault-tdd.mjs
```

The test currently passes.

## Move to SuperMemory

Arnaud then decided to move the conversation and history to:

```text
/Users/arnaud/Documents/SuperMemory/
```

Future chat/work should continue from this folder.

The repository should become a new Git and GitHub repository.
