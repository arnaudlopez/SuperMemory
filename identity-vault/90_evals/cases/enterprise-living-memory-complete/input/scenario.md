# Input Scenario - Enterprise Living Memory Complete

This is the maximal target scenario for SuperMemory V2.

It is not the current implemented vault state. It defines the final-shaped behavior to build toward.

## Business Context

Arnaud works with Orion Retail on a checkout integration using the Acme Payments API.

The memory system receives mixed enterprise sources:

- API documentation at a stable URL that changes between t0 and t1.
- A contract record overwritten in a business application without explicit versioning.
- A PRD derived from both the API docs and contract.
- A CRM opportunity and stakeholder notes.
- A support escalation.
- An email thread with a new message appended.
- A new marketing strategy introduced at t1, even though no marketing strategy type existed at t0.
- An obsolete pricing sheet that must become `do_not_use`.
- A hostile instruction embedded inside an imported vendor note.
- A support note that conflicts with the updated API docs.
- An API doc excerpt containing a sample secret that must not be promoted.
- A source connector outage while checking the latest contract record.
- A contract subject to legal hold and retention policy.

## Timeline

### t0 - 2026-05-20

- API docs snapshot says checkout webhooks include `risk_score`.
- Contract snapshot says data retention is 30 days.
- PRD draft depends on those two snapshots.
- Orion opportunity is active and belongs to the retail sector.
- No marketing strategy exists yet.

### t1 - 2026-05-27

- Same API doc URL now says `risk_score` is replaced by `trust_score`.
- Same contract record now says data retention is 90 days.
- Support note still mentions `risk_score`, creating a lower-authority conflict.
- Email thread receives a message asking for a launch-readiness draft.
- Marketing uploads a first "checkout recovery strategy" note.
- Old pricing sheet is marked `do_not_use`.
- A later connector check for the contract system fails and must be recorded as `unavailable`, not silently ignored.

## Expected Challenge

SuperMemory must not silently answer from stale memory.

When a source changed event is detected, the system must create a new snapshot and propagate impact before active recall.

It must:

- create new snapshots for changed mutable sources;
- preserve old snapshots;
- mark derived PRD memory `needs_review`;
- re-promote reviewed active memory to Hindsight with the same stable `document_id`;
- create the `marketing_strategy` type as `experimental` only after the t1 source introduces it;
- filter recall by role and sensitivity;
- keep forbidden pricing memory out of active Hindsight recall;
- avoid activating Graphiti or Memoria unless the evals prove Hindsight is insufficient.
- preserve workspace/client isolation and role-based access;
- redact secrets before Hindsight promotion or agent drafts;
- record legal hold and retention metadata;
- answer under uncertainty without pretending stale, conflicting, or unavailable memory is current.
