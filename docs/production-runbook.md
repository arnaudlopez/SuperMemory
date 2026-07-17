# SuperMemory Production Runbook

This runbook describes the contract-ready local-first operator release and the separate path to runtime approval, including rollback, observability, and non-goals. It does not turn SuperMemory into a hosted SaaS product, does not make live writes in CI, and does not equate a green mock gate with production approval.

## Release Preflight

Run the release gate before shipping:

```bash
node scripts/verify-supermemory-release-readiness.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

The release verifier is mock-only and reports `contract-ready`, never `production-ready`. It checks the global specs, Golden End State workflow, capture and refresh workflow smokes, reviewed Hindsight promotion tests, local Hindsight preflight expectations, Docker compose safety, operator workflow, CI wiring, and tracked-file hygiene.

Run the separate runtime gate only after a real smoke. It reruns the contract gate, requires a strict healthy preflight, and accepts only successful, redacted live evidence newer than 24 hours by default:

```bash
node scripts/verify-supermemory-runtime-readiness.mjs --evidence-path tmp/hindsight-live-smoke-local.jsonl --json
```

Even a `runtime-ready` result leaves `production_ready: false`; final production approval is a deliberate operator decision.

## Production Approval

After reviewing a fresh successful runtime report, record the explicit local-first production decision:

```bash
node scripts/verify-supermemory-production-readiness.mjs \
  --evidence-path tmp/hindsight-live-smoke-local.jsonl \
  --deployment-scope local-first-operator \
  --rollback-acknowledged \
  --owner-approved \
  --approval-reference <approval-reference> \
  --json
```

The approval reference is a non-secret audit label, not a credential. This verifier performs no live writes. It reruns contract and runtime readiness, rejects stale or invalid evidence, requires the decision to occur after the live evidence, and returns `production_ready: true` only when all approval requirements are present. Never reuse an approval to bypass a newer failed or expired runtime check.

## Local Hindsight Setup

The default runtime target is local/self-hosted Hindsight through `compose.hindsight.yml`:

```bash
docker compose -f compose.hindsight.yml up -d
node scripts/hindsight-local-live-smoke-preflight.mjs --json --require-ready
```

The compose file binds Hindsight to localhost and pins the image by digest. Hindsight Cloud is not the default; it requires both `HINDSIGHT_BASE_URL=https://api.hindsight.vectorize.io` and `SUPERMEMORY_ALLOW_HINDSIGHT_CLOUD=1` outside CI. Other remote endpoints are rejected.

To upgrade Hindsight, resolve and review a new immutable image digest, update both `compose.hindsight.yml` and its verifier, then rerun the full contract gate and a fresh live smoke. Do not replace the digest with `latest`.

## Operator Workflow

Print the supported command surface:

```bash
node scripts/supermemory-operator.mjs
node scripts/supermemory-operator.mjs --json
```

### Client Onboarding

Bootstrap a client or project from an explicit local folder. The onboarding tool inventories only the selected `--source-root`, applies include/exclude patterns, writes a redacted review plan, and commits source/snapshot registry entries only after owner confirmation:

```bash
node scripts/supermemory-onboard.mjs --client "Client ACME" --workspace workspace:acme --source-root /path/to/client-folder --include "**/*.md" --include "**/*.json" --exclude "**/.env*" --requested-by owner:name --capture-reason "client memory bootstrap" --write-plan /path/to/onboarding-plan.json --json
node scripts/supermemory-onboard.mjs --apply-plan /path/to/onboarding-plan.json --out-dir /path/to/onboarding-staging --json
node scripts/supermemory-onboard.mjs --commit-staging /path/to/onboarding-staging --vault-root identity-vault --owner-confirmed --json
```

The onboarding flow does not compile memory, promote to Hindsight, or call network services. Secret-like source files are kept review-gated and raw content is not persisted in the plan or staging artifacts. Source ids include a relative-path hash to avoid slug collisions.

### Manual Capture

Create a reviewed capture plan, apply it to staging, then commit only after owner confirmation:

```bash
node scripts/local-manual-capture.mjs --file /path/to/source.md --scope /path/to/scope --workspace workspace:example --requested-by owner:name --capture-reason "manual evidence" --write-plan /path/to/manual-capture-plan.json --json
node scripts/local-manual-capture.mjs --apply-plan /path/to/manual-capture-plan.json --out-dir /path/to/manual-capture-staging --json
node scripts/local-manual-capture.mjs --commit-staging /path/to/manual-capture-staging --vault-root identity-vault --owner-confirmed --json
```

At commit time, the tool rereads the exact reviewed file, verifies its hash and path identity, writes the real bytes as an immutable `0600` content-addressed snapshot, and then updates both registries through a lock and recoverable transaction. If the source changed after review, or either registry commit fails, the operation fails closed and restores the previous registry state.

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

The live runner creates and applies a reviewed temporary promotion plan for each governed fixture. The transport has bounded timeouts and reports completed and pending requests after a partial failure; it does not automatically retry writes whose outcome may be ambiguous.

## Observability

Use JSON outputs from the release verifier, operator workflow, smoke runner, and promotion CLI as the operational audit trail. Redacted evidence may be kept under `tmp/` during local work. Commit only docs, scripts, fixtures, tests, and reviewed GoalBuddy receipts.

## Rollback

Rollback code with Git:

```bash
git revert <release-commit-sha>
node scripts/verify-supermemory-release-readiness.mjs
```

Interrupted registry transactions recover on the next commit, and failures detected during a commit restore both registry files immediately. If operator rollback is still needed after a completed transaction, restore reviewed prior registry entries with a new bounded change; never delete content-addressed snapshot evidence merely to hide history. Then rerun the release gate and the relevant capture or refresh workflow smoke.

## Credential Boundaries

Do not commit `.env`, live smoke evidence, API keys, bank ids, or raw customer data. Run `npm run verify:secrets` before release. CI must remain mock-only. Live Hindsight writes require `HINDSIGHT_API_KEY`, `HINDSIGHT_BANK_ID`, `HINDSIGHT_BASE_URL`, `SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1`, and an owner-confirmed reviewed plan. See `SECURITY.md` for reporting guidance.

## Non-goals

- No hosted SaaS UI.
- No Gmail, Drive, CRM, web crawler, or paid external source connectors in this release.
- No real production customer data in tests.
- No database migrations, background workers, auth/RLS, billing, or multi-tenant web deployment.
- No Hindsight Cloud dependency.
- No live writes in CI.
