# Release Readiness Consolidation Audit

Date: 2026-05-22

## Verdict

SuperMemory is on track as a specification-first prototype. The T0-T14 path is now executable: local fixtures, governance contracts, Golden Case checks, CI regression coverage, and promptfoo optionality are all represented by Node-based oracles.

It is not runtime-ready yet. The repo proves the SuperMemory contract, but it does not yet provide live Hindsight API integration, source capture connectors, real change detection, automated snapshot refresh, or a vault-to-Hindsight promotion CLI.

The right next move is a small consolidation pass before runtime work: update stale planning docs so future goals start from the post-T14 reality, then begin a runtime preflight around a real vault-to-Hindsight promotion script.

## Evidence Reviewed

- `README.md` now describes SuperMemory as LLM-first for meaning and deterministic for governance.
- `docs/golden-case-implementation-roadmap.md` covers T1 through T14 and marks the Golden Case path complete through regression/CI.
- `docs/golden-case-tdd-matrix.md` defines the T14 CI regression contract and the Definition of Done.
- `docs/llm-first-migration-plan.md` captures the earlier LLM-first migration strategy.
- `docs/prd-memoire-agentique-v2.md` keeps M4 source capture and M5 engine ports as future runtime work.
- `.github/workflows/supermemory-specs.yml` runs the T14 CI regression suite, global specs, and whitespace check on push and PR.
- `scripts/verify-supermemory-specs.mjs` is the global local oracle.
- `identity-vault/90_evals/cases/` contains 15 executable eval cases, including the complete enterprise Golden Case and CI regression suite.

## What Is Solid

1. The conceptual direction is coherent.
   SuperMemory is no longer trying to enumerate every business workflow. The current docs and fixtures use `InterpretationCandidate`, known use patterns, explicit evidence, uncertainty, review state, and deterministic governance gates.

2. The Golden Case is executable.
   `enterprise-living-memory-complete` now proves the full Orion enterprise case: mutable sources, t0/t1 snapshots, stale PRD review, conflict handling, unavailable sources, secrets, legal hold, access scopes, adaptive types, review queues, engine-port decisions, and source-backed answers.

3. CI is guarding the high-value invariants.
   T14 checks that the workflow includes the critical commands and that provenance, permission, `do_not_use`, secret, relation-chain, and promptfoo-optionality regressions are represented.

4. Engine scope is controlled.
   Graphiti and Memoria remain ports, not hidden dependencies. Hindsight is still the default recall engine, but the vault remains the source of truth.

## Drift And Cleanup Needed

1. `docs/llm-first-migration-plan.md` is stale.
   It still says there is "current uncommitted work" and that global specs failed before implementation. That was true during the migration, but the current branch has completed T1, M1, the LLM-first interpretation contract, and T14.

2. The README roadmap is behind the implementation.
   It still says "Expand toward the enterprise living-memory target" even though T12 and T13 are complete. It also has duplicate numbering around item 6.

3. Promptfoo is still worded as an open question in places.
   T14 made the decision practical: promptfoo remains optional reporting, not a dependency or CI gate. The PRD can keep it as a future reporting option, but it should no longer read like a blocker.

4. The global oracle is correct but noisy.
   `verify-ci-regression-suite` calls `verify-supermemory-specs` with recursion disabled, and CI also runs `verify-supermemory-specs` explicitly. That is acceptable for safety, but the terminal output repeats many PASS lines. A later reporting/harness pass could reduce noise without weakening coverage.

5. Verifier scripts repeat helper logic.
   Many scripts duplicate `fail`, JSON loading, shape checks, and assertion loops. This is not yet harmful because the scripts are simple and explicit. It becomes worth extracting only when the next changes need better reporting, mutation coverage, or shared invalid-case execution.

## Runtime Gap

The project is ready for a runtime preflight, not a runtime launch.

Missing runtime capabilities:

- live Hindsight API integration;
- vault-to-Hindsight promotion script;
- source capture connectors;
- source refresh and change detection loop;
- real connector unavailable/freshness states;
- operational logs around promotion, recall, answer evidence, and review queues.

The runtime work should consume the existing contracts rather than redesign them. In particular, it must keep fail-closed recall, stable `document_id`, snapshot provenance, `interpretation_id`, `do_not_use` exclusion, scoped tags, adapter traces, and answer evidence.

## Recommended Next Goals

### Next Goal 1: Post-T14 Docs Consolidation

Purpose: remove stale planning language before runtime work starts.

Scope:

- update `docs/llm-first-migration-plan.md` from migration plan to completed migration record plus remaining runtime implications;
- update README roadmap to reflect T12-T14 completion and the actual next runtime path;
- update PRD open questions so promptfoo is optional reporting, not a blocking uncertainty;
- keep the executable contracts unchanged.

Oracle:

```bash
node scripts/verify-supermemory-specs.mjs
git diff --check
```

### Next Goal 2: Runtime Preflight For Vault-To-Hindsight Promotion

Purpose: design the first real integration slice without weakening the local adapter contract.

Scope:

- choose Node or Python for the promotion CLI;
- define required environment variables without committing secrets;
- map one governed fixture payload to real Hindsight calls;
- preserve local fake adapter tests as the contract oracle;
- add a dry-run mode before any live write.

Oracle:

```bash
node scripts/verify-hindsight-adapter-minimal.mjs
node scripts/verify-governed-answer-evidence.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

### Later Goal: Verifier Reporting Harness

Purpose: reduce duplicated output and helper code after the runtime path is clearer.

This should not happen before docs consolidation unless the verification noise starts blocking development.

## Recommendation

Do the Post-T14 Docs Consolidation next. It is small, reduces future misfires, and prevents a runtime goal from starting with stale assumptions.

After that, start the Runtime Preflight For Vault-To-Hindsight Promotion as the first true implementation step beyond the specification-first prototype.
