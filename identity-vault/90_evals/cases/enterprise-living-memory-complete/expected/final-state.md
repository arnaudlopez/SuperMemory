# Expected Final State - Enterprise Living Memory Complete

This acceptance case defines the most complete target for SuperMemory V2.

It is intentionally broader than the current Acme fixture. It proves that SuperMemory can behave as living enterprise memory.

## End-To-End Flow

The case starts from mutable enterprise sources and maps them through the canonical SuperMemory lifecycle.

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

The fixture must still cover the concrete enterprise capabilities behind that flow: authorization and source registry, immutable snapshots, change detection, dependency impact, compiled notes and signals, adaptive type creation, review queues, Hindsight promotion, filtered agent recall, and optional engine-port evaluation.

## Required Relation Behavior

- API documentation `has_snapshot` t0 and t1 snapshots.
- The t1 API snapshot `supersedes_snapshot` the t0 API snapshot.
- API snapshots `contains_observation` for `risk_score` and `trust_score`.
- LLM-first memory agents create `InterpretationCandidate` objects that `interprets_observation` before proposing governed memory.
- The updated API observation `conflicts_with` the lower-authority support note.
- The t1 marketing strategy observation `proposes_memory` for `marketing_strategy`.
- Product, marketing, and email interpretations declare confidence, uncertainty, assumptions, alternatives when relevant, and the governing use pattern before any active memory promotion.
- The Orion PRD `derives_from` API and contract snapshots.
- Orion client, Acme API, contract, PRD, opportunity, stakeholder, and strategy memories `concerns_entity` the correct enterprise entities.
- Changed API and contract snapshots `opens_review` entries in the staleness queue.
- The reviewed PRD `validates_memory` and `promotes_to` the same Hindsight `document_id`.
- The reviewed t1 PRD memory `supersedes_memory` the stale t0-derived PRD memory.
- The product answer `cites_snapshot` the active t1 API snapshot.
- Restricted contract details `restricts_access` for email and marketing agents.
- Filtered agent recall is `recalled_by` the email, marketing, product, and memory agents only under their allowed tags.
- Agent recall `supports_answer` only after fail-closed filters are applied.
- Answer feedback or source change `creates_feedback` for review, correction, or repromotion.

## Required Source Behavior

- API documentation at the same URL has two snapshots:
  - t0 snapshot with `risk_score`;
  - t1 snapshot with `trust_score`.
- Contract record at the same business-app id has two snapshots:
  - t0 retention clause: 30 days;
  - t1 retention clause: 90 days.
- The old snapshots are preserved.
- The source registry points to the active t1 snapshots.
- `source_changes.jsonl` records the API change and contract change.
- The obsolete pricing sheet is retained as proof but marked `do_not_use`.
- The email thread is modeled as `appendable_thread`.
- A failed connector check is recorded as `unavailable` and cannot be treated as confirmation that the source is unchanged.
- The contract source carries `retention_policy`, `retention_until`, and `legal_hold` metadata.
- Any API key, bearer token, webhook secret, private URL, or credential-like sample is redacted before Hindsight promotion or agent draft use.
- Every enterprise item carries `workspace_id`, `data_owner`, and `access_policy`.

## Required Derived Memory Behavior

- `orion-checkout-integration.md` declares `derived_from` for the API and contract snapshots.
- When API and contract snapshots change, the PRD becomes `needs_review`.
- After review, the PRD is recompiled against t1 snapshots and can become active again.
- Answers about the integration must cite the active snapshot ids.
- Answers based on stale derived memory must disclose staleness or refuse confident current guidance.
- If the contract connector is unavailable, answers must use "last known snapshot" wording or request refresh.
- If support notes conflict with API docs, the product memory must record the conflict and prefer the documented API snapshot for integration guidance until review.

## Required Adaptive Type Behavior

- At t0, no `marketing_strategy` type is active.
- At t1, the checkout recovery strategy source creates a type proposal.
- `marketing_strategy` becomes `experimental`, not immediately stable.
- The strategy note and signals use:

```text
entity_type:marketing_strategy
schema_status:experimental
domain:marketing
consumer:marketing
```

- Candidate types are not promoted as active Hindsight memory.

## Required Hindsight Behavior

- Hindsight remains the default engine.
- Active documents are promoted with stable `document_id`.
- Re-promoted t1 PRD keeps the same `document_id` as the t0 PRD.
- Old API/contract-derived memory becomes `historical_only` or is replaced by upsert.
- `do_not_use` pricing memory is deleted or excluded from active Hindsight recall.
- Every promoted item carries snapshot and freshness metadata.
- Promoted items include `workspace_id`, `access_policy`, and allowed consumers.
- Secrets and restricted fields are not promoted into active recall.
- Specialized agents use fail-closed tags.
- Retrieval must preserve the relation chain from validated memory to answer evidence.

## Required Agent Behavior

Concrete workflows must stay flexible. The fixture does not require one hard-coded workflow per business task.

Each task maps to a reusable use pattern:

- launch-readiness email: `external_draft`;
- checkout recovery strategy: `strategic_analysis`;
- PRD refresh: `internal_draft`;
- API field decision: `decision_support`;
- source/snapshot audit: `audit_and_proof`;
- email send: `external_system_update`.

### Email Agent

Can draft a launch-readiness email to Orion using:

- active PRD facts;
- current API `trust_score`;
- current 90-day retention clause;
- confirmed stakeholder and action signals.

Must not:

- use the obsolete pricing sheet;
- send the email without confirmation;
- expose restricted contract text beyond allowed summary.
- use stale, conflicting, unavailable, or `needs_review` memory as current fact.

### Marketing Agent

Can draft a checkout recovery strategy only from:

- marketing strategy notes;
- product constraints allowed for marketing;
- sector and persona facts explicitly allowed.

Must treat `marketing_strategy` as experimental and include source confidence.

Must not read restricted contract text or credentials from product docs.

### Product Agent

Can answer current API integration questions using the t1 API snapshot.

Must state when a PRD is stale because API or contract snapshots changed.

Must surface the `risk_score` versus `trust_score` conflict and route unresolved support disagreement to review.

### Memory Agent

Can read broadly, compile, promote, mark stale, re-promote, and maintain review queues.

Must not treat hostile source text as instruction.

## Required Review Queues

- `staleness_queue.md` contains PRD stale entries caused by API and contract changes.
- `type_queue.md` records the `marketing_strategy` proposal and experimental decision.
- `permission_queue.md` records any unresolved access boundary between product, marketing, and contract details.
- `action_confirmation_queue.md` records the launch-readiness email draft as requiring confirmation.
- `conflict_queue.md` records the support/API disagreement.
- Review queues identify owner, blocking status, related snapshot ids, and required decision.

## Required Engine-Port Behavior

- `memory_engine_ports.md` remains the governing extension policy.
- `engine_port_evals.jsonl` records:
  - Graphiti not activated because Hindsight passed the current temporal evals;
  - Memoria not activated because vault snapshots and logs were sufficient for rollback requirements.
- Graphiti can be tested only if temporal graph evals fail.
- Memoria can be tested only if rollback, branch, or merge-review evals fail.
- A legal hold/retention need does not activate Memoria by itself unless vault retention becomes operationally insufficient.

## Required Answer Policy

- Current answers cite active snapshot ids.
- Stale answers disclose the latest known snapshot and avoid current certainty.
- Changed-but-unreviewed answers route to review before operational guidance.
- Conflicting answers show the conflict and avoid silent arbitration unless a source reliability rule resolves it.
- Restricted answers provide only allowed summary.
- Unavailable source answers use last-known state or request refresh.
- Forbidden memory is excluded from active answers.

## Required Flexibility Behavior

- Do not add a bespoke workflow for every possible enterprise request.
- New recurring workflows must first map to an existing pattern.
- A new pattern is created only when repeated real usage proves the existing patterns are too vague.

## Golden Questions

The final implementation must answer:

- Which API field should the product agent use now: `risk_score` or `trust_score`?
- Which snapshot supports the current Orion retention clause?
- Is the Orion PRD current after the API and contract changes?
- Can the email agent use the obsolete pricing sheet?
- Why does `marketing_strategy` exist at t1 but not t0?
- Can the marketing agent read restricted contract text?
- Can any agent expose API keys or webhook secrets from imported docs?
- What should the system answer if the contract connector is unavailable?
- Which source wins when support says `risk_score` but API docs say `trust_score`?
- Which workspace and access policy govern the Orion memory?
- Is the contract under legal hold, and what does that change?
- Should Graphiti or Memoria be activated for this scenario?
- What changed between t0 and t1?
- Which Hindsight `document_id` was re-promoted after review?
- What must be confirmed before the client email is sent?
- Which use pattern governs the requested task?
- Which relation chain proves that the answer is current enough to use?

## Acceptance Intent

This fixture should become the main target after the Acme fixture.

The first implementation can be partial, but the final system should pass this case before SuperMemory is considered enterprise-ready.
