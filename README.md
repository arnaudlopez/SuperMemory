# SuperMemory

SuperMemory is a local-first Markdown memory system for building a governed personal and professional agentic memory.

The project starts from a TDD fixture rather than an empty architecture. The first scenario proves the intended flow:

```text
raw notes
  -> compiled memory
  -> redacted shared signals
  -> review queues
  -> agent contracts
  -> governance
  -> evals
```

## Start Here

- `docs/README.md` - documentation map and current decision.
- `docs/audit-memoire-agentique.md` - reasoning, risks, governance, academic research themes.
- `docs/prd-memoire-agentique.md` - product requirements and target architecture.
- `docs/evaluation-comparative-retrieval-rappel.md` - retrieval/RAG benchmark comparison.
- `CHAT_HISTORY.md` - conversation-derived history and continuity notes.

## Test

Run:

```bash
node scripts/verify-identity-vault-tdd.mjs
```

Expected result:

```text
PASS acme-meeting-complete
```

## Current Architecture

```text
identity-vault/
  AGENTS.md
  memory_map.md
  00_inbox/
  10_shared/
  20_professional/
  30_personal/
  40_private/
  50_review/
  60_signals/
  70_agent_contracts/
  75_governance/
  80_logs/
  90_evals/
```

## Principle

The vault is the source of truth. RAG, BM25, graph/entity resolution, and other retrieval systems are future layers that must be justified by evaluation failures, not added by default.
