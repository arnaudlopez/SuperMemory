# Acceptance Contract

## Goal

# Hindsight Local Live Smoke Execution

## Intent

Move SuperMemory from mock-only Hindsight runtime readiness to a real local/self-hosted Hindsight smoke, using the existing Docker compose and live smoke runner.

The repository already has:

- `compose.hindsight.yml` for a local Hindsight runtime;
- `scripts/hindsight-promote.mjs` with dry-run, mock transport, and live-mode guards;
- `scripts/hindsight-live-smoke-runner.mjs` with capture retain, source-change upsert/recall, and revocation delete cases;
- verifiers proving mock evidence and missing-env live blocking.

The next step is to either execute the local live smoke end-to-end against `http://127.0.0.1:8888`, or make the operational blocker explicit and improve local runbook/tooling so the owner can complete it without guesswork.

A maintainer can run one local command sequence and know whether local Hindsight is actually reachable and compatible with SuperMemory's promotion/recall/delete transport contract. If the local runtime cannot run in this environment, the result must clearly say what is missing and must not silently fall back to Hindsight Cloud.

- Do not use Hindsight Cloud unless the owner explicitly chooses that endpoint.
- Do not commit secrets or env files.
- Do not run broad vault scans.
- Do not promote arbitrary vault content.
- Do not modify source capture, refresh, compilation, review queue, or answer generation behavior.
- Do not weaken existing mock, dry-run, source, refresh, or global specs.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

Hindsight local live smoke execution is complete when node scripts/verify-hindsight-docker-compose.mjs, node scripts/verify-hindsight-live-smoke-runner.mjs, node scripts/verify-hindsight-live-smoke-readiness.mjs, node --test tests/hindsight-promote.test.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass, and the final receipt records either local live smoke evidence or an explicit local-runtime blocker without cloud fallback.

## Suggested Mode

implementation

## Acceptance Hints

- Local preflight checks Docker availability and local Hindsight compose configuration.
- The live smoke target is explicit and local by default: `HINDSIGHT_BASE_URL=http://127.0.0.1:8888`.
- The smoke runner refuses cloud fallback and still blocks without explicit live opt-in.
- If local Hindsight is reachable, the smoke performs retain/upsert/recall/delete cases and writes redacted evidence under an ignored/local path.
- If local Hindsight is not reachable or Docker is unavailable, the goal records an explicit operational blocker with exact next commands, while mock verifiers remain green.
- Existing runtime preflight, live smoke runner, Docker compose, Hindsight adapter, and global specs remain green.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/hindsight-local-live-smoke-execution/brief.md --mode implementation --oracle "Hindsight local live smoke execution is complete when node scripts/verify-hindsight-docker-compose.mjs, node scripts/verify-hindsight-live-smoke-runner.mjs, node scripts/verify-hindsight-live-smoke-readiness.mjs, node --test tests/hindsight-promote.test.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass, and the final receipt records either local live smoke evidence or an explicit local-runtime blocker without cloud fallback." --out docs/goals/hindsight-local-live-smoke-execution
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/hindsight-local-live-smoke-execution-notes.md

> # Hindsight Local Live Smoke Execution
> 
> ## Intent
> 
> Move SuperMemory from mock-only Hindsight runtime readiness to a real local/self-hosted Hindsight smoke, using the existing Docker compose and live smoke runner.
> 
> The repository already has:
> 
> - `compose.hindsight.yml` for a local Hindsight runtime;
> - `scripts/hindsight-promote.mjs` with dry-run, mock transport, and live-mode guards;
> - `scripts/hindsight-live-smoke-runner.mjs` with capture retain, source-change upsert/recall, and revocation delete cases;
> - verifiers proving mock evidence and missing-env live blocking.
> 
> The next step is to either execute the local live smoke end-to-end against `http://127.0.0.1:8888`, or make the operational blocker explicit and improve local runbook/tooling so the owner can complete it without guesswork.
> 
> ## User Outcome
> 
> A maintainer can run one local command sequence and know whether local Hindsight is actually reachable and compatible with SuperMemory's promotion/recall/delete transport contract. If the local runtime cannot run in this environment, the result must clearly say what is missing and must not silently fall back to Hindsight Cloud.
> 
> ## Non-Goals
> 
> - Do not use Hindsight Cloud unless the owner explicitly chooses that endpoint.
> - Do not commit secrets or env files.
> - Do not run broad vault scans.
> - Do not promote arbitrary vault content.
> - Do not modify source capture, refresh, compilation, review queue, or answer generation behavior.
> - Do not weaken existing mock, dry-run, source, refresh, or global specs.
> 
> ## Acceptance
> 
> - Local preflight checks Docker availability and local Hindsight compose configuration.
> - The live smoke target is explicit and local by default: `HINDSIGHT_BASE_URL=http://127.0.0.1:8888`.
> - The smoke runner refuses cloud fallback and still blocks without explicit live opt-in.
> - If local Hindsight is reachable, the smoke performs retain/upsert/recall/delete cases and writes redacted evidence under an ignored/local path.
> - If local Hindsight is not reachable or Docker is unavailable, the goal records an explicit operational blocker with exact next commands, while mock verifiers remain green.
> - Existing runtime preflight, live smoke runner, Docker compose, Hindsight adapter, and global specs remain green.
> 
> ## Oracle
> 
> Hindsight local live smoke execution is complete when `node scripts/verify-hindsight-docker-compose.mjs`, `node scripts/verify-hindsight-live-smoke-runner.mjs`, `node scripts/verify-hindsight-live-smoke-readiness.mjs`, `node --test tests/hindsight-promote.test.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass, and the final receipt records either local live smoke evidence or an explicit local-runtime blocker without cloud fallback.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

Hindsight local live smoke execution is complete when node scripts/verify-hindsight-docker-compose.mjs, node scripts/verify-hindsight-live-smoke-runner.mjs, node scripts/verify-hindsight-live-smoke-readiness.mjs, node --test tests/hindsight-promote.test.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass, and the final receipt records either local live smoke evidence or an explicit local-runtime blocker without cloud fallback.

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
