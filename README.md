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
  - SuperMemory keeps rich internal metadata, while the Hindsight transport serializes metadata values to strings before mock or live API calls.

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

The executable T11 proof records `identity-vault/80_logs/engine_port_evals.jsonl` and verifies that Graphiti and Memoria stay `not_activated` while existing Hindsight and vault snapshot evals pass:

```bash
node scripts/verify-engine-port-evals.mjs
```

### Minimal Hindsight Adapter Contract

The current adapter proof is local and contractual. It verifies the SuperMemory -> Hindsight boundary before any real runtime integration: governed promotion payloads upsert by stable `document_id`, `do_not_use` deletes or excludes active recall, recall fails closed without scoped tags, raw LLM conclusions are not retained, and recall traces keep answer evidence auditable.

See [`identity-vault/90_evals/cases/hindsight-adapter-minimal`](identity-vault/90_evals/cases/hindsight-adapter-minimal).

### Governed Answer Evidence

Final answers are governed by evidence, not by fluent recall. A `current` answer must cite used memory, document ids, source snapshots, adapter traces when recall-backed, and `supports_answer` relations. Stale, changed, restricted, and forbidden memory must degrade to the matching answer state instead of pretending to be current truth.

See [`identity-vault/90_evals/cases/governed-answer-evidence`](identity-vault/90_evals/cases/governed-answer-evidence).

### Mutable Source Change Contract

Mutable external references are pointers, not proof. The local T5 contract verifies that changed content creates a new immutable snapshot with `previous_snapshot_id`, keeps the old snapshot readable, routes derived memory through `needs_review`, re-promotes the reviewed memory with the same stable `document_id`, and treats unavailable checks as unknown rather than fresh.

See [`identity-vault/90_evals/cases/source-change-t0-t1`](identity-vault/90_evals/cases/source-change-t0-t1).

### Local Manual Source Capture

The first concrete ingestion proof is local and manual, not a crawler. The fixture verifies that one owner-confirmed local source can produce one governed source registry entry and one immutable snapshot, while scope escapes, missing owner intent, missing snapshot proof, executable source instructions, leaked secrets, and `do_not_use` captures fail closed.

See [`identity-vault/90_evals/cases/local-manual-source-capture`](identity-vault/90_evals/cases/local-manual-source-capture).

The operator dry-run command reads exactly one selected local file and prints a source/snapshot plan without writing to the vault:

```bash
node scripts/local-manual-capture.mjs --file /path/to/source.md --scope /path/to/ --workspace workspace:example --requested-by owner:name --capture-reason "manual evidence" --json
```

Add `--write-plan /path/to/plan.json` to persist the dry-run plan outside the vault for review.

Apply a reviewed plan to a staging directory, still outside the vault:

```bash
node scripts/local-manual-capture.mjs --apply-plan /path/to/plan.json --out-dir /path/to/staging --json
```

The apply step writes reviewable JSON artifacts only, refuses plans with validation errors, and blocks direct writes under `identity-vault`.

Commit reviewed staging into the final vault registries only with explicit owner confirmation:

```bash
node scripts/local-manual-capture.mjs --commit-staging /path/to/staging --vault-root identity-vault --owner-confirmed --json
```

The commit step updates only `00_inbox/source_registry.md` and `00_inbox/snapshot_registry.md`, refuses duplicate source or snapshot ids, and does not create compiled memory or Hindsight promotions.

Run the full local operator workflow smoke without touching the real vault:

```bash
node scripts/verify-local-manual-capture-workflow.mjs
```

### Local File Source Refresh

Registered mutable `local_file` sources can be refresh-checked through an explicit connector registry without scanning neighboring files or mutating the vault. The command reads only the selected source ref when it is active and available, emits changed/unchanged/unavailable/`do_not_use` plans, and keeps raw source text out of stdout and persisted artifacts.

```bash
node scripts/local-file-source-refresh.mjs --input /path/to/registry.json --source-id source:example --write-plan /path/to/refresh-plan.json --json
```

Apply a reviewed refresh plan to a staging directory, still outside the vault:

```bash
node scripts/local-file-source-refresh.mjs --apply-plan /path/to/refresh-plan.json --out-dir /path/to/staging --json
```

The staging step writes connector evidence, refresh candidates/plans, snapshot candidates, review items, and a manifest as JSON only. It refuses invalid plans, raw-content-like fields, malformed changed-source lineage, non-empty promotion payloads, non-empty staging directories, and direct writes under `identity-vault`.

Commit reviewed changed-source refresh staging into the final vault registries only with explicit owner confirmation:

```bash
node scripts/local-file-source-refresh.mjs --commit-staging /path/to/staging --vault-root identity-vault --owner-confirmed --json
```

The commit step updates only `00_inbox/source_registry.md` and `00_inbox/snapshot_registry.md`, refuses incomplete or tampered staging, duplicate snapshot ids, unavailable or `do_not_use` staging, and does not create compiled memory or Hindsight promotions.

### Conflict And Unavailable Arbitration

When sources disagree, SuperMemory preserves both facts instead of normalizing the conflict away. The local T6 contract verifies bidirectional `conflicts_with` links, blocks silent winner selection without an explicit reliability rule, requires rule and conflict citation when arbitration is allowed, treats unavailable checks as last-known/unverified, and opens `conflict_queue` for unresolved conflicts.

See [`identity-vault/90_evals/cases/conflict-unavailable-arbitration`](identity-vault/90_evals/cases/conflict-unavailable-arbitration).

### Adaptive Business Types

Business types emerge from real evidence, not speculation. The local T7 contract verifies that `marketing_strategy` is not active at t0, a t1 source can only create a `type_queue` proposal, `candidate` types cannot be promoted active, `experimental` recall is bounded by `schema_status:experimental`, and `stable` requires source plus eval evidence.

See [`identity-vault/90_evals/cases/adaptive-business-types`](identity-vault/90_evals/cases/adaptive-business-types).

### Enterprise Access, Secrets, And Retention

Enterprise memory is deny-by-default. The local T8 contract verifies required `workspace_id`, `access_policy`, `data_owner`, and `allowed_consumers`, rejects secret exposure in promotions or drafts, withholds restricted fields from drafts, and preserves legal-hold evidence while excluding active Hindsight use when required.

See [`identity-vault/90_evals/cases/enterprise-access-secrets-retention`](identity-vault/90_evals/cases/enterprise-access-secrets-retention).

### Review Queues And External Actions

Critical ambiguity becomes explicit review work. The local T9 contract verifies that changed memory opens `staleness_queue`, unresolved conflicts open `conflict_queue`, new type proposals open `type_queue`, unclear restricted access opens `permission_queue`, and external email send stays drafted until `action_confirmation_queue` confirmation.

See [`identity-vault/90_evals/cases/review-queues-actions`](identity-vault/90_evals/cases/review-queues-actions).

### Agent Use Patterns

Agents stay flexible without inventing one-off workflows. The local T10 contract verifies that enterprise requests map to `external_draft`, `internal_draft`, `decision_support`, `strategic_analysis`, `audit_and_proof`, or `external_system_update`, with required evidence, filters, review gates, snapshots, experimental type status, and action confirmation.

See [`identity-vault/90_evals/cases/agent-use-patterns`](identity-vault/90_evals/cases/agent-use-patterns).

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
node scripts/verify-local-manual-source-capture.mjs
node scripts/verify-local-manual-capture-workflow.mjs
node --test tests/local-manual-capture-cli.test.mjs
node --test tests/local-file-source-refresh-cli.test.mjs
node scripts/verify-local-file-source-refresh-workflow.mjs
node scripts/verify-source-change-t0-t1.mjs
node scripts/verify-conflict-unavailable-arbitration.mjs
node scripts/verify-adaptive-business-types.mjs
node scripts/verify-enterprise-access-secrets-retention.mjs
node scripts/verify-review-queues-actions.mjs
node scripts/verify-agent-use-patterns.mjs
node scripts/verify-engine-port-evals.mjs
node scripts/verify-enterprise-living-memory-partial.mjs
node scripts/verify-enterprise-living-memory-complete.mjs
node scripts/verify-ci-regression-suite.mjs
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

### `enterprise-living-memory-partial`

The first executable Orion enterprise slice. It proves the source/snapshot/change/recall/answer core without claiming the full Golden Case is done:

- API docs change from `risk_score` to `trust_score`;
- contract retention changes from 30 to 90 days with legal metadata recorded;
- t0-derived PRD memory becomes `needs_review`, then a reviewed t1 PRD becomes active;
- Hindsight re-promotion keeps the same `document_id`;
- obsolete pricing is `do_not_use` and excluded from active recall;
- core answers cite snapshots and evidence.

Run:

```bash
node scripts/verify-enterprise-living-memory-partial.mjs
```

See [`identity-vault/90_evals/cases/enterprise-living-memory-partial/`](identity-vault/90_evals/cases/enterprise-living-memory-partial/).

### `enterprise-living-memory-complete`

The complete executable Orion enterprise Golden Case. Its expected files still define the target, and `actual/fixture.json` proves the full behavior locally:

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
- optional Graphiti/Memoria engine-port evaluation;
- all Golden Questions with source-backed relation chains;
- agent-scope, review-queue, secret-redaction, and use-pattern checks.

Run:

```bash
node scripts/verify-enterprise-living-memory-complete.mjs
```

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
- executable T11 engine-port eval contract for Graphiti/Memoria activation decisions;
- executable T12 partial enterprise living-memory contract;
- executable T13 complete enterprise Golden Case contract;
- executable T14 CI regression suite and GitHub Actions workflow;
- minimal local Hindsight adapter contract verifier;
- governed answer evidence contract verifier;
- mutable source t0/t1 contract verifier;
- local manual source capture contract verifier;
- source snapshot refresh preflight contract verifier;
- source refresh connector-boundary contract verifier;
- first concrete local-file source refresh CLI and verifier.

Not yet implemented:

- live Hindsight API integration;
- automated external source capture connectors;
- real external connector-backed change detection;
- automated remote snapshot refresh;
- promptfoo reporting layer, if the Node evals become too hard to read manually;
- Graphiti/Memoria ports.

## Roadmap

1. Keep the T0-T14 executable specification green in CI.
2. Prepare the runtime preflight for vault-to-Hindsight promotion with dry-run behavior.
3. Implement the real promotion script only after the local adapter, answer, and freshness contracts remain green.
4. Promote the local/manual capture contract into an operator-facing dry-run command.
5. Harden connector-backed snapshot refresh beyond the first local-file source type.
6. Add the first automated external source connector only when a concrete source workflow requires it.
7. Add promptfoo only as an optional reporting layer if the Node eval output becomes too hard to inspect.
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
