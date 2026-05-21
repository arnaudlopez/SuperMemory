# T3 Minimal Hindsight Adapter

## Objective

Implement the next SuperMemory tranche: a minimal governed Hindsight adapter boundary that consumes only governed `ValidatedMemory` promotion payloads, proves fail-closed recall behavior, and keeps the Markdown vault as the source of truth.

## Original Request

"OK, entame le prochain goal"

## Intake Summary

- Input shape: `specific`
- Audience: SuperMemory maintainers and future memory agents
- Authority: `requested`
- Proof type: `test`
- Completion proof: A T3 fixture/verifier proves the minimal adapter contract end to end, the global SuperMemory specs pass, the goal board passes GoalBuddy quality/final checks, and the work is committed and pushed.
- Goal oracle: A new or extended executable verification path proves that only active governed `ValidatedMemory` payloads with provenance and `interpretation_id` reach the adapter, recall is fail-closed by workspace/access/tags, `do_not_use` and unreviewed interpretation-derived memories are excluded, stable `document_id` upserts do not duplicate documents, and answer evidence remains source-backed.
- Likely misfire: Building a real Hindsight integration or broad runtime before proving the narrow governed adapter contract, or letting raw LLM conclusions bypass the vault.
- Blind spots considered: T0/T1/T2 are green but T2 is still a governed fixture, not a runtime adapter; Hindsight runtime availability may be absent; the first T3 slice should prefer a fake/local adapter contract unless evidence proves the real runtime is safe to integrate now.
- Existing plan facts: T0/T1/T2 are implemented and green; T3 should build on `InterpretationCandidate`, `ValidatedMemory`, promotion payloads, fail-closed recall, `do_not_use`, provenance, and the LLM-first governance boundary.

## Goal Oracle

The oracle for this goal is:

`node scripts/verify-supermemory-specs.mjs` passes after adding a T3 executable adapter verification that proves governed promotion/upsert/recall behavior and preserves the existing T0/T1/T2 contracts.

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`specific`

## Current Tranche

Build the minimal local T3 adapter contract before any real Hindsight runtime dependency. The expected shape is a testable fake/local adapter or contract fixture that accepts governed promotion payloads, stores/upserts documents by stable `document_id`, supports scoped recall, excludes forbidden or unsafe memories, and returns answer evidence that can be traced back to snapshots and interpretation provenance.

The tranche is complete only when the executable verifier and docs prove the adapter boundary is governed, fail-closed, and ready to be swapped for a real Hindsight runtime later without changing SuperMemory's source-of-truth rules.

## Non-Negotiable Constraints

- Preserve the Markdown/Obsidian vault as source of truth; Hindsight is an adapter/index, not memory governance.
- Do not let raw LLM conclusions, unreviewed `InterpretationCandidate` output, stale unsafe records, or `do_not_use` memory reach recall.
- Do not weaken T0/T1/T2 verifiers or existing global specs.
- Prefer a minimal fake/local adapter contract first unless Scout/Judge proves a real runtime integration is safer and equally verifiable.
- Keep deterministic gates for provenance, status, access, review state, and answer evidence.
- Keep LLM-first flexibility at the interpretation boundary; T3 should not introduce bespoke workflow branching for every possible case.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

Do not create one Worker/Judge pair per repeated file, fixture, helper, or assertion. Put repeated same-shape work into one Worker package and review the package as a whole.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

A good task is the largest safe useful slice.

Small is not the goal. Useful is the goal.

A Worker should finish the whole assigned slice. A Judge should judge the whole assigned slice. A PM should reorient the board when tasks are safe but not moving the outcome.

## Canonical Board

Machine truth lives at:

`docs/goals/implement-hindsight-adapter-minimal-t3/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/implement-hindsight-adapter-minimal-t3/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter.
2. Read `state.yaml`.
3. Run the bundled GoalBuddy update checker when available and mention a newer version without blocking.
4. Re-check the intake: original request, input shape, authority, proof, blind spots, existing plan facts, and likely misfire.
5. Work only on the active board task.
6. Assign Scout, Judge, Worker, or PM according to the task.
7. Write a compact task receipt.
8. Update the board.
9. If safe local work remains, choose the next largest reversible Worker package and continue unless blocked.
10. Review at phase, risk, rejected-verification, ambiguity, or final-completion boundaries.
11. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.
