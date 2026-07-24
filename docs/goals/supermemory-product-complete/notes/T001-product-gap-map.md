# T001 — Current Product And Gap Map

Task: `T001`
Kind: `scout` through PM fallback
Status: `current`
Harness: `codex`
Date: `2026-07-24`

## Executive Finding

SuperMemory is a healthy, well-tested local-first **governance and operator CLI foundation**. It is not yet the local web product defined by this goal.

The current repository proves capture safety, immutable snapshots, registries, governed promotion contracts, Hindsight transport, refresh rules, fixtures, and release gates. It does not provide a browser application, document extraction pipeline, runtime semantic compilation, interactive review queue, or end-user cited search workflow.

The current README is accurate about the existing release: it calls the deployment an operator workflow and explicitly says there is no hosted web application. This goal intentionally expands the product surface from that operator release to a local web application.

## Baseline Health

| Check | Current result | Meaning |
|---|---|---|
| `npm test` | PASS, 34/34 | Existing contracts and CLI regressions are green |
| `npm run verify` | PASS | Global deterministic specification is green |
| `npm run verify:release -- --json` | PASS, `contract-ready` | Mock-only operator release is coherent |
| `npm run verify:secrets` | PASS, 387 files, 0 findings | Current heuristic secret gate is green |
| `npm run verify:runtime -- --evidence-path tmp/hindsight-live-smoke-production-launch-2026-07-20.jsonl --json` | FAIL, remains `contract-ready` | Live evidence is 97.81 hours old and exceeds the 24-hour window; required live environment variables are absent |
| `npm run verify:production` without approval arguments | FAIL, `not-ready` | Expected fail-closed behavior, not proof of product readiness |
| `docker compose -f compose.hindsight.yml ps --format json` | RUNNING | Pinned Hindsight container is up on localhost ports 8888 and 9999 |

The baseline gates cover the current operator scope. They do not cover the new web-product oracle.

## Current Architecture Reality

### Implemented runtime

- A plain-text canonical vault under `identity-vault/`.
- SHA-256 content-addressed source snapshots.
- Recoverable source and snapshot registry transactions.
- Explicit plan → staging → owner-confirmed commit CLIs.
- One-file refresh planning with change, unavailable, and review routing.
- Governed Hindsight retain/upsert/delete/recall transport.
- Reviewed promotion plans from already-structured `validated_memories` or promotion payloads.
- Deterministic governance fixtures, policies, and 34 Node tests.
- Pinned localhost-only Hindsight Docker runtime and live-smoke tooling.

### Contracts or fixtures, but not a user product runtime

- LLM-first interpretation.
- Memory candidates and validation states.
- Review queues.
- Evidence-backed answer shape.
- Full Golden End State lifecycle.

These concepts are extensively modeled and verified with fixtures. No runtime connects arbitrary folder documents to those concepts automatically.

## Oracle Gap Map

| Product stage | Evidence in current repository | Verdict |
|---|---|---|
| 1. Open a local web application | `package.json` has no dependencies and only test/verify scripts; repository contains no application/server/frontend directory | Missing |
| 2. Choose a folder and see supported formats/exclusions | `supermemory-onboard.mjs` accepts a CLI `--source-root`, include and exclude patterns | Partially implemented, CLI only |
| 3. Extract and analyse PDF, DOCX, Markdown and TXT | Onboarding reads every selected file with `fs.readFileSync(..., "utf8")`; no PDF, DOCX, ZIP/XML, OCR, parser or chunker exists | Missing for real documents; plain text capture only |
| 4. Produce cited memory candidates | Interpretation and memory-candidate contracts exist, but onboarding explicitly emits `promotion_payloads: []` and the runbook states it does not compile memory | Missing runtime bridge |
| 5. Review, edit, approve or reject candidates | Markdown review queues and fixtures exist; no interactive queue/action API or UI exists | Missing product workflow |
| 6. Commit approved memory and project it to Hindsight | `hindsight-promote.mjs` validates and promotes already-prepared governed inputs through reviewed plans | Implemented engine boundary; not connected to ingestion/review |
| 7. Search or ask a question with openable citations | Strict recall and answer contracts/fixtures exist; no end-user query API, answer composer or web UI exists | Missing product workflow |
| 8. Detect additions, modifications and removals without duplicates | One registered local file can be refreshed manually from a prepared registry input; no folder rescan/watcher or product reconciliation exists | Partially implemented primitive |
| 9. Delete from canonical state and recall projection | Hindsight delete exists for governed revocation; snapshots intentionally persist as evidence; no user deletion/revocation workflow exists | Missing product workflow and explicit retention UX |
| 10. Restart and recover coherent state | Vault and Docker persistence primitives exist; no application state or end-to-end restart test exists | Unproven |

## Format Truth

- Markdown, TXT and JSON can currently be captured only as UTF-8 bytes.
- A PDF include pattern is accepted syntactically, but there is no PDF extraction test or parser.
- DOCX is not parsed; its ZIP/XML structure would be incorrectly read as UTF-8 text.
- There is no page/section locator model produced from arbitrary documents.
- There is no chunking, normalization or deduplication pipeline for extracted text.

Therefore PDF and DOCX must not be advertised as supported until extraction and citation tests prove them.

## Key Contradictions To Resolve

1. README architecture diagrams show `snapshot -> compiled memory -> review -> Hindsight`, while the supported onboarding runtime deliberately stops after snapshot/registry commit.
2. Existing release/readiness gates can be fully green for the operator CLI while every web-product stage remains absent.
3. Existing “production-ready” approval evidence concerns the local-first operator deployment, not the local web product introduced by this goal.
4. Fixture-backed interpretation and answer contracts are not evidence that arbitrary user documents are semantically processed at runtime.

## Ranked Vertical Slices

1. **Local web shell plus a real plain-text vertical workflow.** Start/stop locally, select a bounded folder, inventory supported `.md`/`.txt` files, extract deterministic text with source locators, create reviewable memory candidates, approve/reject, persist canonical state, and search approved content with citations. This is the fastest slice that changes the repository from operator scripts into a product.
2. **Real PDF and DOCX extraction with page/section citations.** Add parser adapters, file/size limits, malformed/encrypted document errors, extraction tests, and document previews.
3. **Hindsight projection and cited question answering from approved candidates.** Connect approved canonical memories to reviewed local Hindsight writes and scoped recall; keep a deterministic local fallback for tests and unavailable runtime.
4. **Folder reconciliation lifecycle.** Rescan additions/changes/removals, produce review work, prevent duplicates, and synchronize governed revocation.
5. **Restart, recovery, packaging and final UX hardening.** Persist product state, prove restart/recovery, add first-run setup and diagnostics, then run the complete real-document oracle.

## Judge Decisions Required

- Select the first largest safe slice and exact write scope.
- Decide the minimal local application stack while preserving Node 18 compatibility and the canonical vault.
- Decide whether the first slice may use deterministic candidate generation before optional LLM integration.
- Define the local browser folder-selection contract and the boundary between browser-supplied files and backend filesystem paths.
- Define when Hindsight is mandatory versus an optional degraded mode in the first product milestone.

## Recommended First Package

Build the first real user-visible vertical slice around `.md` and `.txt` only, with an explicit “PDF/DOCX coming next” unsupported-format state. It should establish the product shell, persistent local workspace, review interaction and cited search without pretending binary extraction is solved. The next package should then add PDF/DOCX to the same tested interfaces rather than building a parallel workflow.
