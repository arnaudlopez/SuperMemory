# Ontology

SuperMemory uses an adaptive ontology.

The ontology starts small and evolves only when real sources or real agent workflows need a new concept to be tracked over time.

## Stable Kernel

- `source`: captured evidence with provenance and status.
- `entity`: named thing that can be linked, reviewed, and recalled.
- `fact`: source-backed assertion.
- `signal`: minimal published memory for specialized agents.
- `action`: task, commitment, or external operation candidate.
- `policy`: rule that governs memory or agent behavior.
- `review`: human or agent review item.
- `promotion`: governed transfer into Hindsight.

## Entity Types

- `client`: organization receiving professional work.
- `person`: individual with aliases, roles, and linked organizations.
- `project`: bounded work stream.
- `action`: task or commitment.
- `relationship_signal`: contextual signal about a relationship or stakeholder state.
- `availability_constraint`: time constraint consumable by calendar/project agents.

Additional business types are created through `type_lifecycle.md` and recorded in `entity_type_registry.md`. They are not added speculatively.

## Type Status

- `candidate`: proposed because a real use case needs it.
- `experimental`: usable in bounded cases with review and eval coverage.
- `stable`: accepted for normal vault and Hindsight promotion.
- `deprecated`: replaced or abandoned, retained for historical interpretation.

## Confidence

- `confirmed`: explicitly stated or confirmed by Arnaud.
- `probable`: inferred from metadata or context.
- `needs_review`: not safe to stabilize.

## Alias Rule

Aliases such as Paul, P. Martin, and sponsor Acme can point to Paul Martin only when source evidence supports the merge.

## Creation Rule

A new entity type must have:

- a concrete source or workflow trigger;
- a minimal field set;
- default sensitivity and visibility;
- allowed consumers;
- Hindsight tags;
- at least one eval or review question.
