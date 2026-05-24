# SuperMemory Production Runbook

This runbook describes the production-ready local-first operator release. It does not turn SuperMemory into a hosted SaaS product, and it does not make live writes in CI. It explicitly covers rollback, observability, and non-goals.

## Release Preflight

Run the release gate before shipping:

```bash
node scripts/verify-supermemory-release-readiness.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

The release verifier is mock-only. It checks the global specs, Golden End State workflow, capture and refresh workflow smokes, reviewed Hindsight promotion tests, local Hindsight preflight expectations, Docker compose safety, operator workflow, CI wiring, and tracked-file hygiene.

## Local Hindsight Setup

The default runtime target is local/self-hosted Hindsight through `compose.hindsight.yml`:

```bash
docker compose -f compose.hindsight.yml up -d
node scripts/hindsight-local-live-smoke-preflight.mjs --json
```

The compose file binds Hindsight to localhost. Hindsight Cloud is not the default and must be selected explicitly by setting `HINDSIGHT_BASE_URL=https://api.hindsight.vectorize.io` outside CI.

## Operator Workflow

Print the supported command surface:

```bash
node scripts/supermemory-operator.mjs
node scripts/supermemory-operator.mjs --json
```

### Manual Capture

Create a reviewed capture plan, apply it to staging, then commit only after owner confirmation:

```bash
node scripts/local-manual-capture.mjs --file /path/to/source.md --scope /path/to/scope --workspace workspace:example --requested-by owner:name --capture-reason "manual evidence" --write-plan /path/to/manual-capture-plan.json --json
node scripts/local-manual-capture.mjs --apply-plan /path/to/manual-capture-plan.json --out-dir /path/to/manual-capture-staging --json
node scripts/local-manual-capture.mjs --commit-staging /path/to/manual-capture-staging --vault-root identity-vault --owner-confirmed --json
```

### Local File Refresh

Refresh a registered `local_file` source through reviewed staging:

```bash
node scripts/local-file-source-refresh.mjs --input /path/to/registry.json --source-id source:example --write-plan /path/to/refresh-plan.json --json
node scripts/local-file-source-refresh.mjs --apply-plan /path/to/refresh-plan.json --out-dir /path/to/refresh-staging --json
node scripts/local-file-source-refresh.mjs --commit-staging /path/to/refresh-staging --vault-root identity-vault --owner-confirmed --json
```

### Reviewed Hindsight Promotion

Create a reviewed promotion plan before any Hindsight apply:

```bash
node scripts/hindsight-promote.mjs --input /path/to/governed-promotion.json --write-plan /path/to/reviewed-promotion-plan.json --json
node scripts/hindsight-promote.mjs --apply-plan /path/to/reviewed-promotion-plan.json --owner-confirmed --mock-transport --json
```

For real local writes, the operator must set all live variables explicitly and use `SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1`:

```bash
HINDSIGHT_API_KEY=<local-key> HINDSIGHT_BANK_ID=<local-bank> HINDSIGHT_BASE_URL=http://127.0.0.1:8888 SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1 node scripts/hindsight-promote.mjs --apply-plan /path/to/reviewed-promotion-plan.json --owner-confirmed --live --json
```

## Smoke

CI and release checks use the mock smoke:

```bash
node scripts/hindsight-live-smoke-runner.mjs --mock-transport --json --evidence-path tmp/hindsight-live-smoke-release-mock.jsonl
```

Local live smoke is manual and credentialed:

```bash
HINDSIGHT_API_KEY=<local-key> HINDSIGHT_BANK_ID=<local-bank> HINDSIGHT_BASE_URL=http://127.0.0.1:8888 SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1 node scripts/hindsight-live-smoke-runner.mjs --execute-live --json --evidence-path tmp/hindsight-live-smoke-local.jsonl
```

Evidence under `tmp/` is local scratch and must not be committed.

## Observability

Use JSON outputs from the release verifier, operator workflow, smoke runner, and promotion CLI as the operational audit trail. Redacted evidence may be kept under `tmp/` during local work. Commit only docs, scripts, fixtures, tests, and reviewed GoalBuddy receipts.

## Rollback

Rollback code with Git:

```bash
git revert <release-commit-sha>
node scripts/verify-supermemory-release-readiness.mjs
```

Rollback vault registry changes by restoring the previous reviewed staging backup or previous source/snapshot registry entries, then rerun release preflight and the relevant capture or refresh workflow smoke.

## Credential Boundaries

Do not commit `.env`, live smoke evidence, API keys, bank ids, or raw customer data. CI must remain mock-only. Live Hindsight writes require `HINDSIGHT_API_KEY`, `HINDSIGHT_BANK_ID`, `HINDSIGHT_BASE_URL`, `SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1`, and an owner-confirmed command.

## Non-goals

- No hosted SaaS UI.
- No Gmail, Drive, CRM, web crawler, or paid external source connectors in this release.
- No real production customer data in tests.
- No database migrations, background workers, auth/RLS, billing, or multi-tenant web deployment.
- No Hindsight Cloud dependency.
- No live writes in CI.
