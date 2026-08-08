# Hindsight-Native Memory Plane — Repository Release Receipt

- Contract: `supermemory.runtime.v4`, GraphD `2.0.0`, Hindsight `0.9.0`.
- Activation: full target only; `canary=false`, `progressive=false`.
- Authority: encrypted local vault; Hindsight and Neo4j are rebuildable derived
  planes.
- Removed runtime components: Graphiti and `supermemory-improved`.
- Migration execution: `not_applicable_no_runtime_deployed`.
- Live writes, model pulls and container starts: none.
- Runtime readiness: `contract-ready` until an operator explicitly deploys the
  stack and records fresh live evidence.

The deterministic repository gates are the HN-AC01…HN-AC24 matrix, the Memory
Fabric v2 45-case matrix, the complete Node test suite, release readiness,
secret hygiene, Compose contract verification and `git diff --check`. Exact
results are regenerated at release time rather than frozen into this document.

Migration and rollback procedure:
[`hindsight-native-migration-runbook.md`](hindsight-native-migration-runbook.md).
