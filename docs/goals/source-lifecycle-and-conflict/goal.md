# Source Lifecycle And Conflict

## Objective

Create the second TDD tranche for SuperMemory: prove that the memory model handles source lifecycle, connector scope, contradictions, revocation, and external-action confirmation.

## Original Request

After reviewing the model's blind spots, Arnaud asked what to do next and approved moving forward. The recommended next tranche is `source-lifecycle-and-conflict`.

## Intake Summary

- Input shape: `specific`
- Audience: Arnaud and future Codex/Claude Code memory-maintenance agents.
- Authority: requested
- Proof type: test
- Completion proof: a new runnable TDD fixture exists and passes, proving source updates, contradictions, explicit user correction precedence, revoked sources, connector-scope refusal, and confirmation gates for external actions.
- Likely misfire: adding more documentation without a second executable acceptance scenario.
- Blind spots addressed:
  - Source moved, updated, superseded, or revoked.
  - Conflicting facts across PDF, email, meeting note, and explicit user correction.
  - Connectors attempting to read beyond authorized scope.
  - Compiled memory using stale facts after a source changes.
  - External actions executed or duplicated without confirmation.

## Goal Kind

`specific`

## Current Tranche

Build one coherent vertical slice:

1. Define the expected acceptance case first.
2. Add minimal governance files for source lifecycle and connector contracts.
3. Add representative fixture sources and compiled final state.
4. Extend verification to prove the new behavior.
5. Finish with an audit mapping the tranche back to the blind spots.

## Non-Negotiable Constraints

- Test-first: expected fixture before implementation files are accepted.
- Preserve existing Acme TDD scenario and keep it passing.
- Do not add real Gmail, Drive, API, or MCP calls in this tranche.
- Use simulated connector/source fixtures only.
- Keep raw sources preserved even when revoked or superseded.
- A higher-reliability source must win over a lower-reliability source.
- Explicit Arnaud correction wins over PDF, email, meeting note, and agent inference.
- Revoked or `do_not_use` sources must not drive active compiled memory.
- External actions require confirmation and must not be duplicated.
- Preserve unrelated user changes.

## Stop Rule

Stop only when the new fixture and the existing fixture both pass, and a final audit records whether the full tranche is complete.

## Canonical Board

Machine truth lives at:

`docs/goals/source-lifecycle-and-conflict/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/source-lifecycle-and-conflict/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter.
2. Read `state.yaml`.
3. Work only on the active board task.
4. Preserve TDD order.
5. Write a compact task receipt.
6. Update the board.
7. Finish only with a Judge/PM audit receipt and passing verification.
