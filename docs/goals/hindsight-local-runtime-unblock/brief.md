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
