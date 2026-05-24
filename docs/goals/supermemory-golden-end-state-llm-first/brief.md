# SuperMemory Golden End State LLM-First Notes

## Intent

Bring SuperMemory to the Golden End State as a local-first, LLM-first memory tool that can run end to end:

```text
capture source -> immutable snapshot -> LLM-first interpretation -> governed memory promotion -> local Hindsight retain/upsert/delete/recall -> governed answer with evidence -> source refresh/change handling -> audit trail
```

The implementation should keep moving through bounded slices until the tool is operator-usable, tested, documented, and shippable.

- Do not silently fall back to Hindsight Cloud.
- Do not commit env files, API keys, bank ids, raw live response bodies, or live evidence under version control.
- Do not perform live writes unless a task explicitly permits it and local preflight is `ready`.
- Do not promote arbitrary vault content without an owner-approved staged plan.
- Do not replace Hindsight with Graphiti/Memoria unless a specific eval proves Hindsight or the vault layer is insufficient.
- Do not build a UI before the CLI/operator workflow is coherent.

- No implicit Hindsight Cloud fallback.
- No committed secrets, env files, live API keys, bank ids, raw live response bodies, or live evidence.
- No live Hindsight writes unless a task explicitly permits local mutation and the local preflight reports `ready`.
- No arbitrary vault-wide promotion without an owner-approved staged plan.
- No broad connector platform before the first concrete operator workflow is coherent.
- No Graphiti/Memoria activation unless a specific eval proves Hindsight or the vault snapshot layer is insufficient.
- No UI before the CLI/operator path is complete and verified.

- no implicit Hindsight Cloud fallback;
- no committed secrets, env files, live API keys, bank ids, raw live response bodies, or live evidence;
- no live Hindsight writes unless a task explicitly permits local mutation and the local preflight reports `ready`;
- no arbitrary vault-wide promotion without an owner-approved staged plan;
- no broad connector platform before the first concrete operator workflow is coherent;
- no Graphiti/Memoria activation unless a specific eval proves Hindsight or the vault snapshot layer is insufficient;
- no UI before the CLI/operator path is complete and verified.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

SuperMemory is operator-usable end to end locally: capture -> immutable snapshot -> LLM-first interpretation -> governed memory promotion -> local Hindsight retain/upsert/delete/recall -> governed answer with evidence -> source refresh/change handling -> audit trail, with a Golden End State verifier and node scripts/verify-supermemory-specs.mjs green, no implicit cloud fallback, no committed secrets, and shipped goal receipts.

## Suggested Mode

implementation

## Acceptance Hints

- Expected evidence should include:
- design concept and module map for the final local operator workflow;
- impact assessment for db schema, data backfill, env/secrets, auth, API contract, UI routes, background jobs, external services, deploy/rollback, observability, and docs;
- green targeted tests for each implemented slice;
- green global regression;
- final audit explaining what is complete and what remains blocked, if anything is genuinely external.
- First automated proof: add or maintain a Golden End State verifier that checks the local operator workflow contract and is included in `node scripts/verify-supermemory-specs.mjs`.
- Edge case proof: the workflow must fail closed when live Hindsight env is missing, the endpoint is non-local, the Docker container is not localhost-only, a source is unavailable, memory is restricted, or a source is revoked.
- Manual/external proof: live Hindsight writes require explicit local preflight `ready`, sacrificial bank env, redacted evidence outside committed files, and no cloud fallback.
- Shipping proof: all goal-scoped changes are committed and pushed, with final GoalBuddy receipts and no unrelated dirty files.
- Documentation proof: README/runbooks describe the actual operator sequence and current blockers.
- a GoalBuddy board exists for the Golden End State with Scout/Judge/Worker receipts;
- `node scripts/verify-supermemory-specs.mjs` passes after each shipped slice;
- a new Golden End State verifier passes and covers the local end-to-end flow;
- local Hindsight preflight either reports `ready` before live execution or records an explicit operational blocker;
- any live smoke uses only local/self-hosted Hindsight, explicit live env, and a sacrificial bank;
- redacted evidence proves live retain/upsert/delete/recall or documents the non-code blocker;
- operator docs explain the current command sequence and failure modes;
- final receipts include design concept, module map, interface contract, impact assessment, architecture review, shipping proof, and no-secret evidence;
- all goal-scoped changes are committed and pushed.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/supermemory-golden-end-state-llm-first/brief.md --mode implementation --oracle "SuperMemory is operator-usable end to end locally: capture -> immutable snapshot -> LLM-first interpretation -> governed memory promotion -> local Hindsight retain/upsert/delete/recall -> governed answer with evidence -> source refresh/change handling -> audit trail, with a Golden End State verifier and node scripts/verify-supermemory-specs.mjs green, no implicit cloud fallback, no committed secrets, and shipped goal receipts." --out docs/goals/supermemory-golden-end-state-llm-first-notes
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/supermemory-golden-end-state-llm-first-notes.md

> # SuperMemory Golden End State LLM-First Notes
> 
> Date: 2026-05-24
> 
> ## Intent
> 
> Bring SuperMemory to the Golden End State as a local-first, LLM-first memory tool that can run end to end:
> 
> ```text
> capture source -> immutable snapshot -> LLM-first interpretation -> governed memory promotion -> local Hindsight retain/upsert/delete/recall -> governed answer with evidence -> source refresh/change handling -> audit trail
> ```
> 
> The implementation should keep moving through bounded slices until the tool is operator-usable, tested, documented, and shippable.
> 
> ## Current Known State
> 
> Completed and green contracts already exist for:
> 
> - T0/T1 source change and memory contracts;
> - T3 minimal Hindsight adapter;
> - T4 governed answer evidence;
> - T5 source change sync;
> - T6 conflict/unavailable arbitration;
> - T7 adaptive business types;
> - T8 enterprise access, secrets, retention;
> - T9 review queues/actions;
> - T10 agent use patterns;
> - T11 engine port evals;
> - T12/T13 enterprise living memory partial/complete;
> - T14 CI regression suite;
> - local manual source capture;
> - local file source refresh staging and commit gates;
> - Hindsight mockable transport, API contract readiness, live-smoke readiness, Docker compose, and local live-smoke preflight.
> 
> Most recent operational status:
> 
> - `scripts/hindsight-local-live-smoke-preflight.mjs --json` reports local Hindsight `/health` is healthy.
> - It correctly blocks live smoke because live env values are not set.
> - It also blocks because the running `supermemory-hindsight-local` container is currently bound to all interfaces instead of localhost-only.
> - No Hindsight live writes have been performed yet.
> 
> ## Golden End State
> 
> SuperMemory is complete when an operator can use one coherent local workflow to:
> 
> 1. capture an owner-approved local or external source;
> 2. create and verify immutable source snapshots;
> 3. interpret source material with an LLM-first contract that adapts to unknown cases and produces auditable uncertainty;
> 4. stage, review, and commit memory candidates;
> 5. promote governed memory to local/self-hosted Hindsight with explicit live opt-in;
> 6. recall from Hindsight with strict scope and evidence;
> 7. answer with governed evidence and clear answer state;
> 8. refresh mutable sources and route changes, conflicts, unavailable sources, and revocations correctly;
> 9. inspect redacted logs, evidence, and receipts;
> 10. run a single regression command proving the full local flow stays green.
> 
> ## Non-Goals And Hard Boundaries
> 
> - Do not silently fall back to Hindsight Cloud.
> - Do not commit env files, API keys, bank ids, raw live response bodies, or live evidence under version control.
> - Do not perform live writes unless a task explicitly permits it and local preflight is `ready`.
> - Do not promote arbitrary vault content without an owner-approved staged plan.
> - Do not replace Hindsight with Graphiti/Memoria unless a specific eval proves Hindsight or the vault layer is insufficient.
> - Do not build a UI before the CLI/operator workflow is coherent.
> 
> ## Non-Goals
> 
> - No implicit Hindsight Cloud fallback.
> - No committed secrets, env files, live API keys, bank ids, raw live response bodies, or live evidence.
> - No live Hindsight writes unless a task explicitly permits local mutation and the local preflight reports `ready`.
> - No arbitrary vault-wide promotion without an owner-approved staged plan.
> - No broad connector platform before the first concrete operator workflow is coherent.
> - No Graphiti/Memoria activation unless a specific eval proves Hindsight or the vault snapshot layer is insufficient.
> - No UI before the CLI/operator path is complete and verified.
> 
> ## non_goals
> 
> - no implicit Hindsight Cloud fallback;
> - no committed secrets, env files, live API keys, bank ids, raw live response bodies, or live evidence;
> - no live Hindsight writes unless a task explicitly permits local mutation and the local preflight reports `ready`;
> - no arbitrary vault-wide promotion without an owner-approved staged plan;
> - no broad connector platform before the first concrete operator workflow is coherent;
> - no Graphiti/Memoria activation unless a specific eval proves Hindsight or the vault snapshot layer is insufficient;
> - no UI before the CLI/operator path is complete and verified.
> 
> ## Preferred Implementation Order
> 
> 1. Clear local Hindsight runtime blockers:
>    - recreate `supermemory-hindsight-local` from `compose.hindsight.yml`;
>    - verify ports bind to `127.0.0.1`;
>    - keep env redacted and local-only.
> 2. Execute the first owner-approved local Hindsight live smoke against a sacrificial bank:
>    - only after preflight is `ready`;
>    - capture redacted proof outside committed live data;
>    - document cleanup/rollback.
> 3. Promote the existing mock/fixture promotion path into an operator-facing dry-run/apply workflow:
>    - select reviewed memory candidates;
>    - emit plan;
>    - apply explicit live promotion;
>    - record redacted evidence.
> 4. Consolidate the LLM-first interpretation layer:
>    - reduce brittle deterministic case branching where an interpretation contract can carry uncertainty;
>    - keep governed evidence, access, freshness, and revocation rules deterministic where safety requires it.
> 5. Build the full source lifecycle:
>    - local file remains the first concrete connector;
>    - add external connector support only behind explicit source workflows;
>    - refresh, unavailable, conflict, and revocation flows remain test-backed.
> 6. Add operator-quality CLI commands and docs:
>    - preflight, capture, stage, review, commit, promote, recall, answer, refresh, inspect;
>    - no hidden mutation.
> 7. Finish with a Golden End State regression:
>    - one command covers the core local path;
>    - all existing contract tests stay green.
> 
> ## Observable Oracle
> 
> The goal is complete when:
> 
> - `node scripts/verify-supermemory-specs.mjs` passes;
> - a Golden End State verifier passes and proves capture -> snapshot -> interpretation -> governed promotion -> local Hindsight recall -> governed answer -> refresh/change audit;
> - the local Hindsight live-smoke path has either redacted live proof against a sacrificial local bank or a documented operational blocker that is outside code control;
> - docs and roadmap reflect the current operator workflow;
> - all changes are committed and pushed;
> - no secrets or live evidence are committed.
> 
> ## Acceptance Evidence
> 
> Expected evidence should include:
> 
> - design concept and module map for the final local operator workflow;
> - impact assessment for db schema, data backfill, env/secrets, auth, API contract, UI routes, background jobs, external services, deploy/rollback, observability, and docs;
> - green targeted tests for each implemented slice;
> - green global regression;
> - final audit explaining what is complete and what remains blocked, if anything is genuinely external.
> 
> ## Acceptance
> 
> - First automated proof: add or maintain a Golden End State verifier that checks the local operator workflow contract and is included in `node scripts/verify-supermemory-specs.mjs`.
> - Edge case proof: the workflow must fail closed when live Hindsight env is missing, the endpoint is non-local, the Docker container is not localhost-only, a source is unavailable, memory is restricted, or a source is revoked.
> - Manual/external proof: live Hindsight writes require explicit local preflight `ready`, sacrificial bank env, redacted evidence outside committed files, and no cloud fallback.
> - Shipping proof: all goal-scoped changes are committed and pushed, with final GoalBuddy receipts and no unrelated dirty files.
> - Documentation proof: README/runbooks describe the actual operator sequence and current blockers.
> 
> ## acceptance_evidence
> 
> - a GoalBuddy board exists for the Golden End State with Scout/Judge/Worker receipts;
> - `node scripts/verify-supermemory-specs.mjs` passes after each shipped slice;
> - a new Golden End State verifier passes and covers the local end-to-end flow;
> - local Hindsight preflight either reports `ready` before live execution or records an explicit operational blocker;
> - any live smoke uses only local/self-hosted Hindsight, explicit live env, and a sacrificial bank;
> - redacted evidence proves live retain/upsert/delete/recall or documents the non-code blocker;
> - operator docs explain the current command sequence and failure modes;
> - final receipts include design concept, module map, interface contract, impact assessment, architecture review, shipping proof, and no-secret evidence;
> - all goal-scoped changes are committed and pushed.
