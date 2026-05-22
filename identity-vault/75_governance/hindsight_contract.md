# Hindsight Contract

Hindsight is the adopted memory engine. The vault remains the source of truth.

This contract is the default implementation of the broader engine-port policy in `75_governance/memory_engine_ports.md`.

## Responsibilities

SuperMemory decides:

- which sources may become memory;
- which observations and interpretations are compiled, sensitive, private, historical, or forbidden;
- which connector scope allowed a capture;
- which agents may recall which memory;
- when a source must be revoked, corrected, or deleted from active memory.

Hindsight provides:

- retained documents;
- recall and reflect;
- chunks and source facts;
- observations;
- temporal and graph-like consolidation;
- trace data for failed evals.

The canonical handoff relation is:

```text
ValidatedMemory promotes_to HindsightDocument
HindsightDocument recalled_by Retrieval
Retrieval supports_answer Answer
```

The full object and relation contract lives in `75_governance/sequential_relational_model.md`.

If promoted memory depends on LLM interpretation, the interpretation must already be governed in the vault. Hindsight receives validated memory, not raw unchecked LLM conclusions.

## Promotion Gate

An item may be promoted only when:

- it is a captured raw source or a compiled vault note;
- it has a stable `document_id`;
- provenance is available;
- visibility, sensitivity, domain, status, and consumer tags are known;
- entity type and schema status are known;
- connector id and connector scope are recorded when applicable;
- source snapshot and freshness are known when the item depends on a mutable source;
- interpretation id, confidence, uncertainty, assumptions, alternatives when relevant, use pattern, and review state are known when the item depends on an `InterpretationCandidate`;
- workspace, data owner, access policy, and allowed consumers are known when the item is enterprise memory;
- secrets and restricted fields are redacted or excluded;
- blocking ambiguities are resolved or explicitly queued;
- status is not `do_not_use`.
- schema status is not `candidate`.

The enterprise portion of this gate is executable in `scripts/verify-enterprise-access-secrets-retention.mjs`. Promotion payloads must preserve `workspace_id`, `data_owner`, `access_policy`, and `allowed_consumers`; they must not carry raw secrets or restricted field values.

Default promotion favors compiled notes. Raw sources are promoted only for exact-text retrieval, missing compiled notes, or audit fixtures.

## Minimal Payload

```yaml
bank_id: supermemory-main
document_id: <stable vault id>
content: <governed content>
context: <compiled note, raw capture, or signal>
timestamp: <event date if known>
tags:
  - visibility:<shared|professional|personal|private>
  - sensitivity:<low|medium|high|restricted>
  - domain:<domain>
  - status:<active|historical_only>
  - source_kind:<compiled_view|raw_capture|signal>
  - entity_type:<type>
  - schema_status:<experimental|stable>
  - workspace:<workspace id>
  - access_policy:<policy name>
  - consumer:<allowed agent or mode>
metadata:
  source_id: <source id>
  source_path: <vault source path>
  snapshot_id: <snapshot id if source is external or mutable>
  source_version: <explicit version, connector version, or snapshot capture timestamp>
  interpretation_id: <interpretation id if memory depends on InterpretationCandidate>
  interpretation_confidence: <high|medium|low if applicable>
  interpretation_uncertainty: <known uncertainty or none if applicable>
  use_pattern: <governing use pattern if applicable>
  freshness: <fresh|stale|changed|unavailable|needs_review>
  derived_from: [<snapshot ids if compiled note>]
  compiled_path: <compiled path if any>
  connector_id: <connector id if any>
  connector_scope: <authorized scope if any>
  entity_type_registry: 75_governance/entity_type_registry.md
  workspace_id: <workspace or tenant id if enterprise>
  data_owner: <owning team or person if enterprise>
  access_policy: <policy name>
  allowed_consumers: [<agent or mode>]
  restricted_fields: [<withheld fields>]
  retention_policy: <policy name if applicable>
  legal_hold: <true|false if applicable>
```

## Recall Gate

Agents must not call Hindsight broadly.

Specialized recall must provide restrictive filters for:

- visibility;
- sensitivity;
- domain;
- status;
- entity type;
- schema status;
- workspace;
- access policy;
- consumer.

The default behavior is fail closed: if safe filters cannot be derived, the request returns to the memory agent instead of broad recall.

## Revocation

When a source is corrected or superseded, re-promote with the same stable `document_id`.

When a mutable source changes, create a new snapshot, update derived notes, and re-promote only the reviewed active version. The previous promoted version must become `historical_only` or be replaced by upsert with the same `document_id`.

When a source is marked `do_not_use`, delete the corresponding Hindsight document by default. Keeping `status:do_not_use` in Hindsight is allowed only for temporary tests or migrations.

The vault keeps the proof, revocation reason, and audit trail.

## Logs

Every promotion, replacement, or deletion is recorded in `80_logs/hindsight_promotions.jsonl`.

## Adapter Rule

Before any real Hindsight runtime integration, the adapter must consume only governed `ValidatedMemory` or approved raw audit payloads. It must not auto-retain raw LLM conclusions as stable memory. Adapter traces should preserve whether answer evidence came from direct observation, interpretation, or compiled memory.

The minimal local adapter contract is executable in `scripts/verify-hindsight-adapter-minimal.mjs`. It proves upsert by stable `document_id`, fail-closed recall filters, hard exclusion of `do_not_use`, no global auto-retain, useful recall-miss traces, and rejection of raw LLM conclusions before a real Hindsight runtime is introduced.
