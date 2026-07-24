# SuperMemory Production Runbook

This runbook operates the production-shaped, single-user, local-first SuperMemory product. It covers prerequisite diagnosis, launch, the browser workflow, verified backup and recovery, real product smoke, readiness gates, rollback, observability, and non-goals. It does not turn SuperMemory into a hosted SaaS product and never makes live writes in CI.

## Release Preflight

Run the release gate before shipping:

```bash
npm ci --ignore-scripts
npm run doctor
node scripts/verify-supermemory-release-readiness.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

The release verifier is mock-only and reports `contract-ready`, never `production-ready`. It checks the global specs, Golden End State workflow, capture and refresh workflow smokes, reviewed Hindsight promotion tests, local Hindsight preflight expectations, Docker compose safety, operator workflow, CI wiring, and tracked-file hygiene.

Run the separate runtime gate only after a real smoke. It reruns the contract gate, requires a strict healthy preflight, and accepts only successful, redacted live evidence newer than 24 hours by default:

```bash
HINDSIGHT_API_KEY=local-loopback-no-auth \
HINDSIGHT_BANK_ID=supermemory-product \
HINDSIGHT_BASE_URL=http://127.0.0.1:8888 \
SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1 \
node scripts/verify-supermemory-runtime-readiness.mjs \
  --evidence-path tmp/supermemory-product-live-smoke.jsonl \
  --json
```

Even a `runtime-ready` result leaves `production_ready: false`; final production approval is a deliberate operator decision.

## Production Approval

After reviewing a fresh successful runtime report, record the explicit local-first production decision:

```bash
node scripts/verify-supermemory-production-readiness.mjs \
  --evidence-path tmp/supermemory-product-live-smoke.jsonl \
  --deployment-scope local-first-operator \
  --rollback-acknowledged \
  --owner-approved \
  --approval-reference <approval-reference> \
  --json
```

The approval reference is a non-secret audit label, not a credential. This verifier performs no live writes. It reruns contract and runtime readiness, rejects stale or invalid evidence, requires the decision to occur after the live evidence, and returns `production_ready: true` only when all approval requirements are present. Never reuse an approval to bypass a newer failed or expired runtime check.

## Local Hindsight Setup

The supported runtime is local Ollama plus local/self-hosted Hindsight through `compose.hindsight.yml`. SuperMemory expects `llama3:latest` to be installed explicitly; it never pulls models itself.

```bash
ollama list
# Only when the model is absent:
ollama pull llama3:latest
```

Start and diagnose the complete dependency chain:

```bash
docker compose -f compose.hindsight.yml up -d
npm run doctor -- --json
```

The compose file pins Hindsight by digest, binds its ports to localhost, connects only to host Ollama, uses one local LLM request at a time, and disables optional observations. The product doctor rejects remote Hindsight, remote Ollama, missing model, unsafe vaults, backup paths inside the vault, missing dependencies, and unhealthy services. Hindsight Cloud is never an implicit product fallback.

To upgrade Hindsight, resolve and review a new immutable image digest, update both `compose.hindsight.yml` and its verifier, then rerun the full contract gate and a fresh live smoke. Do not replace the digest with `latest`.

## Product Launch and Daily Workflow

On macOS, double-click `SuperMemory.command`, or run:

```bash
npm run launch
```

The launcher runs the doctor, starts Compose, waits for Hindsight health, launches the app on `127.0.0.1:4310`, opens the browser, and shuts the web server down cleanly on `Ctrl-C` or termination. It does not download a model.

The user workflow is:

1. **Importer:** select a complete local folder containing Markdown, TXT, PDF, or DOCX.
2. **Valider:** edit, approve, or reject each source-located candidate.
3. **Rechercher:** use only approved active memory; open the exact source citation.
4. **Gérer:** resolve missing sources, explicitly purge a source, create backups, or restore.

The vault is always canonical. Hindsight is a reconstructible projection. If Hindsight is down or returns no reconciled memory, the UI says so and uses deterministic cited local search.

Default paths:

```text
vault:   ./identity-vault
backup:  ~/.supermemory/backups
```

Override both with `SUPERMEMORY_VAULT_ROOT` and `SUPERMEMORY_BACKUPS_ROOT`. The doctor and backup manager refuse any backup directory inside the vault.

## Backup and Recovery

Use **Gérer → Créer une sauvegarde** before a risky data operation. A backup:

- is written outside the canonical vault;
- contains a versioned manifest with relative paths, sizes, modes, and SHA-256 hashes;
- rejects symbolic links and unsupported entries;
- is listed as usable only after complete verification.

Restore requires the exact phrase `RESTORE <backup-id>`. Before changing the vault, SuperMemory re-verifies all hashes and creates a pre-restore safety backup. It copies into a sibling staging directory, queues restored memories for projection, atomically swaps the vault, resets the dedicated derived bank, and reprojects active canonical memory. A failed validation leaves the active vault unchanged.

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

The production product smoke is stricter than the adapter smoke. It requires explicit authorization, creates a unique temporary bank, exercises real Markdown/TXT/PDF/DOCX ingestion, approval and rejection, verifies nonzero Hindsight extraction and reconciled cited recall, changes and deletes sources, restores a verified backup, restarts the server, and proves recovered recall. Successful temporary artifacts are cleaned automatically; failed artifacts are retained with a redacted path for diagnosis.

```bash
SUPERMEMORY_ALLOW_PRODUCT_LIVE_SMOKE=1 \
HINDSIGHT_BASE_URL=http://127.0.0.1:8888 \
npm run smoke:product:live -- \
  --execute-live \
  --json \
  --evidence-path tmp/supermemory-product-live-smoke.jsonl
```

This command never downloads a model and rejects non-loopback Hindsight.

## Observability

Use JSON outputs from the doctor, release verifier, operator workflow, product smoke, adapter smoke, and promotion CLI as the operational audit trail. Redacted evidence may be kept under ignored `tmp/` during local work. Check `/health`, the app status strip, pending projection/deletion counts, and the **Gérer** tab before declaring recovery complete.

## Rollback

Rollback code with Git:

```bash
git revert <release-commit-sha>
node scripts/verify-supermemory-release-readiness.mjs
```

Interrupted registry transactions recover on the next commit, and failures detected during a commit restore both registry files immediately. If operator rollback is still needed after a completed transaction, restore reviewed prior registry entries with a new bounded change; never delete content-addressed snapshot evidence merely to hide history. Then rerun the release gate and the relevant capture or refresh workflow smoke.

Do not use Git to roll back user data. Restore a verified vault backup through the web product. If reconstruction remains pending, canonical data is already restored safely: bring Ollama and Hindsight back to health, then use **Resynchroniser**.

## Credential Boundaries

Do not commit `.env`, live smoke evidence, API keys, bank ids, backups, or raw customer data. Run `npm run verify:secrets` before release. The loopback product does not need an API key; the legacy governed promotion workflow and readiness preflight retain explicit environment gates. CI must remain mock-only. See `SECURITY.md` for reporting guidance.

## Non-goals

- No hosted SaaS UI.
- No Gmail, Drive, CRM, web crawler, or paid external source connectors in this release.
- No real production customer data in tests.
- No database migrations, background workers, auth/RLS, billing, or multi-tenant web deployment.
- No Hindsight Cloud dependency.
- No live writes in CI.
