# Type Lifecycle

SuperMemory does not assume a complete business ontology at t0.

New business types are created when a real source, workflow, or evaluation failure proves that an existing type is too vague.

## Lifecycle

```text
candidate
  -> experimental
  -> stable | deprecated
```

## Status Definitions

- `candidate`: proposed in `50_review/type_queue.md`; not eligible for active Hindsight promotion.
- `experimental`: eligible for bounded use with explicit review and eval coverage.
- `stable`: eligible for normal vault use, Hindsight promotion, and specialized recall filters.
- `deprecated`: replaced or abandoned; retained for interpreting historical notes.

## Creation Trigger

A new type may be proposed when:

- a captured source introduces a recurring concept not covered by existing types;
- an agent workflow needs to track a concept over time;
- Arnaud explicitly asks to follow a new business concept;
- an eval fails because a concept is too broad or ambiguous.

## Required Definition

Every experimental or stable type must define:

- canonical type name;
- description;
- owner or domain;
- minimal fields;
- allowed source types;
- default visibility and sensitivity;
- allowed consumers;
- Hindsight tags;
- review or eval question.

## Promotion Rule

An experimental type may be promoted to stable only after it has:

- at least one real source-backed example;
- a compiled note or signal shape;
- a recall question in `90_evals/` or a review item in `50_review/`;
- no unresolved permission or sensitivity conflict.

Experimental recall must include both `entity_type:<type>` and `schema_status:experimental` filters. Without those filters, the type is too broad for active recall.

## Rejection Rule

Do not create a type because it might be useful later.

Create it only when a real case must be tracked, retrieved, or governed over time.

## Executable Contract

The local T7 verifier lives at `scripts/verify-adaptive-business-types.mjs`.
It checks the source-backed proposal, candidate block, bounded experimental recall, and stable promotion gate.
