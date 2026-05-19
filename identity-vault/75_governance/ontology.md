# Ontology

## Entity Types

- `client`: organization receiving professional work.
- `person`: individual with aliases, roles, and linked organizations.
- `project`: bounded work stream.
- `action`: task or commitment.
- `relationship_signal`: contextual signal about a relationship or stakeholder state.
- `availability_constraint`: time constraint consumable by calendar/project agents.

## Confidence

- `confirmed`: explicitly stated or confirmed by Arnaud.
- `probable`: inferred from metadata or context.
- `needs_review`: not safe to stabilize.

## Alias Rule

Aliases such as Paul, P. Martin, and sponsor Acme can point to Paul Martin only when source evidence supports the merge.
