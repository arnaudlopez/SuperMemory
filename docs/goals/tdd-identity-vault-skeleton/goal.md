# TDD Identity Vault Skeleton

## Objective

Create a final target skeleton for the agentic identity vault using a TDD-first approach: define a complete representative acceptance test and expected final memory state, then implement only the files needed to make that test pass as a first working base.

## Original Request

Prepare with GoalBuddy a TDD approach: create the final architecture skeleton we want, with data representing how Arnaud wants to be represented, and one very complete test example showing the final result.

## Intake Summary

- Input shape: `specific`
- Audience: Arnaud and future Codex/Claude Code agents maintaining the memory vault.
- Authority: `requested`
- Proof type: `test`
- Completion proof: A runnable/documented TDD fixture exists with raw input, expected outputs, final compiled memory views, governance/eval files, and a verification command or checklist proving the skeleton satisfies the expected result.
- Likely misfire: Creating many empty folders and placeholder files without a meaningful red -> green acceptance scenario that proves the memory model works.
- Blind spots considered: Avoid premature RAG; preserve raw sources; protect personal/private data; represent implicit entities as hypotheses; include monitoring/governance; keep the first slice usable rather than encyclopedic.
- Existing plan facts: The docs already define a Markdown/Obsidian vault with `00_inbox`, `10_shared`, `20_professional`, `30_personal`, `40_private`, `50_review`, `60_signals`, `70_agent_contracts`, `75_governance`, `80_logs`, and `90_evals`.

## Goal Kind

`specific`

## Current Tranche

Build the first executable/documented TDD tranche for the target vault:

1. Define the complete acceptance case first.
2. Add the minimal final vault skeleton and representative data required by that case.
3. Add verification so future agents can judge whether the skeleton matches the expected memory behavior.
4. Stop only after a final audit maps the produced files back to the original request.

## Non-Negotiable Constraints

- Test-first: expected result must be defined before implementation files are accepted.
- Keep raw source notes separate from compiled memory.
- Every stable fact must point to a source.
- Inferred/implicit facts must remain hypotheses or review items.
- Specialized agents must consume filtered signals/views, not raw private memory.
- The example must include professional, personal/shared, governance, monitoring, and multi-agent dimensions.
- Do not add a real RAG, graph database, or external service in this tranche.
- Use the existing project documentation as design authority.
- Preserve unrelated files and any pre-existing user changes.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

The first Worker should produce one coherent vertical slice: acceptance fixture, representative vault files, and verification. It should not create empty placeholders without test relevance.

## Canonical Board

Machine truth lives at:

`docs/goals/tdd-identity-vault-skeleton/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/tdd-identity-vault-skeleton/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter.
2. Read `state.yaml`.
3. Work only on the active board task.
4. Preserve the TDD order: expected failing acceptance case before implementation.
5. Write a compact task receipt.
6. Update the board.
7. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.
