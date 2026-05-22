# Memory Engine Ports

SuperMemory owns the living memory protocol. Engines are implementation ports.

## Default Engine

Hindsight is the default recall engine for V2.

It handles:

- retain and recall;
- chunks and source facts;
- observations;
- temporal and graph-like retrieval;
- trace data for failed evals;
- document replacement and deletion through stable `document_id`.

## Stable SuperMemory Contract

Every engine integration must preserve:

- `document_id`
- `source_id`
- `snapshot_id`
- `derived_from`
- `freshness`
- `status`
- `visibility`
- `sensitivity`
- `entity_type`
- `schema_status`
- `consumer`
- `workspace_id`
- `access_policy`
- `retention_policy`
- source path or compiled path
- deletion or historical-only behavior for revoked memory

The vault remains the source of truth even when an engine stores its own graph, observations, facts, or indexes.

## Extension Ports

### Temporal Graph Port

Candidate engine: Graphiti.

Activate only if Hindsight fails evals involving:

- complex temporal relationships;
- as-of questions;
- relation changes over time;
- contradiction invalidation across many sources;
- explicit graph traversal needs.

Example eval triggers:

- "What was true when the contract was signed?"
- "Which client assumptions were invalidated after the QBR?"
- "How did this stakeholder relationship change over the last quarter?"

### Memory Versioning Port

Candidate engine: Memoria or equivalent versioned memory backend.

Activate only if the vault snapshot layer becomes insufficient for:

- rollback;
- branches;
- merge review;
- alternate memory experiments;
- complete mutation provenance across many agents;
- legal hold or retention workflows that the vault cannot manage simply.

Example eval triggers:

- "Rollback the memory state before this bad import."
- "Compare the active memory branch with a proposed corrected branch."
- "Audit every mutation that changed this client memory."

### Source Capture Port

Candidate engines: changedetection.io, urlwatch, ArchiveBox, Docling, DVC, Nango, Airbyte, Meltano.

Activate only for concrete capture, parsing, change detection, connector, or large snapshot storage needs.

These tools may capture or detect changes, but they do not decide memory governance.

## Activation Rule

Do not add an engine because it is powerful.

Add an engine when:

- an eval fails or an operational burden is proven;
- the failure is reproducible in `90_evals/` or logged as an operational incident;
- the engine reduces SuperMemory code instead of duplicating Hindsight;
- the integration preserves the stable SuperMemory contract;
- rollback and removal are possible without losing vault truth.

Every activation decision must be recorded in `80_logs/engine_port_evals.jsonl` and remain reproducible by:

```bash
node scripts/verify-engine-port-evals.mjs
```

Current governed decisions:

- Graphiti is `not_activated` while Hindsight passes the current temporal evals.
- Memoria is `not_activated` while vault snapshots and logs cover rollback and audit.
- A red eval may create a `candidate_port`, but does not grant source-of-truth authority.

## Rejection Rule

If a candidate engine requires making it the source of truth for permissions, revocation, source freshness, or agent contracts, reject the integration.
