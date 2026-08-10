# T009 — Production deployment receipt

Status: **pass**
Final source: `main@68d038736f17da501df6b0049e3fa059782f173c`

## Outcome

Memory Fabric v2.5 is deployed directly on Z2 with runtime contract v8, full
activation, no canary and no progressive rollout. Home101 continues to run the
native Hermes gateway; Z2 contains only the six memory services, including the
successful one-shot Neo4j migration.

The real Home101 Hermes one-shot recalled the newly consolidated preference:
important conclusions should be remembered automatically without requiring an
explicit “retiens que”. The canonical memory is
`mem_scDKrfYQ9amDrtRPmVZvPGy-Jz7fmAOL`, revision 2, with two episodes, two
proofs and complete cited recall. It remained recallable after daemon and Web
restart.

## Recovery evidence

- Full pre-v2.5 application/configuration/runtime/secrets/vault backup:
  `/opt/supermemory/backups/pre-memory-fabric-v25-20260810T161831Z`.
- Backup manifest SHA-256:
  `c03fcd796b4b591ccc20a131fa2d4b2efa265b4725807d44c28ceb58b6199d3f`.
- Verified Neo4j dump: `neo4j-20260810T161621Z.dump`.
- Pre-v2.5 release:
  `/opt/supermemory/releases/personal-manager-v24-20260810T1148Z`.
- Previous v8 release:
  `/opt/supermemory/releases/memory-fabric-v25-37363cf-20260810T1633Z`.
- Home101 plugin/config/env backups remain outside plugin discovery.

## Production facts

- Final release path:
  `/opt/supermemory/releases/memory-fabric-v25-68d0387-20260810T1649Z`.
- Source archive SHA-256:
  `88cc5fa96f7b14abc82e05799a468d24b5d497468824fed2f661ce3f763cb53a`.
- Runtime contract SHA-256:
  `ce2bb1cdf6e2d2dab18446cfcb8709752892f1ba5d97dd34ceefeb6a75ed1e84`.
- Provider/model: OpenAI Codex, `gpt-5.6-luna`, reasoning high, no fallback.
- Hindsight, Neo4j, GraphD, daemon and Web are healthy; `neo4j-migrate`
  completed with exit code 0.
- Longitudinal worker: 6 processed, 0 pending, 0 dead letters, 0 retryable
  projections.
- Home101: tunnel enabled/active on loopback, Hermes enabled/active, plugin
  hashes 5/5, token mode 0600, provider installed/available/active.

## Smoke findings fixed before acceptance

1. Portfolio recall now normalizes both singular citation objects and arrays
   (`a60c78c`).
2. A Hermes v8 turn now has one canonical admission path and no longer enters
   the legacy v2.4 compiler in parallel (`37363cf`).
3. The UI now distinguishes pending, processed, failed and retryable work
   instead of labelling pending work as total consolidations (`68d0387`).
4. The runtime-contract runbook now uses the enforced `0640 root:1000` mode.

## Validation

- `npm run verify:memory-fabric-v25`: 22/22, 38 Node tests and 6 Python tests.
- `npm test`: 342 pass, 0 fail, 1 explicit environment-dependent skip.
- `npm run verify:secrets`: 724 files, 0 findings.
- Codebase Memory fast refresh: 11,119 nodes and 18,676 edges.
- Playwright production inspection passed. Artifact:
  `output/playwright/memory-fabric-v25-production.png`.

## Non-blocking retained history

Historical `do_not_use` smoke memories and the one duplicate v2.4 transition
memory are still visible. They were intentionally not deleted without explicit
owner confirmation. The deployed v8 path prevents new Hermes turns from
creating that parallel compiler admission.
