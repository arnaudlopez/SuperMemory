# Adopt Hindsight And Create Audit/PRD V2

## Original Request

`$goalbuddy:goal-prep ok adapter un nouvel audit, un nouveau prd a partir de nos dernieres conceptions.`

## Interpreted Outcome

Create a V2 SuperMemory plan so the new audit memo and new PRD reflect the latest product direction without overwriting the existing V1 docs as the primary artifact:

- Adopt Hindsight as the memory engine rather than rebuilding retrieval, graph, embeddings, document chunks, observations, MCP, or benchmark infrastructure.
- Keep SuperMemory focused on governed Markdown/Obsidian memory: source selection, provenance, connector scope, sensitivity, review, revocation, agent contracts, and action-safety.
- Keep the stack intentionally lean: Hindsight first, promptfoo only if useful for regression tests, and no broad integration of Presidio, OPA, ArchiveBox, Langfuse/Phoenix, Basic Memory, Mem0, Graphiti, Khoj, Letta, or AnythingLLM in this tranche.
- Preserve the existing TDD/eval direction and adapt it to verify the new Hindsight-backed architecture instead of replacing the governance layer.

## Input Shape

existing_plan

The user has already decided to adopt Hindsight and wants the local documentation adapted to that decision.

## Audience

Arnaud and future Codex/Claude Code agents maintaining SuperMemory.

## Non-Goals

- Do not implement the Hindsight integration in this documentation tranche unless a later Worker task is explicitly added.
- Do not install or run Hindsight as part of this goal.
- Do not add promptfoo unless the updated PRD/audit explicitly justifies it as a follow-up.
- Do not introduce a heavyweight multi-tool architecture.
- Do not weaken the governed Markdown/Obsidian source-of-truth model.
- Do not remove existing provenance, connector-scope, sensitivity, review, threat-model, or TDD requirements.

## Authority

requested

The user approved adopting Hindsight and asked to update the audit and PRD from the latest conceptions.

## Existing Plan Facts To Preserve

- Hindsight is the chosen memory engine candidate.
- Hindsight should replace custom memory-engine work, not the SuperMemory governance layer.
- SuperMemory remains the governed Markdown/Obsidian layer for source truth, policy, provenance, sensitivity, review, and contracts.
- promptfoo may be useful as a simple regression/eval runner.
- Other tools are likely overkill for now and should remain optional watchlist items rather than default dependencies.
- The current repository already has `docs/audit-memoire-agentique.md`, `docs/prd-memoire-agentique.md`, and TDD/eval fixtures that must be used as source context, not overwritten as the V2 primary output.

## Goal Oracle

The goal is complete when a final audit proves that:

- New V2 documents exist for the audit and PRD, separate from the current V1 docs.
- The V2 audit and V2 PRD both clearly encode the Hindsight-backed architecture and lean-tooling decision.
- The documents distinguish what Hindsight owns from what SuperMemory owns.
- The documents explicitly say what not to rebuild.
- The documents preserve governance requirements for provenance, connector scope, sensitivity, review, revocation, prompt-injection resistance, and action confirmation.
- The repository verification command still passes, or any failure is documented as unrelated or intentionally pending.

## Completion Proof

A final Judge receipt with `full_outcome_complete: true`, citing changed files and verification results, plus a clean enough diff showing newly created V2 audit and PRD content aligned with the latest decisions.

## Likely Misfire

The `/goal` run could edit the existing V1 docs in place instead of creating a clean V2 plan, or produce a generic Hindsight mention while leaving the old architecture mentally intact. It could also swing too far and describe SuperMemory as just a thin Hindsight client, losing the governed Markdown source-of-truth value.

## Blind Spots

- Hindsight has strong memory-engine features, but its default auto-retain/auto-recall can conflict with selective governed ingestion.
- The PRD must be explicit about not ingesting all data automatically.
- The audit must separate "adopt now" from "watch later" tools so SuperMemory does not become overengineered.
- The docs should keep a path for promptfoo regression tests without requiring the whole eval suite to be implemented in this tranche.

## Starter Command

`/goal Follow docs/goals/adopt-hindsight-create-audit-prd-v2/goal.md.`
