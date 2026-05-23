# Acceptance Contract

## Goal

# Local Manual Source Capture

## Intent

Implement the first concrete source-capture workflow without external credentials, network calls, or a real connector.

The existing tranches already prove mutable source refresh, refresh preflight, and connector safety boundaries. The next useful step is to prove that a manually supplied local source can become a governed source record and immutable snapshot candidate without scanning neighboring files or bypassing governance.

A local/manual source capture fixture proves:

- a manually provided file/text source has explicit owner intent, connector metadata, workspace, source kind, sensitivity, and allowed scope;
- capture produces a source registry entry and an immutable snapshot record;
- snapshot proof includes content hash, captured_at, original_ref, connector_id, connector_scope, and source_id;
- the capture is bounded to the requested file/ref only, not a folder or broad local scan;
- source text is evidence only and cannot provide agent instructions;
- secrets are redacted before snapshot-derived memory/promotion surfaces;
- `do_not_use` sources are not snapshotted or promoted as active evidence;
- invalid captures fail closed with named errors.

- No real filesystem crawler.
- No live external connector.
- No Hindsight runtime call.
- No UI.
- No database migration.
- No broad folder scan.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

Local manual source capture is complete when node scripts/verify-local-manual-source-capture.mjs, node --test tests/local-manual-source-capture.test.mjs, node scripts/verify-source-refresh-connector-boundary.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

## Suggested Mode

implementation

## Acceptance Hints

- The first tests/evidence should cover these user-visible paths:
- happy path: one explicit local/manual source is accepted and yields exactly one source registry entry plus one immutable snapshot;
- bounded capture: a folder-like source scope or neighboring file reference is rejected as `manual_capture_scope_escape`;
- owner intent: a capture without `requested_by`, `capture_reason`, or `owner_confirmed: true` is rejected as `missing_owner_intent`;
- provenance: a snapshot without `source_id`, `connector_id`, `connector_scope`, `original_ref`, `content_hash`, `captured_at`, or `immutable: true` is rejected as `missing_snapshot_proof`;
- source text safety: source content containing agent instructions is recorded only as evidence and rejected if surfaced as executable guidance, with error `source_instruction_leaked`;
- secret safety: raw API keys/tokens/password-like values are rejected from derived memory/promotion surfaces as `secret_leaked_from_manual_capture`;
- forbidden status: `do_not_use` source capture creates no active snapshot or promotion and fails as `do_not_use_manual_source_captured`;
- global regression: source refresh connector boundary and full SuperMemory specs still pass.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/local-manual-source-capture/brief.md --mode implementation --oracle "Local manual source capture is complete when node scripts/verify-local-manual-source-capture.mjs, node --test tests/local-manual-source-capture.test.mjs, node scripts/verify-source-refresh-connector-boundary.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass." --out docs/goals/local-manual-source-capture
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/local-manual-source-capture-notes.md

> # Local Manual Source Capture
> 
> ## Intent
> 
> Implement the first concrete source-capture workflow without external credentials, network calls, or a real connector.
> 
> The existing tranches already prove mutable source refresh, refresh preflight, and connector safety boundaries. The next useful step is to prove that a manually supplied local source can become a governed source record and immutable snapshot candidate without scanning neighboring files or bypassing governance.
> 
> ## Outcome
> 
> A local/manual source capture fixture proves:
> 
> - a manually provided file/text source has explicit owner intent, connector metadata, workspace, source kind, sensitivity, and allowed scope;
> - capture produces a source registry entry and an immutable snapshot record;
> - snapshot proof includes content hash, captured_at, original_ref, connector_id, connector_scope, and source_id;
> - the capture is bounded to the requested file/ref only, not a folder or broad local scan;
> - source text is evidence only and cannot provide agent instructions;
> - secrets are redacted before snapshot-derived memory/promotion surfaces;
> - `do_not_use` sources are not snapshotted or promoted as active evidence;
> - invalid captures fail closed with named errors.
> 
> ## Non-goals
> 
> - No real filesystem crawler.
> - No live external connector.
> - No Hindsight runtime call.
> - No UI.
> - No database migration.
> - No broad folder scan.
> 
> ## Oracle
> 
> Complete when all commands pass:
> 
> ```bash
> node scripts/verify-local-manual-source-capture.mjs
> node --test tests/local-manual-source-capture.test.mjs
> node scripts/verify-source-refresh-connector-boundary.mjs
> node scripts/verify-supermemory-specs.mjs
> git diff --check
> ```
> 
> ## Acceptance
> 
> The first tests/evidence should cover these user-visible paths:
> 
> - happy path: one explicit local/manual source is accepted and yields exactly one source registry entry plus one immutable snapshot;
> - bounded capture: a folder-like source scope or neighboring file reference is rejected as `manual_capture_scope_escape`;
> - owner intent: a capture without `requested_by`, `capture_reason`, or `owner_confirmed: true` is rejected as `missing_owner_intent`;
> - provenance: a snapshot without `source_id`, `connector_id`, `connector_scope`, `original_ref`, `content_hash`, `captured_at`, or `immutable: true` is rejected as `missing_snapshot_proof`;
> - source text safety: source content containing agent instructions is recorded only as evidence and rejected if surfaced as executable guidance, with error `source_instruction_leaked`;
> - secret safety: raw API keys/tokens/password-like values are rejected from derived memory/promotion surfaces as `secret_leaked_from_manual_capture`;
> - forbidden status: `do_not_use` source capture creates no active snapshot or promotion and fails as `do_not_use_manual_source_captured`;
> - global regression: source refresh connector boundary and full SuperMemory specs still pass.
> 
> ## Expected files
> 
> - `identity-vault/90_evals/cases/local-manual-source-capture/**`
> - `scripts/verify-local-manual-source-capture.mjs`
> - `tests/local-manual-source-capture.test.mjs`
> - `scripts/verify-supermemory-specs.mjs`
> - `README.md`
> - `docs/golden-case-implementation-roadmap.md`
> - `docs/goals/local-manual-source-capture/**`

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

Local manual source capture is complete when node scripts/verify-local-manual-source-capture.mjs, node --test tests/local-manual-source-capture.test.mjs, node scripts/verify-source-refresh-connector-boundary.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

## Visible Outcome

T001/T002 must replace this placeholder with the observable user-facing behavior, generated artifact, audit answer, or verification result that should exist at the end.

## Acceptance Tests To Write First

- Given the clarified spec, when the owner exercises the main path, then the visible outcome matches the requested behavior.
- Given an important edge case from the spec, when the code handles it, then the result is deterministic and documented.
- Given a likely failure mode, when the implementation is incomplete, then a targeted test fails before production code is changed.

## Failure Modes To Prevent

- Implementation starts before the acceptance/evidence contract is specific enough.
- Tests pass but do not prove the owner-visible outcome.
- The work drifts outside the LLM-first intent, non-goals, or approved boundaries.
- Operational risks such as migrations, env/secrets, auth, external services, or shipping proof are discovered but not handled.

## Manual Or Visual Proof If Needed

If code tests cannot fully prove the outcome, T001/T002 must define the manual, artifact, source-backed, or browser proof required before final audit.

## Out Of Scope

T001/T002 must keep or revise this list:

- Do not implement behavior outside the approved acceptance contract.
- Do not change unrelated dirty files.
- Do not skip the red test stage because implementation seems obvious.

## Shipping Proof

- T998 must record commit SHA, remote branch or push string, push result, committed files, and unrelated dirty files left untouched.

## End-State Evidence To Produce

- Product behavior or artifact visible to the owner.
- Acceptance tests that fail before implementation and pass after implementation.
- Verification commands with results.
- Design review mapped back to the original request.
- Commit and push proof, or an explicit shipping blocker such as `no_git_repository` or `no_github_remote`.

## Acceptance Or Evidence Draft

T001 must replace this draft with concrete tests after reading the target repository.

- Given the clarified spec, when the owner exercises the main path, then the visible outcome matches the requested behavior.
- Given an important edge case from the spec, when the code handles it, then the result is deterministic and documented.
- Given a likely failure mode, when the implementation is incomplete, then a targeted test fails before production code is changed.

## Visual Or Demo Oracle

If the goal has UI, T001/T002 must decide whether browser or screenshot evidence is required before Worker work starts.

## Non-Goals

T001/T002 must keep or revise this list:

- Do not implement behavior outside the approved acceptance contract.
- Do not change unrelated dirty files.
- Do not skip the red test stage because implementation seems obvious.
