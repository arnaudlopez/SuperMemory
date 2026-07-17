# Golden End State Operator Workflow

Date: 2026-05-24

SuperMemory's Golden End State is a local-first, LLM-first operator workflow:

```text
capture -> snapshot -> interpretation -> promotion -> recall -> answer -> refresh -> audit
```

The workflow is intentionally explicit. Operators dry-run, stage, review, commit, preflight, and only then perform live actions when a task allows it.

## Non-Live Regression

Run the Golden End State workflow verifier:

```bash
node scripts/verify-golden-end-state-workflow.mjs
```

This verifier checks that the local workflow has executable evidence for:

- owner-approved local capture;
- immutable source snapshots;
- LLM-first interpretation guarded by deterministic governance;
- review/staging before vault commits;
- governed Hindsight promotion through mock/live-guarded paths;
- local Hindsight preflight before any live write;
- scoped recall and governed answer evidence;
- source refresh/change handling;
- audit-ready logs and global regression wiring.

It is non-live by design:

- no live Hindsight writes;
- no network writes;
- no credentials required;
- no implicit cloud fallback.

## Operator Sequence

Capture one owner-approved local source:

```bash
node scripts/local-manual-capture.mjs --file /path/to/source.md --scope /path/to/ --workspace workspace:example --requested-by owner:name --capture-reason "manual evidence" --json
```

Persist a reviewed capture plan outside the vault, apply it to staging, and commit only after explicit owner confirmation:

```bash
node scripts/local-manual-capture.mjs --apply-plan /path/to/plan.json --out-dir /path/to/staging --json
node scripts/local-manual-capture.mjs --commit-staging /path/to/staging --vault-root identity-vault --owner-confirmed --json
```

Refresh one registered local file source through the connector boundary:

```bash
node scripts/local-file-source-refresh.mjs --input /path/to/registry.json --source-id source:example --write-plan /path/to/refresh-plan.json --json
node scripts/local-file-source-refresh.mjs --apply-plan /path/to/refresh-plan.json --out-dir /path/to/staging --json
node scripts/local-file-source-refresh.mjs --commit-staging /path/to/staging --vault-root identity-vault --owner-confirmed --json
```

Check the local Hindsight runtime before any live smoke:

```bash
node scripts/hindsight-local-live-smoke-preflight.mjs --json --require-ready
```

No implicit cloud fallback is allowed. With strict preflight, `blocked` exits non-zero. Clear the blocker first.

Prepare a reviewed Hindsight promotion plan from an explicit governed input:

```bash
node scripts/hindsight-promote.mjs --input /path/to/governed-promotion.json --write-plan /path/to/reviewed-promotion-plan.json --json
```

Apply the reviewed plan through mock transport for rehearsal:

```bash
node scripts/hindsight-promote.mjs --apply-plan /path/to/reviewed-promotion-plan.json --owner-confirmed --mock-transport --json
```

Run the live smoke only when a bounded task permits it, a sacrificial bank is selected, credentials are set locally, and the preflight reports `ready`:

```bash
HINDSIGHT_API_KEY=<set> HINDSIGHT_BANK_ID=<set> HINDSIGHT_BASE_URL=http://127.0.0.1:8888 SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1 node scripts/hindsight-live-smoke-runner.mjs --execute-live --json
```

Capture, refresh, and onboarding commits preserve the real reviewed bytes as content-addressed snapshot artifacts. Registry changes run under a vault lock and recoverable journal so concurrent and partial commits fail closed. Live Hindsight writes are accepted only from owner-confirmed reviewed plans.

## Failure Modes

The workflow must fail closed when:

- live Hindsight env is missing;
- the Hindsight endpoint is non-local;
- the Docker container is not localhost-only;
- a mutable source is unavailable;
- a source is revoked or `do_not_use`;
- restricted memory would be used as answer evidence;
- a mock transport result is mistaken for live proof;
- source text or secret-like values would be committed.

## Full Regression

Run the full local regression:

```bash
node scripts/verify-supermemory-specs.mjs
git diff --check
```
