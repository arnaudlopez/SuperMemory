# Local File Refresh Commit Gate

## Intent

Implement the next SuperMemory tranche after the local-file refresh staging gate: a controlled commit gate from reviewed refresh staging into final vault registries.

The current `local-file-source-refresh.mjs` can dry-run a registered `local_file` refresh, persist a plan, and apply that plan to a reviewable staging directory. The next step is to let an operator commit reviewed staging into the final vault source and snapshot registries, without compiling active memory and without promoting to Hindsight.

## User Outcome

A maintainer can run a local command against a reviewed local-file refresh staging directory and an explicit `identity-vault` root. With owner confirmation, the command updates only the final source and snapshot registries needed to record the refreshed snapshot state. It must fail closed for incomplete or tampered staging, duplicate snapshot ids, raw content leakage, missing owner confirmation, unsafe vault roots, and any attempt to compile memory or promote to Hindsight.

## Non-Goals

- Do not compile active memory.
- Do not promote, delete, or mutate anything in Hindsight.
- Do not implement remote connectors, background jobs, database migrations, UI, or env files.
- Do not scan the vault, disk, mailbox, Drive, web, or any broad source.
- Do not commit unavailable or `do_not_use` staging as a fresh active snapshot.
- Do not weaken existing local-file refresh, refresh staging, manual capture, source refresh connector boundary, source snapshot refresh, Hindsight, or global specs.

## Acceptance

- A reviewed changed-source local-file refresh staging directory can be committed with `--commit-staging <dir> --vault-root <identity-vault> --owner-confirmed`.
- The commit step reads only staging artifacts and the two final vault registry files.
- The source registry records the refreshed active snapshot and freshness state for the source.
- The snapshot registry records the new immutable snapshot with `previous_snapshot_id`, `connector_result_id`, content hash, and refresh/change status.
- The command refuses missing owner confirmation, incomplete/tampered staging, malformed lineage, non-empty promotion payloads, duplicate snapshot ids, unavailable staging, `do_not_use` staging, and direct raw-content-like fields.
- No raw source content, source instructions, secrets, or neighboring-file content appear in stdout, stderr, committed registries, or staged artifacts.
- The command does not compile memory and does not promote anything in Hindsight.
- Existing specs remain green.

## Oracle

Local file refresh commit gate is complete when `node --test tests/local-file-source-refresh-cli.test.mjs`, `node scripts/verify-local-file-source-refresh-workflow.mjs`, `node scripts/verify-source-refresh-connector-boundary.mjs`, `node scripts/verify-source-snapshot-refresh-preflight.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass.
