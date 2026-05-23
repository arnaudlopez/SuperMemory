# Source Refresh Connector Boundary Notes

## Intent

Implement the next SuperMemory tranche after source snapshot refresh preflight: a local, deterministic connector boundary contract for source refresh.

The system should prove what a connector-backed refresh report must contain before any real connector is allowed to feed snapshot refresh. This is still not a real web, Gmail, Drive, CRM, or API connector.

## User Outcome

A maintainer can run a local verifier proving that connector-backed refresh input is scoped, authorized, explicit, and safe before it can become source refresh candidates.

## Non-Goals

- Do not implement real external connectors.
- Do not fetch remote sources.
- Do not scan the whole vault automatically.
- Do not run live Hindsight writes.
- Do not add dependencies, env files, migrations, jobs, or UI.
- Do not weaken existing source refresh, source-change, Hindsight promotion, or global specs.

## Acceptance

- Connector refresh reports require `connector_id`, `connector_type`, `connector_scope`, `workspace_id`, and `access_policy`.
- Connector scope must be selected-source or explicitly bounded; broad/all-vault scans fail closed.
- Every refresh candidate must point to a registered mutable source.
- Connector candidates must carry either a content hash, connector version, or unavailable result.
- `do_not_use` sources cannot produce active refresh candidates.
- The connector boundary feeds the existing source snapshot refresh preflight shape without doing network work.
- Existing source refresh, source-change, Hindsight promotion, and global specs remain green.

## Oracle

Source refresh connector boundary is complete when `node scripts/verify-source-refresh-connector-boundary.mjs`, `node --test tests/source-refresh-connector-boundary.test.mjs`, `node scripts/verify-source-snapshot-refresh-preflight.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass.
