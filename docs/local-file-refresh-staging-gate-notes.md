# Local File Refresh Staging Gate

## Intent

Implement the next SuperMemory tranche after the local-file source refresh CLI and workflow smoke: a controlled staging/review gate for refresh plans.

The current `local-file-source-refresh.mjs` can produce and persist a dry-run plan for a registered `local_file` source. The next step is to let an operator apply a reviewed refresh plan into a staging directory, without writing directly to `identity-vault`, without compiling active memory, and without promoting to Hindsight.

## User Outcome

A maintainer can run a local command against a saved refresh plan and get reviewable staging artifacts that contain source registry deltas, snapshot candidates, connector run/result evidence, affected memory review items, and a manifest. The command must fail closed for invalid plans, raw content leakage, malformed lineage, duplicate or unsafe destination paths, and direct vault writes.

## Non-Goals

- Do not write directly to the final vault.
- Do not compile active memory.
- Do not promote or delete anything in Hindsight.
- Do not implement remote connectors, background jobs, database migrations, UI, or env files.
- Do not scan the vault, disk, mailbox, Drive, web, or any broad source.
- Do not weaken existing local-file refresh, source refresh connector boundary, source snapshot refresh, Hindsight, or global specs.

## Acceptance

- A saved local-file refresh plan can be applied to a new empty staging directory.
- The staging directory contains reviewable JSON artifacts for the original plan, connector runs/results, refresh candidates/plans, snapshot candidates, review items, and manifest.
- The apply step refuses plans with validation errors, missing lineage, raw-content-like fields, non-empty promotion payloads, or direct `identity-vault` destinations.
- Changed-source staging preserves `previous_snapshot_id`, `connector_result_id`, `created_snapshot_id`, and `needs_review` routing.
- Unavailable and `do_not_use` plans stage without creating fresh snapshots or active promotions.
- No raw source content, source instructions, secrets, or neighboring-file content appear in stdout, stderr, or staged artifacts.
- Existing specs remain green.

## Oracle

Local file refresh staging gate is complete when `node --test tests/local-file-source-refresh-cli.test.mjs`, `node scripts/verify-local-file-source-refresh-workflow.mjs`, `node scripts/verify-source-refresh-connector-boundary.mjs`, `node scripts/verify-source-snapshot-refresh-preflight.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass.
