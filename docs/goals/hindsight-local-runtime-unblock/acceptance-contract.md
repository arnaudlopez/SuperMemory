# Acceptance Contract

## Goal

# Hindsight Local Runtime Unblock Notes

## Intent

Clear the local Docker runtime blocker that prevents the Hindsight live-smoke preflight from reaching the next safe state.

Current preflight status:

- local Hindsight `/health` is healthy on `http://127.0.0.1:8888`;
- required live env values are not set, which is expected until the owner provides a sacrificial bank;
- `supermemory-hindsight-local` is running but exposes ports on all interfaces instead of localhost-only;
- `compose.hindsight.yml` already declares localhost-only bindings.

- No live Hindsight writes.
- No API keys, bank ids, env files, or secrets.
- No cloud fallback.
- No source capture, vault mutation, promotion, recall, or answer behavior changes.
- No data volume deletion.
- No code changes unless verification exposes a bounded issue.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

The local runtime unblock is complete when Hindsight is running from compose.hindsight.yml with localhost-only 127.0.0.1 bindings for 8888/9999, /health is healthy, node scripts/hindsight-local-live-smoke-preflight.mjs --json no longer reports hindsight_container_not_localhost_bound and only remains blocked on missing live env if credentials are absent, no live writes are performed, and targeted/global verification passes.

## Suggested Mode

implementation

## Acceptance Hints

- Recreate or replace the local `supermemory-hindsight-local` container from `compose.hindsight.yml` without deleting the persistent data volume.
- `docker ps` and `docker inspect` show ports `8888` and `9999` bound to `127.0.0.1`.
- `curl http://127.0.0.1:8888/health` returns healthy.
- `node scripts/hindsight-local-live-smoke-preflight.mjs --json` no longer reports `hindsight_container_not_localhost_bound`.
- The preflight may still report `missing_live_env`, and that is the expected next blocker.
- `node scripts/verify-hindsight-local-live-smoke-preflight.mjs`, `node scripts/verify-hindsight-docker-compose.mjs`, `node scripts/verify-golden-end-state-workflow.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` pass.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/hindsight-local-runtime-unblock/brief.md --mode implementation --oracle "The local runtime unblock is complete when Hindsight is running from compose.hindsight.yml with localhost-only 127.0.0.1 bindings for 8888/9999, /health is healthy, node scripts/hindsight-local-live-smoke-preflight.mjs --json no longer reports hindsight_container_not_localhost_bound and only remains blocked on missing live env if credentials are absent, no live writes are performed, and targeted/global verification passes." --out docs/goals/hindsight-local-runtime-unblock-notes
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/hindsight-local-runtime-unblock-notes.md

> # Hindsight Local Runtime Unblock Notes
> 
> Date: 2026-05-24
> 
> ## Intent
> 
> Clear the local Docker runtime blocker that prevents the Hindsight live-smoke preflight from reaching the next safe state.
> 
> Current preflight status:
> 
> - local Hindsight `/health` is healthy on `http://127.0.0.1:8888`;
> - required live env values are not set, which is expected until the owner provides a sacrificial bank;
> - `supermemory-hindsight-local` is running but exposes ports on all interfaces instead of localhost-only;
> - `compose.hindsight.yml` already declares localhost-only bindings.
> 
> ## Non-Goals
> 
> - No live Hindsight writes.
> - No API keys, bank ids, env files, or secrets.
> - No cloud fallback.
> - No source capture, vault mutation, promotion, recall, or answer behavior changes.
> - No data volume deletion.
> - No code changes unless verification exposes a bounded issue.
> 
> ## Acceptance
> 
> - Recreate or replace the local `supermemory-hindsight-local` container from `compose.hindsight.yml` without deleting the persistent data volume.
> - `docker ps` and `docker inspect` show ports `8888` and `9999` bound to `127.0.0.1`.
> - `curl http://127.0.0.1:8888/health` returns healthy.
> - `node scripts/hindsight-local-live-smoke-preflight.mjs --json` no longer reports `hindsight_container_not_localhost_bound`.
> - The preflight may still report `missing_live_env`, and that is the expected next blocker.
> - `node scripts/verify-hindsight-local-live-smoke-preflight.mjs`, `node scripts/verify-hindsight-docker-compose.mjs`, `node scripts/verify-golden-end-state-workflow.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` pass.
> 
> ## Observable Oracle
> 
> The local runtime unblock is complete when Hindsight is running from the repository compose file with localhost-only bindings, health is good, the live-smoke preflight blocker list is reduced to missing live env only, no live writes are performed, and all targeted/global verification stays green.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

The local runtime unblock is complete when Hindsight is running from compose.hindsight.yml with localhost-only 127.0.0.1 bindings for 8888/9999, /health is healthy, node scripts/hindsight-local-live-smoke-preflight.mjs --json no longer reports hindsight_container_not_localhost_bound and only remains blocked on missing live env if credentials are absent, no live writes are performed, and targeted/global verification passes.

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
