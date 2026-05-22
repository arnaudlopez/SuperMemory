# SuperMemory

> Governed, living memory for personal, professional, and enterprise AI agents.

SuperMemory is a local-first memory architecture built around a Markdown/Obsidian vault, explicit governance, immutable source snapshots, and a memory-engine integration layer.

It treats memory as **living**, not static: sources change, facts age, contexts move, permissions matter, and agents must know whether memory is fresh, stale, conflicting, unavailable, restricted, historical, or forbidden.

## Why SuperMemory?

Most AI memory systems optimize retrieval. SuperMemory focuses on the harder question:

> Should this memory be used, by which agent, in which context, with which proof, and under which constraints?

The project separates governance from retrieval:

- **SuperMemory vault**: source of truth, provenance, review, access control, snapshots, policies, evals.
- **Hindsight**: default memory engine for recall, chunks, observations, temporal context, and graph-like consolidation.
- **Optional engine ports**: Graphiti, Memoria, ArchiveBox, Docling, changedetection.io, and others can be added only when evals prove the need.

## Core Features

- **Living memory lifecycle**
  - Tracks memory as `fresh`, `stale`, `changed`, `conflicting`, `unavailable`, `needs_review`, `historical_only`, or `do_not_use`.

- **Governed ingestion**
  - Sources must be captured, authorized, classified, and reviewed before they become active memory.

- **Immutable snapshots for mutable sources**
  - URLs, file paths, CRM records, docs, and email threads are treated as mutable pointers.
  - Captured snapshots are the proof.

- **Source provenance and derived memory**
  - Compiled notes declare `derived_from` snapshot ids.
  - Changed sources mark derived notes stale or `needs_review`.

- **LLM-first interpretation contract**
  - LLMs and memory agents may adapt source-backed observations to unfamiliar requests.
  - Deterministic verifiers check evidence, confidence, uncertainty, use pattern, review state, and governance gates instead of hard-coding one exact interpretation.

- **Hindsight integration contract**
  - Promoted memory carries stable `document_id`, tags, provenance metadata, freshness, source paths, and access policy.

- **Fail-closed agent recall**
  - Specialized agents must query memory with restrictive tags and forbidden-tag rules.

- **Adaptive business ontology**
  - New business types are created only when real sources or workflows require them.
  - Types move through `candidate -> experimental -> stable | deprecated`.

- **Flexible use patterns**
  - SuperMemory does not hard-code every enterprise workflow.
  - Concrete tasks map to reusable patterns such as `external_draft`, `internal_draft`, `decision_support`, `strategic_analysis`, and `audit_and_proof`.

- **Access and answer policies**
  - Workspace boundaries, data owners, restricted fields, secrets, and response uncertainty are handled explicitly.

- **TDD-style fixtures**
  - The repo starts from executable acceptance fixtures instead of abstract architecture alone.

## Architecture

```text
sources
  -> capture gate
  -> immutable snapshots
  -> source-backed observations
  -> LLM-first interpretation candidates
  -> source registry
  -> compiled memory
  -> review queues
  -> governed Hindsight promotion
  -> filtered recall
  -> specialized agents
  -> evals
```

Current vault shape:

```text
identity-vault/
  AGENTS.md
  memory_map.md
  00_inbox/              # captured sources and snapshot registry
  10_shared/             # redacted shared constraints/signals
  20_professional/       # compiled professional memory
  30_personal/           # personal memory
  40_private/            # restricted memory
  50_review/             # ambiguity, stale, permission, action queues
  60_signals/            # typed JSONL signals for agents
  70_agent_contracts/    # agent read/write/action rules
  75_governance/         # policies and contracts
  80_logs/               # source changes and Hindsight promotions
  90_evals/              # golden questions and acceptance cases
```

## Key Concepts

### Living Memory

Memory can become stale, conflicted, unavailable, historical, or forbidden. Agents must adapt their answers instead of pretending every retrieved fact is current.

See [`identity-vault/75_governance/living_memory.md`](identity-vault/75_governance/living_memory.md).

### LLM-First Interpretation

SuperMemory is LLM-first for meaning and deterministic for governance. An `InterpretationCandidate` may phrase the meaning of source-backed observations flexibly, but it must declare evidence, confidence, uncertainty, assumptions, alternatives, a known use pattern, and review state before it can advance to governed memory.

See [`identity-vault/75_governance/interpretation_contract.md`](identity-vault/75_governance/interpretation_contract.md).

### Mutable Sources

External sources are pointers, not proof. A stable URL, file path, CRM id, or email thread can change. SuperMemory captures immutable snapshots and tracks freshness.

See [`identity-vault/75_governance/source_freshness.md`](identity-vault/75_governance/source_freshness.md).

### Engine Ports

Hindsight is the default engine. Other tools are optional ports, not default dependencies:

- Graphiti: temporal graph port.
- Memoria or equivalent: memory versioning/rollback port.
- changedetection.io, urlwatch, ArchiveBox, Docling, DVC, Nango, Airbyte, Meltano: source capture/parsing/sync ports.

See [`identity-vault/75_governance/memory_engine_ports.md`](identity-vault/75_governance/memory_engine_ports.md).

### Minimal Hindsight Adapter Contract

The current adapter proof is local and contractual. It verifies the SuperMemory -> Hindsight boundary before any real runtime integration: governed promotion payloads upsert by stable `document_id`, `do_not_use` deletes or excludes active recall, recall fails closed without scoped tags, raw LLM conclusions are not retained, and recall traces keep answer evidence auditable.

See [`identity-vault/90_evals/cases/hindsight-adapter-minimal`](identity-vault/90_evals/cases/hindsight-adapter-minimal).

### Governed Answer Evidence

Final answers are governed by evidence, not by fluent recall. A `current` answer must cite used memory, document ids, source snapshots, adapter traces when recall-backed, and `supports_answer` relations. Stale, changed, restricted, and forbidden memory must degrade to the matching answer state instead of pretending to be current truth.

See [`identity-vault/90_evals/cases/governed-answer-evidence`](identity-vault/90_evals/cases/governed-answer-evidence).

### Mutable Source Change Contract

Mutable external references are pointers, not proof. The local T5 contract verifies that changed content creates a new immutable snapshot with `previous_snapshot_id`, keeps the old snapshot readable, routes derived memory through `needs_review`, re-promotes the reviewed memory with the same stable `document_id`, and treats unavailable checks as unknown rather than fresh.

See [`identity-vault/90_evals/cases/source-change-t0-t1`](identity-vault/90_evals/cases/source-change-t0-t1).

### Conflict And Unavailable Arbitration

When sources disagree, SuperMemory preserves both facts instead of normalizing the conflict away. The local T6 contract verifies bidirectional `conflicts_with` links, blocks silent winner selection without an explicit reliability rule, requires rule and conflict citation when arbitration is allowed, treats unavailable checks as last-known/unverified, and opens `conflict_queue` for unresolved conflicts.

See [`identity-vault/90_evals/cases/conflict-unavailable-arbitration`](identity-vault/90_evals/cases/conflict-unavailable-arbitration).

### Adaptive Business Types

Business types emerge from real evidence, not speculation. The local T7 contract verifies that `marketing_strategy` is not active at t0, a t1 source can only create a `type_queue` proposal, `candidate` types cannot be promoted active, `experimental` recall is bounded by `schema_status:experimental`, and `stable` requires source plus eval evidence.

See [`identity-vault/90_evals/cases/adaptive-business-types`](identity-vault/90_evals/cases/adaptive-business-types).

### Enterprise Access, Secrets, And Retention

Enterprise memory is deny-by-default. The local T8 contract verifies required `workspace_id`, `access_policy`, `data_owner`, and `allowed_consumers`, rejects secret exposure in promotions or drafts, withholds restricted fields from drafts, and preserves legal-hold evidence while excluding active Hindsight use when required.

See [`identity-vault/90_evals/cases/enterprise-access-secrets-retention`](identity-vault/90_evals/cases/enterprise-access-secrets-retention).

### Use Patterns

The system keeps strict core guardrails but flexible workflows. It maps concrete requests to reusable patterns instead of trying to anticipate every enterprise use case.

See [`identity-vault/75_governance/use_patterns.md`](identity-vault/75_governance/use_patterns.md).

## Quickstart

Requirements:

- Node.js 18+

Run the full spec verification:

```bash
node scripts/verify-supermemory-specs.mjs
```

Run individual checks:

```bash
node scripts/verify-identity-vault-tdd.mjs
node scripts/verify-enterprise-living-memory-target.mjs
node scripts/verify-hindsight-adapter-minimal.mjs
node scripts/verify-governed-answer-evidence.mjs
node scripts/verify-source-change-t0-t1.mjs
node scripts/verify-conflict-unavailable-arbitration.mjs
node scripts/verify-adaptive-business-types.mjs
node scripts/verify-enterprise-access-secrets-retention.mjs
```

Expected output:

```text
PASS acme-meeting-complete
PASS enterprise-living-memory-complete
PASS supermemory specs
```

## Acceptance Fixtures

### `acme-meeting-complete`

The first executable fixture. It proves the initial vault architecture:

- raw notes;
- external source registry;
- captured PDF/email sources;
- compiled client/project/person memory;
- redacted shared availability;
- action signals;
- prompt-injection resistance;
- Hindsight promotion logs;
- governance and eval coverage.

See [`identity-vault/90_evals/cases/acme-meeting-complete/`](identity-vault/90_evals/cases/acme-meeting-complete/).

### `enterprise-living-memory-complete`

The maximal V2 target fixture. It is currently `spec_only` and defines what enterprise readiness should eventually prove:

- mutable API docs;
- overwritten contract records;
- immutable snapshots;
- stale PRD detection;
- source conflicts;
- unavailable connectors;
- secrets redaction;
- legal hold and retention;
- adaptive business types;
- Hindsight promotion;
- optional Graphiti/Memoria engine-port evaluation.

See [`identity-vault/90_evals/cases/enterprise-living-memory-complete/`](identity-vault/90_evals/cases/enterprise-living-memory-complete/).

## Documentation

Start here:

- [`docs/README.md`](docs/README.md) - documentation map and current decision.
- [`docs/audit-memoire-agentique-v2.md`](docs/audit-memoire-agentique-v2.md) - V2 audit and rationale.
- [`docs/prd-memoire-agentique-v2.md`](docs/prd-memoire-agentique-v2.md) - V2 product requirements.
- [`identity-vault/AGENTS.md`](identity-vault/AGENTS.md) - operating rules for agents.
- [`identity-vault/memory_map.md`](identity-vault/memory_map.md) - vault entry points.

Historical context:

- [`docs/audit-memoire-agentique.md`](docs/audit-memoire-agentique.md)
- [`docs/prd-memoire-agentique.md`](docs/prd-memoire-agentique.md)
- [`docs/evaluation-comparative-retrieval-rappel.md`](docs/evaluation-comparative-retrieval-rappel.md)

## Non-Goals

SuperMemory is not trying to be:

- a custom RAG engine;
- a vector database;
- a graph database;
- a generic document management system;
- a replacement for Hindsight;
- an automation system that executes external actions without confirmation.

## Project Status

This repository is currently a **specification-first prototype**.

Implemented:

- vault skeleton;
- governance documents;
- Acme executable fixture;
- enterprise target fixture;
- verification scripts;
- Hindsight promotion contract and logs as local fixtures;
- minimal local Hindsight adapter contract verifier;
- governed answer evidence contract verifier;
- mutable source t0/t1 contract verifier.

Not yet implemented:

- live Hindsight API integration;
- source capture connectors;
- real change detection;
- automated snapshot refresh;
- promptfoo CI runner;
- Graphiti/Memoria ports.

## Roadmap

1. Keep hardening the local Hindsight adapter contract against governed fixtures.
2. Keep hardening governed answer evidence against living-memory states.
3. Keep hardening mutable source-change handling before connector/runtime work.
4. Prototype real Hindsight only after the local adapter, answer, and freshness contracts remain green.
5. Implement vault-to-Hindsight promotion script.
6. Implement source snapshot refresh for mutable sources.
6. Expand toward the enterprise living-memory target.
7. Add optional source-capture tools only when needed.
8. Benchmark Graphiti/Memoria only if Hindsight or the vault snapshot layer fails relevant evals.

## Design Principles

- The vault is the source of truth.
- Retrieval is not authorization.
- A mutable external reference is not proof.
- Stale memory is not current memory.
- Forbidden memory must not be used for active answers.
- New business types emerge from real use, not speculation.
- Concrete workflows map to flexible patterns, not exhaustive hard-coded processes.
- External actions require confirmation.
- Engines are replaceable ports; governance is the product.
