# Memory Map

## Entry Points

- Professional mode: `20_professional/`
- Personal mode: `30_personal/`
- Shared signals: `10_shared/` and `60_signals/`
- Review mode: `50_review/`
- Hindsight promotion contract: `75_governance/hindsight_contract.md`
- Hindsight promotion logs: `80_logs/hindsight_promotions.jsonl`
- Snapshot registry: `00_inbox/snapshot_registry.md`
- Living memory policy: `75_governance/living_memory.md`
- Access control: `75_governance/access_control.md`
- Answer policy: `75_governance/answer_policy.md`
- Use patterns: `75_governance/use_patterns.md`
- Memory engine ports: `75_governance/memory_engine_ports.md`
- Source freshness policy: `75_governance/source_freshness.md`
- Source change logs: `80_logs/source_changes.jsonl`
- Adaptive ontology: `75_governance/ontology.md`, `75_governance/entity_type_registry.md`, `75_governance/type_lifecycle.md`
- Type proposals: `50_review/type_queue.md`
- Governance: `75_governance/`
- Evaluation: `90_evals/`

## Current Representative Scenario

- Raw meeting: `00_inbox/meetings/2026-05-19-acme-project-y.md`
- External source registry: `00_inbox/source_registry.md`
- Captured PDF excerpt: `00_inbox/documents/2026-05-19-acme-contract-excerpt.md`
- Captured email: `00_inbox/emails/2026-05-19-paul-analytics-proposal.md`
- Raw personal journal: `30_personal/journal/2026-05-19.md`
- Client memory: `20_professional/clients/acme.md`
- Project memory: `20_professional/projects/project-y.md`
- Person memory: `20_professional/people/paul-martin.md`
- Shared availability: `10_shared/availability.md`
- Signals: `60_signals/actions.jsonl`, `60_signals/availability.jsonl`, `60_signals/relationships.jsonl`
- Review queues: `50_review/ambiguity_queue.md`, `50_review/calendar_queue.md`

## Retrieval Escalation

Use Markdown links and indexes as the human-auditable source of truth. Use Hindsight as the adopted memory engine for promoted recall, chunks, observations, temporal context, and retrieval performance.

Do not add custom BM25, embeddings, hybrid retrieval, reranking, or graph/entity infrastructure unless `90_evals/` shows measured failure after the Hindsight prototype.

## Living Memory Rule

Memory is living. Before active use, check whether the relevant memory is fresh, stale, changed, historical, forbidden, or waiting for review.

The governing policy is `75_governance/living_memory.md`.

## Answer And Access Rule

Active answers must respect `75_governance/access_control.md` and `75_governance/answer_policy.md`.

Stale, changed, conflicting, unavailable, restricted, or forbidden memory cannot be presented as current unrestricted truth.

## Use Pattern Rule

Do not hard-code every business use case. Map concrete requests to reusable patterns in `75_governance/use_patterns.md`.

## Engine Port Rule

Hindsight is the default recall engine. Graphiti, Memoria, and capture tools are optional ports, not default dependencies.

Use `75_governance/memory_engine_ports.md` before adding any memory engine.

## Hindsight Promotion Rule

Only governed items may be promoted to Hindsight.

An item is governed when:

- it is captured under `00_inbox/` or compiled in the vault;
- it has source provenance;
- sensitivity and visibility are known;
- connector scope is recorded when applicable;
- blocking ambiguities are resolved or explicitly marked;
- status is not `do_not_use`.

Promotion events are recorded in `80_logs/hindsight_promotions.jsonl`. The exact contract is defined in `75_governance/hindsight_contract.md`.

## Mutable Source Rule

A mutable external source is a pointer, not proof.

Stable proof lives in `00_inbox/snapshot_registry.md`. If the same external reference changes, create a new snapshot, preserve the old one, log the event in `80_logs/source_changes.jsonl`, and mark derived notes stale or `needs_review`.

## Adaptive Type Rule

The vault does not assume all business types exist at t0.

New types are proposed in `50_review/type_queue.md`, defined in `75_governance/entity_type_registry.md`, and governed by `75_governance/type_lifecycle.md`.

Create a type only when a real source or workflow needs the concept to be tracked, retrieved, or governed over time.

## External Source Rule

External files, emails, cloud documents, or web pages are not active memory until captured in `00_inbox/` or recorded in `00_inbox/source_registry.md`.

Connectors such as Gmail, local folders, APIs, MCP tools, or plugins provide bounded source access only. They do not create stable memory until the captured item is registered and compiled.
