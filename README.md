# SuperMemory

[![SuperMemory Specs](https://github.com/arnaudlopez/SuperMemory/actions/workflows/supermemory-specs.yml/badge.svg)](https://github.com/arnaudlopez/SuperMemory/actions/workflows/supermemory-specs.yml)
![Node.js](https://img.shields.io/badge/Node.js-18%20%7C%2022-339933?logo=nodedotjs&logoColor=white)
![Runtime](https://img.shields.io/badge/runtime-local--first-2563eb)
![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)

> Governed, living memory for personal, professional, and enterprise AI agents.

SuperMemory is a production-shaped, local-first memory product that makes AI memory **traceable, auditable, revocable, recoverable, and safe to use**. It combines a local web application, a Markdown/Obsidian-compatible vault, immutable source snapshots, deterministic automatic admission, exceptional review, verified backups, and a Hindsight-backed recall layer.

Most memory systems ask, “What can we retrieve?” SuperMemory asks the harder questions:

- Should this information be memory at all?
- Which source and snapshot prove it?
- Is it still fresh, or has the source changed?
- Which workspace, agent, and use pattern may consume it?
- What must be reviewed before promotion, recall, or external action?

The vault remains the source of truth. Hindsight is a replaceable recall projection, not the authority for permissions, provenance, freshness, or revocation.

## Table of contents

- [What SuperMemory provides](#what-supermemory-provides)
- [Architecture](#architecture)
- [End-to-end lifecycle](#end-to-end-lifecycle)
- [Vault model](#vault-model)
- [Governance and security](#governance-and-security)
- [Readiness model](#readiness-model)
- [Quickstart](#quickstart)
- [Operator workflows](#operator-workflows)
- [Testing and CI](#testing-and-ci)
- [Repository structure](#repository-structure)
- [Production operations](#production-operations)
- [Scope and limitations](#scope-and-limitations)
- [Documentation](#documentation)
- [Contributing, security, and license](#contributing-security-and-license)

## What SuperMemory provides

### Governed ingestion

Sources are selected explicitly. Capture, onboarding, refresh, and promotion use a three-step workflow:

```text
plan -> stage -> owner-confirmed commit
```

Plans are reviewable and redacted. Staging is isolated from the vault. Final commits verify that the source has not changed since review.

### Immutable evidence

Mutable references such as files, URLs, CRM records, documents, and email threads are pointers—not proof. SuperMemory stores the reviewed bytes as SHA-256 content-addressed snapshots and records their provenance, capture time, workspace, sensitivity, and lineage.

### Living-memory lifecycle

Memory is not assumed to remain true forever. The governance model distinguishes:

`fresh` · `changed` · `stale` · `needs_review` · `conflicting` · `unavailable` · `historical_only` · `do_not_use`

A changed source can invalidate derived memory without destroying the historical evidence that explains what happened.

### LLM-first meaning, deterministic governance

LLMs may interpret source-backed observations and adapt them to unfamiliar requests. Deterministic contracts still enforce evidence, confidence, uncertainty, review state, access policy, freshness, allowed use patterns, and external-action confirmation.

### Governed recall and answers

Hindsight promotion uses stable document identifiers, scoped tags, provenance metadata, and reviewed plans. Recall fails closed when required scope tags are absent or forbidden tags are present. Final answers must cite the memories and source snapshots that support them.

### Local web product

The product-shaped workflow is available on localhost. With automatic admission explicitly enabled, independently verified standard candidates are admitted and projected without a click; persistent conflicts and risks appear under **Exceptions**. With the flag off, the existing approve/reject workflow remains unchanged. Product state and exact immutable binary snapshots remain inside the configured local vault.

PDF extraction uses PDF.js, DOCX semantic extraction uses Mammoth with external file access disabled, and all processing remains local and bounded. The vault is always written first and remains canonical. Hindsight receives only legacy-approved or valid `auto_activate|activate_ttl` memory through a stable document ID, strict scope tags, complete evidence, and admission provenance. If either verifier or policy is unavailable, candidates remain `pending_verification` and non-recallable; a Hindsight outage leaves projection visibly queued.

The **Gérer** tab also creates SHA-256-manifested backups outside the canonical vault. Restore verifies every file, requires an exact confirmation, creates a pre-restore safety backup, swaps the vault atomically, then rebuilds the dedicated Hindsight bank from restored canonical memory.

### Executable specification

The product contract is expressed through fixtures, Node.js verifiers, and 55 automated tests. CI runs the complete specification and release gates on Node.js 18 and 22 without live credentials or live network writes.

## Architecture

### System flow

```mermaid
flowchart LR
    subgraph Inputs["Controlled source boundary"]
        LF["Selected local files"]
        EX["Future connector ports"]
    end

    subgraph Ingestion["Reviewed ingestion"]
        PLAN["Redacted plan"]
        STAGE["Isolated staging"]
        SNAP["SHA-256 snapshot"]
        REG["Source and snapshot registries"]
    end

    subgraph Vault["Canonical SuperMemory vault"]
        MEM["Compiled memory"]
        QUEUE["Review queues"]
        GOV["Governance policies"]
        LOG["Audit logs and evals"]
    end

    subgraph Recovery["Local recovery boundary"]
        BACKUP["Verified backup outside vault"]
        RESTORE["Atomic restore"]
    end

    subgraph Engine["Replaceable memory engine"]
        ADAPTER["Governed Hindsight adapter"]
        HINDSIGHT["Local Hindsight runtime"]
    end

    subgraph Consumption["Agent consumption"]
        RECALL["Scoped recall gate"]
        ANSWER["Evidence-backed answer"]
        ACTION["Confirmed external action"]
    end

    LF --> PLAN
    EX --> PLAN
    PLAN --> STAGE
    STAGE --> SNAP
    SNAP --> REG
    REG --> MEM
    MEM --> QUEUE
    QUEUE --> ADAPTER
    ADAPTER --> HINDSIGHT
    HINDSIGHT --> RECALL
    RECALL --> ANSWER
    ANSWER --> ACTION
    LOG --> BACKUP
    BACKUP --> RESTORE
    RESTORE --> MEM
    RESTORE -. rebuild .-> HINDSIGHT

    GOV -.-> PLAN
    GOV -.-> QUEUE
    GOV -.-> ADAPTER
    GOV -.-> RECALL
    SNAP -.-> LOG
    ADAPTER -.-> LOG
    ANSWER -.-> LOG
```

### Architectural responsibilities

| Component | Responsibility | Trust boundary |
|---|---|---|
| Operator CLIs | Produce plans, staging artifacts, reports, and explicit approval gates | No implicit mutation |
| Snapshot layer | Preserve the exact reviewed bytes under a content-derived identity | Immutable evidence |
| Source and snapshot registries | Track provenance, freshness, lineage, and source state | Recoverable transaction |
| Markdown vault | Hold canonical memory, policies, queues, signals, logs, and evals | Source of truth |
| Backup manager | Hash, verify, safety-copy, and atomically restore canonical state | Outside-vault recovery boundary |
| Interpretation contract | Let LLMs derive meaning while declaring evidence and uncertainty | Review before activation |
| Hindsight adapter | Translate governed memory into a recall-engine projection | Reviewed writes only |
| Recall and answer contracts | Enforce scope, forbidden tags, freshness, and citations | Deny by default |
| Verification suite | Prove contracts, release surface, runtime evidence, and secret hygiene | CI is mock-only |

### Codex project memory

The Codex integration binds every checkout to stable opaque project,
workspace, and checkout identities. Threads and tabs opened on the same bound
project therefore share the same approved workspace memory without relying on
the folder name. A repository marketplace exposes one SuperMemory plugin with
bounded hooks, a project-scoped MCP recall server, diagnostics, and an
on-demand usage skill.

Capture is deliberately evidence-based. Supported visible hook events are
redacted, deduplicated and encrypted locally; an App Server host can use the
provided transparent wrapper for authoritative completed-turn and file-change
observations. Hook-only clients are reported as `partial`: SuperMemory does not
claim to archive hidden reasoning, unsupported events, Codex web/cloud work,
or every model exchange merely because it happened near the same folder.

Captured history is not automatically trusted memory. It becomes encrypted
archive evidence, then an inactive candidate. In explicit automatic mode an
independent verifier feeds a calibrated deterministic policy; only a hash-attested
`auto_activate` or `activate_ttl` decision writes canonical active memory and
projects it to local Hindsight. Flags off retain explicit approval. Codex recalls
active, in-scope memory through MCP with citations; a changed source marks
derived memory stale before projection deletion. Hindsight is replaceable and
the local vault remains authoritative.

Installation is plan/apply/rollback based and preserves unrelated plugin
marketplace entries. See the [Codex production procedure](docs/production-runbook.md#codex-integration)
and run the real isolated proof with:

```bash
npm run test:codex-integration -- --json
npm run verify:codex -- --json
```

### Control plane and execution plane

SuperMemory deliberately separates two concerns:

- **Control plane — the vault:** provenance, permissions, snapshots, freshness, review queues, governance, agent contracts, and audit evidence.
- **Execution plane — memory engines and agents:** retrieval, ranking, recall, interpretation, answer drafting, and explicitly confirmed actions.

This separation prevents a retrieval engine from silently becoming the authority for data access or truth.

### Canonical state versus projection

```text
Canonical state                           Derived projection
──────────────────────────────────────    ─────────────────────────────
Source bytes + immutable snapshots        Hindsight documents
Source/snapshot registries                Recall indexes and observations
Compiled Markdown memory                  Serialized metadata and tags
Policies and review queues                Scoped query filters
Audit logs and evals                      Adapter traces
```

Deleting or changing a Hindsight projection does not erase the vault's evidence. Conversely, a document present in Hindsight is not automatically authorized for use.

## End-to-end lifecycle

The Golden End State is:

```text
capture -> snapshot -> interpretation -> promotion -> recall -> answer -> refresh -> audit
```

1. **Select:** an operator chooses a bounded source and declares workspace, owner, and capture reason.
2. **Plan:** the CLI validates scope and writes a redacted plan outside the vault.
3. **Stage:** reviewable artifacts are produced without changing canonical state.
4. **Commit:** owner confirmation triggers source re-reading, SHA-256 verification, immutable snapshot creation, and transactional registry updates.
5. **Interpret:** source-backed observations become interpretation candidates with evidence, confidence, uncertainty, and review state.
6. **Review:** ambiguity, staleness, conflicts, permissions, new types, and external actions enter explicit queues.
7. **Promote:** a reviewed plan projects only governed memory into Hindsight using stable `document_id` values and strict metadata.
8. **Recall:** agents query with workspace, consumer, status, sensitivity, schema, and forbidden-tag constraints.
9. **Answer:** responses cite used memory, snapshots, relations, and adapter traces; unsafe evidence degrades the answer state.
10. **Refresh:** changed or unavailable sources create new evidence and review work instead of silently overwriting truth.
11. **Audit:** fixtures, logs, secret hygiene, release gates, and runtime evidence prove the system's current state.

See the executable [Golden End State operator workflow](docs/golden-end-state-operator-workflow.md).

## Vault model

```text
identity-vault/
├── AGENTS.md             # operating rules for memory-consuming agents
├── memory_map.md         # human and agent navigation entry point
├── 00_inbox/             # source registry and immutable snapshots
├── 10_shared/            # redacted shared constraints and signals
├── 20_professional/      # compiled professional memory
├── 30_personal/          # personal memory
├── 40_private/           # restricted memory
├── 50_review/            # staleness, conflict, permission, type, action queues
├── 60_signals/           # typed JSONL signals
├── 70_agent_contracts/   # read, write, recall, and action contracts
├── 75_governance/        # lifecycle, access, freshness, interpretation policies
├── 80_logs/              # source changes, promotions, traces, engine evals
└── 90_evals/             # executable acceptance fixtures and golden questions
```

The vault is plain-text first: inspectable in Git, compatible with Obsidian, and usable without a proprietary database.

### Snapshot and registry safety

- Snapshot paths are derived from SHA-256 content identity.
- The source is re-read at commit time to detect post-review drift.
- Snapshot artifacts use restrictive file permissions.
- Symlinks and path escapes fail closed.
- Registry writes use a vault lock, journal, backups, atomic replacement, and recovery.
- Historical snapshots are preserved for audit rather than overwritten.

## Governance and security

| Invariant | Enforcement |
|---|---|
| Retrieval is not authorization | Required workspace, access, owner, consumer, and status tags |
| Mutable pointers are not proof | Immutable, content-addressed snapshots |
| Stale memory is not current memory | Freshness states and `needs_review` routing |
| Forbidden memory must not answer | `do_not_use`, restricted-field, and forbidden-tag guards |
| LLM output is not automatically memory | Interpretation candidate and review contracts |
| External actions require confirmation | `action_confirmation_queue` and owner gates |
| Live writes are exceptional | Reviewed apply plan, explicit live flag, owner confirmation |
| Cloud is never an implicit fallback | Localhost default; remote endpoints fail closed |
| Secrets do not belong in Git | Dedicated secret-hygiene verifier and CI gate |
| Partial writes are not hidden | Bounded timeouts and completed/pending request reports |

Sensitive source material, credentials, live evidence, and production-like logs must remain outside tracked files. See [SECURITY.md](SECURITY.md).

## Readiness model

Readiness is deliberately split into three independent levels:

| Level | Proves | Does not prove |
|---|---|---|
| `contract-ready` | Tests, fixtures, mock transport, docs, compose safety, CI, secret hygiene | A healthy live runtime |
| `runtime-ready` | Contract gate plus strict local preflight and fresh redacted live smoke evidence | Owner approval for production |
| `production-ready` | Runtime readiness plus post-evidence owner approval, exact scope, approval reference, and rollback acknowledgement | Readiness after evidence expires or scope changes |

Runtime evidence expires after 24 hours by default. Production approval is environment-specific and time-bound; it is not a permanent repository badge.

```bash
npm test
npm run verify:release
npm run verify:runtime -- --evidence-path tmp/hindsight-live-smoke-local.jsonl --json
npm run verify:production -- \
  --evidence-path tmp/hindsight-live-smoke-local.jsonl \
  --deployment-scope local-first-operator \
  --rollback-acknowledged \
  --owner-approved \
  --approval-reference <non-secret-reference> \
  --json
```

The production verifier performs no live writes. It refuses stale, failed, mock, unredacted, or pre-approval evidence.

## Quickstart

### Requirements

- Node.js 18 or newer
- Git
- Docker Desktop with Compose
- Ollama running locally with `qwen3.5:9b` already installed

### Clone and verify

```bash
git clone https://github.com/arnaudlopez/SuperMemory.git
cd SuperMemory
npm ci --ignore-scripts
npm test
npm run verify:release
```

SuperMemory never downloads a model implicitly. Install the expected model yourself once if `ollama list` does not already show it:

```bash
ollama pull qwen3.5:9b
```

### Inspect the supported operator surface

```bash
node scripts/supermemory-operator.mjs
node scripts/supermemory-operator.mjs --json
```

### Launch the complete local product

On macOS, double-click `SuperMemory.command`. It checks every prerequisite, starts the pinned Hindsight container, waits for health, starts the loopback web application, and opens the browser.

```bash
npm run launch
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310), choose a folder, and complete the import → exceptions → search workflow in the browser. Start with `--automatic-admission` (or `SUPERMEMORY_ADMISSION_MODE=automatic`) only when an independent verifier is configured; otherwise proposals remain machine-pending. Without that flag the legacy import → review → search workflow is unchanged.

Run the same fail-closed preflight without starting anything:

```bash
npm run doctor
```

By default, product state is stored inside `identity-vault` and backups under `~/.supermemory/backups`, outside the vault. Both locations are configurable:

```bash
SUPERMEMORY_VAULT_ROOT=/absolute/path/to/local-vault \
SUPERMEMORY_BACKUPS_ROOT=/absolute/path/to/local-backups \
npm run launch
```

Markdown (`.md`, `.markdown`), plain text (`.txt`), PDF, and DOCX are supported. PDF citations identify pages; DOCX citations identify semantic heading sections. Raw source downloads always return the exact captured bytes. Text files are limited to 2 MiB, binary files to 8 MiB, and each import to 20 MiB.

The application connects only to loopback Hindsight and defaults to `http://127.0.0.1:8888` with bank `supermemory-local`. Start the pinned local engine with the Compose command below. `HINDSIGHT_BASE_URL` may select another loopback port, and `HINDSIGHT_BANK_ID` may select another local bank; non-loopback URLs are rejected. Approval remains successful in the canonical vault even when projection fails, and the interface exposes an idempotent **Resynchroniser** action.

Each browser directory import is marked as a complete inventory. A previously active source that disappears is suspended from local and Hindsight-backed recall, then shown in **Gérer**. Reappearance restores it without duplicate candidates. Permanent deletion requires an explicit confirmation naming the source; SuperMemory then purges its candidate text, canonical memory files and unshared snapshots before attempting the derived Hindsight delete. A Hindsight outage never rolls back the canonical purge and leaves a content-free retry record.

`npm start` starts only the web process and is intended for development when Hindsight and Ollama are already running.

### Start local Hindsight manually

```bash
docker compose -f compose.hindsight.yml up -d
```

The Hindsight 0.9.0 image is pinned by digest and ports `8888` and `9999` are bound to `127.0.0.1` only. The container connects to host Ollama at `host.docker.internal`, uses the explicit `qwen3.5:9b` model, limits local LLM concurrency to one, and enables native observations while keeping automatic consolidation under SuperMemory control. Hindsight Cloud is not used.

Hindsight also needs a reachable local LLM provider capable of structured output. If the API is healthy but extraction produces no memory units, SuperMemory marks the projection as pending, keeps the approved canonical memory safe, and uses the cited local fallback until resynchronization succeeds.

Set explicit local runtime values before strict preflight or live smoke:

```bash
export HINDSIGHT_API_KEY='<local-key>'
export HINDSIGHT_BANK_ID='<sacrificial-bank>'
export HINDSIGHT_BASE_URL='http://127.0.0.1:8888'
export SUPERMEMORY_ALLOW_LIVE_HINDSIGHT='1'

node scripts/hindsight-local-live-smoke-preflight.mjs --json --require-ready
```

The preflight performs no writes. Follow [docs/production-runbook.md](docs/production-runbook.md) before running the credentialed live smoke or any production decision.

### Verify the Golden End State

```bash
node scripts/verify-golden-end-state-workflow.mjs
```

## Operator workflows

| Workflow | Entry point | Mutation model |
|---|---|---|
| Complete local product | `SuperMemory.command` or `npm run launch` | doctor → pinned local runtime → browser workflow → graceful shutdown |
| Web process only | `npm start` | legacy browser candidates → human review → canonical memory; explicit automatic mode → independent verification → deterministic admission → Exceptions only |
| Backup/recovery | **Gérer** tab | verified external backup → exact confirmation → safety backup → atomic restore → Hindsight rebuild |
| Product live proof | `npm run smoke:product:live` | explicit temporary four-format writes, refresh, deletion, backup, restore, restart, and cleanup |
| Client onboarding | `scripts/supermemory-onboard.mjs` | inventory → plan → staging → confirmed vault commit |
| Manual capture | `scripts/local-manual-capture.mjs` | one selected source → plan → staging → confirmed vault commit |
| Local-file refresh | `scripts/local-file-source-refresh.mjs` | connector result → refresh plan → staging → confirmed commit |
| Hindsight promotion | `scripts/hindsight-promote.mjs` | governed input → reviewed plan → mock or explicit live apply |
| Runtime preflight | `scripts/hindsight-local-live-smoke-preflight.mjs` | read-only health, env, Docker, and binding checks |
| Live smoke | `scripts/hindsight-live-smoke-runner.mjs` | explicit writes to a sacrificial local bank |
| Release gate | `scripts/verify-supermemory-release-readiness.mjs` | mock-only, no credentials |
| Runtime gate | `scripts/verify-supermemory-runtime-readiness.mjs` | validates fresh live evidence, no writes |
| Production gate | `scripts/verify-supermemory-production-readiness.mjs` | records explicit decision, no writes |

Every mutating workflow is bounded by reviewed artifacts and explicit owner confirmation. The [production runbook](docs/production-runbook.md) contains complete commands, rollback, credential boundaries, and failure handling.

## Testing and CI

```bash
npm test
npm run verify
npm run verify:release
npm run verify:secrets
git diff --check
```

GitHub Actions runs on every push and pull request with:

- Node.js 18 and 22;
- secret hygiene;
- CI regression suite;
- complete SuperMemory specification;
- release-readiness verification;
- whitespace validation;
- read-only repository permissions.

CI is intentionally mock-only. It never receives Hindsight credentials and never performs live Hindsight writes.

### Acceptance fixtures

| Fixture | Purpose |
|---|---|
| `acme-meeting-complete` | Initial personal/professional vault, source capture, signals, promotion logs, and governance |
| `enterprise-living-memory-partial` | Mutable sources, stale memory, reviewed re-promotion, revocation, and evidence-backed answers |
| `enterprise-living-memory-complete` | Full enterprise Golden Case: conflicts, unavailable sources, access, secrets, legal hold, adaptive types, queues, agents, and engine-port decisions |

Fixtures live under [`identity-vault/90_evals/cases/`](identity-vault/90_evals/cases/) and are validated by the scripts in [`scripts/`](scripts/) plus the Node tests in [`tests/`](tests/).

## Repository structure

```text
.
├── identity-vault/          # canonical governed memory and executable fixtures
├── web/                     # localhost-only product interface
├── scripts/                 # operator CLIs, adapters, gates, and verifiers
│   └── lib/                 # snapshot and recoverable-transaction primitives
├── tests/                   # Node.js regression tests
├── docs/                    # architecture, PRD, runbooks, audits, and goals
├── .github/workflows/       # pinned, read-only CI
├── compose.hindsight.yml    # pinned localhost-only Hindsight runtime
├── SuperMemory.command      # macOS double-click launcher
├── SECURITY.md              # private vulnerability reporting policy
└── package.json             # stable verification command surface
```

## Production operations

### Deployment target

The supported target is a **local-first operator deployment**:

- The SuperMemory local web application, operator tools, and governance tools run from the repository.
- The Markdown vault is canonical local state.
- Hindsight runs locally through Docker Compose.
- Ollama runs locally on the host with an explicitly installed model.
- Verified backups are stored outside the canonical vault.
- Live evidence is stored under ignored `tmp/`.
- There is no hosted web application in this release.

### Observability

All operator scripts expose machine-readable JSON. The release, runtime, production, smoke, promotion, and operator reports form the operational audit trail. Hindsight exposes local health and metrics endpoints through localhost-bound ports.

### Rollback

```bash
git revert <release-commit-sha>
npm run verify:release
```

For user-data recovery, use **Gérer → Sauvegardes vérifiées**. SuperMemory validates the manifest, creates a safety backup, restores atomically, and rebuilds Hindsight. Code rollback with Git does not replace a vault backup.

See [docs/production-runbook.md](docs/production-runbook.md) for the full release, smoke, approval, observability, and rollback procedure.

## Scope and limitations

### Implemented

- governed Markdown vault and agent contracts;
- immutable content-addressed source artifacts;
- recoverable source/snapshot registry transactions;
- local onboarding, manual capture, and local-file refresh;
- localhost web workflow for Markdown/TXT/PDF/DOCX ingestion, exact snapshots, page/section-located review, vault persistence, governed Hindsight projection/retry, strict cited recall with explicit local fallback, complete-folder reconciliation, confirmed canonical/Hindsight deletion, deduplication, and restart recovery;
- fail-closed local doctor, macOS launcher, pinned Ollama-backed Hindsight runtime, graceful shutdown, external verified backups, atomic restore, safety backup, and derived-index rebuild;
- LLM-first interpretation contract with deterministic governance;
- reviewed Hindsight promotion, strict recall, revocation, and trace contracts;
- local Docker Hindsight preflight and governed live smoke;
- access, secret, retention, legal-hold, conflict, and review-queue policies;
- adaptive business types and reusable agent use patterns;
- complete enterprise Golden Case and CI regression suite;
- contract, runtime, production, and secret-hygiene gates.
- stable project-bound Codex plugin discovery, encrypted supported-event
  capture, review-gated memory, cited MCP recall, stale-source invalidation,
  lifecycle deletion, legacy migration, and reversible installation.
- Memory Fabric v2 working sets up to 100K, cited active maps, verified output
  offload, exact `working_set_id` recall, automatic evidence-based admission,
  temporal multi-hop graph, learned additive ontology, continuous enrichment,
  hybrid routing, and one complete Docker/Portainer server artifact with no
  canary or progressive deployment.

### Not implemented in this release

- hosted SaaS UI or public API;
- unverified or LLM-self-approved activation, and non-local Hindsight projection;
- multi-tenant authentication, RLS, or billing;
- automated Gmail, Drive, CRM, web-crawler, or paid external connectors;
- automated remote source refresh;
- Hindsight Cloud as a default dependency;
- a completed live Memory Fabric v2 server deployment (the checked-in artifact
  is ready for the operator, but this repository task starts no container);
- unconfirmed external actions.
- guaranteed capture of hidden reasoning, unsupported Codex events, or
  Codex web/cloud conversations; hook-only clients have partial coverage.

The production proof exercises real local LLM extraction, verifies nonzero Hindsight memory units, reconciles recall to active canonical memory, and confirms citations after backup restore and process restart.

## Documentation

| Document | Purpose |
|---|---|
| [Documentation map](docs/README.md) | Canonical navigation and current technical decision |
| [Production runbook](docs/production-runbook.md) | Setup, preflight, live smoke, approval, observability, rollback |
| [Golden End State workflow](docs/golden-end-state-operator-workflow.md) | Executable operator lifecycle |
| [V2 product requirements](docs/prd-memoire-agentique-v2.md) | Full product contract |
| [V2 architecture audit](docs/audit-memoire-agentique-v2.md) | Rationale, trade-offs, and engine decisions |
| [Hardening audit](docs/improvement-plan-and-audit-2026-07-17.md) | Production-hardening changes and residual risks |
| [Vault agent rules](identity-vault/AGENTS.md) | Agent operating constraints |
| [Memory map](identity-vault/memory_map.md) | Vault entry points |

## Future extensions

The current single-user local product is complete within its declared scope. Future work should remain opt-in: signed desktop packaging, OCR for scanned PDFs, and connector-backed refresh for concrete approved sources. Hosted SaaS, multi-tenancy, billing, and implicit cloud processing are not part of this release.

## Contributing, security, and license

### Contributing

Before opening a pull request:

```bash
npm test
npm run verify:release
npm run verify:secrets
git diff --check
```

Changes to governance or runtime behavior should include an executable fixture or regression test. Live credentials, live evidence, raw customer data, and private vault content must never be committed.

### Security

Use GitHub's private security-advisory flow for suspected vulnerabilities. Do not disclose sensitive source material in a public issue. See [SECURITY.md](SECURITY.md).

### License

This repository is currently `UNLICENSED`. Publication on GitHub does not grant permission to use, copy, modify, or redistribute the software.

## Design principles

- The vault is the source of truth.
- Governance is the product; engines are replaceable ports.
- Retrieval is not authorization.
- A mutable external reference is not proof.
- Stale memory is not current memory.
- Forbidden memory must not support an active answer.
- LLM interpretation requires deterministic evidence and review gates.
- External actions require explicit confirmation.
- Unavailable evidence creates uncertainty, not fabricated freshness.
- Every production claim must be backed by a current, scoped gate.
