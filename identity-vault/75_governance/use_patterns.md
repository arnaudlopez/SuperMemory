# Use Patterns

SuperMemory does not try to anticipate every business use case.

It keeps strict guardrails for the memory core, then lets concrete workflows emerge through a small set of flexible use patterns.

## Stable Core

The core is strict:

- source capture;
- immutable snapshots for mutable sources;
- provenance;
- freshness;
- status;
- access policy;
- answer policy;
- `do_not_use`;
- external-action confirmation.

## Flexible Patterns

Concrete use cases should map to one of these patterns instead of becoming hard-coded workflows.

| Pattern | Examples | Key Checks |
| --- | --- | --- |
| External draft | client email, RFP answer, partner reply | current memory, access policy, restricted fields, confirmation before send |
| Internal draft | PRD, strategy note, postmortem, meeting recap | source coverage, freshness, conflicts, owner review |
| Decision support | roadmap arbitration, pricing exception, contract interpretation | source reliability, conflict status, legal/owner review |
| Interaction brief | client call brief, QBR prep, stakeholder history | current facts, relationship signals, do-not-mention constraints |
| Strategic analysis | market strategy, account plan, segmentation, competitive synthesis | experimental types allowed only with confidence and provenance |
| Audit and proof | why an answer was given, which snapshot supports a claim | source_id, snapshot_id, derived_from, logs |
| External system update | CRM update, calendar action, email send, ticket update | explicit confirmation, narrow payload, rollback or correction path |

External sends and system updates must create or reference an `action_confirmation_queue` item before execution.

## Rule

Do not create a detailed workflow for every possible business request.

Create or refine a pattern only when repeated real usage shows the existing patterns are too vague.

## Executable Contract

The local T10 verifier lives at `scripts/verify-agent-use-patterns.mjs`.
It checks that enterprise requests map to known reusable patterns with evidence, filters, snapshots, review gates, and confirmation gates where required.

## Pattern Test

Every new workflow should answer:

- Which pattern does it use?
- What sources are allowed?
- How fresh must the memory be?
- Which agent or consumer may use it?
- What output is allowed?
- Does it require confirmation?
- What happens if memory is stale, restricted, conflicting, or unavailable?
