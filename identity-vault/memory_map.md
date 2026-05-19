# Memory Map

## Entry Points

- Professional mode: `20_professional/`
- Personal mode: `30_personal/`
- Shared signals: `10_shared/` and `60_signals/`
- Review mode: `50_review/`
- Governance: `75_governance/`
- Evaluation: `90_evals/`

## Current Representative Scenario

- Raw meeting: `00_inbox/meetings/2026-05-19-acme-project-y.md`
- Raw personal journal: `30_personal/journal/2026-05-19.md`
- Client memory: `20_professional/clients/acme.md`
- Project memory: `20_professional/projects/project-y.md`
- Person memory: `20_professional/people/paul-martin.md`
- Shared availability: `10_shared/availability.md`
- Signals: `60_signals/actions.jsonl`, `60_signals/availability.jsonl`, `60_signals/relationships.jsonl`
- Review queues: `50_review/ambiguity_queue.md`, `50_review/calendar_queue.md`

## Retrieval Escalation

Use Markdown links and indexes first. Add BM25, embeddings, hybrid retrieval, reranking, or graph/entity resolution only when `90_evals/` shows measured failure.
