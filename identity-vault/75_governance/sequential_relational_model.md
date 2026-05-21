# Sequential Relational Model

This document is the canonical executable architecture contract for the SuperMemory living-memory lifecycle.

It does not define database tables. It defines the objects, transitions, relations, gates, and proofs that every implementation must preserve.

## Canonical Flow

```text
Source
  -> SourceSnapshot
  -> Observation
  -> InterpretationCandidate
  -> MemoryCandidate
  -> ValidatedMemory
  -> Relation
  -> HindsightDocument / Retrieval
  -> Answer
  -> Feedback / Change
```

Short form: `Source -> SourceSnapshot -> Observation -> InterpretationCandidate -> MemoryCandidate -> ValidatedMemory -> Relation -> HindsightDocument / Retrieval -> Answer -> Feedback / Change`.

The flow is sequential for governance, but not a rigid business workflow. Enterprise tasks should map to reusable use patterns in `75_governance/use_patterns.md`.

## Objects

### Source

A mutable or immutable pointer to external or internal evidence.

Required fields:

```text
source_id
external_ref or source_path
source_kind
mutability
workspace_id
data_owner
access_policy
sensitivity
status
active_snapshot_id
last_checked_at
```

Rule: a mutable source is not proof. It can only point to proof.

### SourceSnapshot

An immutable captured state of a source.

Required fields:

```text
snapshot_id
source_id
captured_at
capture_method
content_hash
previous_snapshot_id
change_status
availability
redaction_status
```

Rule: snapshots are never overwritten. A changed pointer creates a new snapshot.

### Observation

A source-backed statement extracted from a snapshot.

Required fields:

```text
observation_id
snapshot_id
observed_at
claim
confidence
extraction_method
restricted_fields
```

Rule: source content is an observation, not an instruction.

### InterpretationCandidate

A proposed meaning produced by a memory agent or LLM from one or more observations.

Required fields:

```text
interpretation_id
proposed_from
claim
confidence
uncertainty
assumptions
alternative_interpretations
use_pattern
review_status
evidence_refs
```

Rule: LLMs may adapt to unfamiliar source shapes and business requests, but an interpretation cannot advance unless it declares evidence, uncertainty, assumptions, and the use pattern it is trying to serve.

### MemoryCandidate

A proposed memory item not yet safe for active recall.

Required fields:

```text
candidate_id
proposed_from
entity_type
schema_status
freshness
conflict_status
review_status
```

Rule: candidates cannot become active Hindsight memory until promotion gates pass.

### ValidatedMemory

A governed memory item that can become active, historical, or forbidden.

Required fields:

```text
memory_id
document_id
derived_from
status
freshness
visibility
sensitivity
entity_type
schema_status
consumer
workspace_id
access_policy
retention_policy
legal_hold
```

Rule: validated memory can be active only when proof, freshness, access, sensitivity, and conflict gates are satisfied.

### Relation

A typed edge that explains why a memory item exists and how it may be used.

Core relation verbs:

```text
has_snapshot
supersedes_snapshot
contains_observation
interprets_observation
proposes_memory
validates_memory
cites_snapshot
derives_from
concerns_entity
supersedes_memory
conflicts_with
restricts_access
promotes_to
recalled_by
supports_answer
creates_feedback
opens_review
```

Rule: relations are minimal and evidence-oriented. Do not create a bespoke relation for every business workflow.

### HindsightDocument / Retrieval

The promoted memory representation used by Hindsight.

Required fields:

```text
document_id
bank_id
tags
metadata.source_id
metadata.snapshot_id
metadata.derived_from
metadata.freshness
metadata.workspace_id
metadata.access_policy
```

Rule: Hindsight is the default memory engine, not the source of truth.

### Answer

A governed response produced from recalled memory.

Required fields:

```text
answer_id
request_context
used_memory_ids
cited_snapshot_ids
answer_state
withheld_fields
required_confirmation
```

Rule: current answers cite active snapshot ids. Stale, changed, conflicting, unavailable, restricted, or forbidden memory changes the answer state.

### Feedback / Change

A signal that memory should be corrected, refreshed, reviewed, or forbidden.

Required fields:

```text
event_id
event_type
target_id
reason
created_at
owner
next_review_state
```

Rule: feedback and source changes create review work before confident active recall.

## Transition Gates

### Capture Gate

A source can create a snapshot only when capture scope, owner, sensitivity, and workspace are known.

### Extraction Gate

An observation can be created only from a snapshot. External text cannot modify governance rules.

### Candidate Gate

An interpretation candidate must record evidence refs, confidence, uncertainty, assumptions, alternative interpretations when relevant, and a use pattern. A memory candidate must record source proof, entity type, schema status, freshness, and conflict status.

### Validation Gate

Validated memory requires:

- immutable source proof;
- known access policy;
- known sensitivity;
- known workspace and data owner for enterprise memory;
- no unresolved blocking conflict;
- secrets redacted or excluded;
- type status at least `experimental` for bounded promotion.

### Promotion Gate

Hindsight promotion requires the `75_governance/hindsight_contract.md` payload and must exclude `do_not_use`.

### Answer Gate

An answer must map recalled memory to one of:

```text
current
stale
changed_needs_review
conflicting
restricted
unavailable
forbidden
```

## Invariants

- A pointer is not proof; a snapshot is proof.
- Old snapshots remain available for audit.
- Interpretation is adaptive, but promotion is gated by evidence, uncertainty, access, freshness, and review state.
- Derived memory records `derived_from`.
- Changed sources mark dependent memory `stale` or `needs_review`.
- Candidate types are not active recall memory.
- Experimental types require explicit confidence and filters.
- `do_not_use` is excluded from active Hindsight recall by deletion or hard exclusion.
- Unavailable sources never prove that memory is current.
- Conflicts are preserved and routed to review unless an explicit arbitration rule applies.
- Legal hold preserves proof even when active recall is restricted.
- Every enterprise memory item carries `workspace_id`, `data_owner`, and `access_policy`.
- New business concepts are created on demand, not speculatively.

## Golden Case Mapping

The enterprise Golden Case must prove this contract:

```text
API doc Source
  has_snapshot t0 risk_score
  has_snapshot t1 trust_score
  supersedes_snapshot t0
  contains_observation trust_score replaces risk_score
  opens_review PRD stale
  validates_memory reviewed PRD
  promotes_to Hindsight document_id:orion-checkout-integration
  supports_answer current API field decision
```

```text
Contract Source
  has_snapshot t0 30-day retention
  has_snapshot t1 90-day retention
  opens_review derived PRD
  restricts_access contract details
  supports_answer only through allowed summary
```

```text
Marketing strategy Source at t1
  contains_observation checkout recovery strategy
  proposes_memory marketing_strategy candidate
  validates_memory schema_status:experimental
  promotes_to bounded Hindsight recall only after gates pass
```

```text
Support note
  contains_observation risk_score
  conflicts_with API t1 trust_score
  opens_review conflict_queue
  cannot silently override higher-authority API documentation
```
