# SuperMemory Production Runbook

## Memory Fabric v2.3 — client Codex multi-projet

Le runtime v6 ne contient plus de projet fixe. Z2 authentifie chaque checkout
avec un jeton opaque, résout côté serveur son couple workspace/projet et garde
un contexte mémoire borné par projet. Le rappel fusionne uniquement la mémoire
du projet courant avec les préférences globales explicitement promues par le
propriétaire.

Installer ou actualiser le client Codex stable sur le Mac mini :

```bash
npm run plugin -- plan
npm run plugin -- apply --plan-hash <sha256-du-plan>
```

Enrôler ensuite chaque dépôt depuis sa racine. Le plan est non-mutant ;
l'application crée le projet/checkout sur Z2, écrit les marqueurs Git locaux
et installe le jeton checkout avec le mode `0600` :

```bash
npm run client -- enroll-plan --project-root "$PWD"
npm run client -- enroll-apply --project-root "$PWD" --plan-hash <sha256-du-plan>
```

Pour un dépôt déjà enrôlé mais sans jeton local, utiliser
`npm run client -- credential-issue --project-root "$PWD"`. Un nouveau
checkout doit être enrôlé séparément ; ne jamais copier son jeton.

L'import historique reste local et explicite. Il ne lit que les événements
Codex visibles autorisés, exclut le raisonnement, les instructions et les
arguments/sorties d'outils, puis reprend de façon idempotente :

```bash
npm run history -- plan --project-root "$PWD"
npm run history -- apply --project-root "$PWD" --plan-hash <sha256-du-plan>
```

Après installation du plugin ou modification de sa confiance, ouvrir une
nouvelle session Codex. La confiance des hooks reste une décision manuelle du
propriétaire. La production demeure un déploiement intégral : sauvegarde,
remplacement atomique de la stack, tests de santé, rollback complet si besoin ;
aucun canari ni rollout progressif.

## Full server runtime deployment

The heavy AI, temporal-graph and continuous-improvement runtime is packaged as
one atomic Docker/Portainer stack in
`deploy/portainer/supermemory-ai-stack.yml`. Its operator procedure, capacity
gate, private secret files, SSH tunnel, idempotent Neo4j migration, health
checks, offline backup, exact-confirmation restore and complete rollback are
documented in `deploy/portainer/README.md`.

Do not deploy that stack service by service and do not use a canary or
progressive rollout. Validate the complete Compose artifact first, take the
required backup, then deploy or roll back the full stack in one operator
action. Repository verification never starts containers or contacts
Portainer; the real deployment remains an explicit server operation.

The Mac mini M4 Pro is the trusted workstation and must
not run the production daemon, Hindsight or Neo4j. Z2 owns the encrypted
canonical vault, runtime, backups, learned plane and temporal graph. The Mac
mini runs Codex, the SuperMemory plugin/hooks, an encrypted offline spool, the
browser and one persistent SSH tunnel.

Generate its remote-only configs and tunnel LaunchAgent with
`scripts/configure-z2-client.mjs`. In this mode hooks resolve the immutable Git
project markers locally, send captures and recall through `127.0.0.1:8765`,
keep only encrypted outage/equivalence state on the Mac, and drain the outage
spool automatically when the Z2 tunnel returns. The MCP runtime has no local
vault path.
Before the single server deployment, run only the non-mutating local
gates:

```bash
npm ci --ignore-scripts
npm run verify:memory-fabric-v2
npm run verify:secrets
docker compose \
  --env-file deploy/portainer/supermemory-ai.env.example \
  -f deploy/portainer/supermemory-ai-stack.yml \
  config --quiet
git diff --check
```

These commands do not pull an image or start a container. The operator then
follows `deploy/portainer/README.md` for capacity, backup, the one full
Portainer deployment, health validation and full rollback.

This runbook operates the production-shaped, single-user, local-first
SuperMemory product. The Z2 deployment uses exactly one generative provider:
OpenAI through ChatGPT/Codex Pro, model `gpt-5.6-luna`, reasoning `high`. It has
no local generative model, OpenRouter fallback, canary or progressive rollout.
It covers prerequisite diagnosis, launch, the browser workflow, verified
backup and recovery, real product smoke, readiness gates, rollback,
observability, and non-goals. It does not turn SuperMemory into a hosted SaaS
product and never makes live writes in CI.

## Legacy v1 product release preflight

The remaining local-Ollama/Hindsight procedures below are retained only for
historical v1 compatibility and tests. They are superseded by the Z2 procedure
for production and must not be started on the Mac mini.

The legacy procedures below are retained for the legacy v1
browser product and backward compatibility. They are not the Memory Fabric v2
deployment procedure.

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

## Legacy v1 local Hindsight setup

The supported compatibility runtime is local Ollama plus local/self-hosted Hindsight 0.9.0 through `compose.hindsight.yml`. SuperMemory expects `qwen3.5:9b` to be installed explicitly; it never pulls models itself.

```bash
ollama list
# Only when the model is absent:
ollama pull qwen3.5:9b
```

Start and diagnose the complete dependency chain:

```bash
docker compose -f compose.hindsight.yml up -d
npm run doctor -- --json
```

The compose file pins Hindsight 0.9.0 by digest, binds its ports to localhost, connects only to host Ollama, uses one local LLM request at a time, enables native observations, and leaves automatic consolidation disabled so the canonical worker controls closure boundaries. The product doctor rejects remote Hindsight, remote Ollama, missing model, unsafe vaults, backup paths inside the vault, missing dependencies, and unhealthy services. Hindsight Cloud is never an implicit product fallback.

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

## Codex Integration

The Codex integration is local-first, project-bound and reversible. Do not copy
the plugin directly into a real Codex profile. Generate a read-only plan,
review it, then apply its exact hash. On macOS, the Desktop deployer is the
preferred path: it backs up the profile, removes only the structurally matched
legacy Codex Memory Compiler hooks, creates private runtime secrets, binds the
project, installs the plugin through Codex App Server, and runs the daemon from
a loopback-only LaunchAgent.

### Bind a Project

The Desktop deployer binds the project transactionally. The standalone command
remains useful for inspection or non-Desktop installations:

```bash
node scripts/supermemory-project.mjs init \
  --vault-root /absolute/path/to/identity-vault \
  --project-root /absolute/path/to/project \
  --name "Project name" \
  --json

node scripts/supermemory-project.mjs status \
  --vault-root /absolute/path/to/identity-vault \
  --project-root /absolute/path/to/project \
  --json
```

For a legacy `workspace:local`, initialization fails closed until the owner
uses `--adopt-legacy-workspace`. A copied checkout that conflicts with an
existing active binding also fails closed; use `--rebind-checkout` only after
reviewing the old checkout.

### Deploy to Codex Desktop on macOS

Create a private JSON file (`chmod 600`) outside the repository. Paths must be
absolute; the file contains locations and policy, not secret values:

```json
{
  "schema": "supermemory.codex-desktop-operator.v1",
  "codex_home": "/Users/you/.codex",
  "project_root": "/absolute/path/to/SuperMemory",
  "plugin_source": "/absolute/path/to/SuperMemory/plugins/supermemory",
  "vault_root": "/absolute/path/to/SuperMemory/identity-vault",
  "runtime_root": "/Users/you/.supermemory/runtime/codex",
  "key_file": "/Users/you/.supermemory/runtime/codex/archive.key",
  "token_file": "/Users/you/.supermemory/runtime/codex/daemon.token",
  "hook_script": "/absolute/path/to/SuperMemory/scripts/supermemory-hook.mjs",
  "mcp_script": "/absolute/path/to/SuperMemory/scripts/supermemory-mcp.mjs",
  "daemon_script": "/absolute/path/to/SuperMemory/scripts/supermemoryd.mjs",
  "node_path": "/absolute/path/to/node",
  "codex_desktop_executable": "/Applications/ChatGPT.app/Contents/Resources/codex",
  "install_backups_root": "/Users/you/.supermemory/backups/codex-installer",
  "desktop_backups_root": "/Users/you/.supermemory/backups/codex-desktop",
  "launch_agent_path": "/Users/you/Library/LaunchAgents/com.supermemory.codex-daemon.plist",
  "launch_agent_label": "com.supermemory.codex-daemon",
  "daemon_endpoint": "http://127.0.0.1:8765",
  "project_name": "SuperMemory",
  "adopt_legacy_workspace": true
}
```

Generate the plan. This inspects the Desktop runtime with `plugin/list` and
`hooks/list`, fingerprints every mutable target, and performs no intended
profile/configuration write:

```bash
npm run desktop -- plan \
  --config /private/path/codex-desktop-operator.json \
  --out /private/path/codex-desktop-plan.json
```

Review `observed`, `actions`, `blockers`, and the exact `plan_hash`. Apply only
that unchanged plan:

```bash
npm run desktop -- apply \
  --config /private/path/codex-desktop-operator.json \
  --plan /private/path/codex-desktop-plan.json \
  --confirm "DEPLOY sha256:<exact-plan-hash>"
```

The command returns the private manifest path. It never records key or token
values. A successful result can still be `installed_trust_required`: Codex
intentionally does not trust plugin hooks during installation. In the Desktop
plugin/hook review, inspect the SuperMemory hook definition and approve it.
Do not edit the trust state by hand. Start a new task after approval.

Codex renamed the feature flag from the deprecated
`[features].codex_hooks` alias to `[features].hooks`. New deployments enable
the canonical flag automatically. Upgrade an already deployed profile through
the same reviewed, reversible workflow:

```bash
npm run desktop -- hooks-feature-plan \
  --config /private/path/codex-desktop-operator.json \
  --out /private/path/hooks-feature-plan.json

npm run desktop -- hooks-feature-apply \
  --config /private/path/codex-desktop-operator.json \
  --plan /private/path/hooks-feature-plan.json \
  --confirm "MIGRATE sha256:<exact-plan-hash>"
```

The migration replaces only the feature assignment, enables `hooks = true`,
removes the deprecated alias, preserves unrelated TOML bytes and stores a
private verified backup. Roll it back before a full Desktop deployment
rollback:

```bash
npm run desktop -- hooks-feature-rollback \
  --config /private/path/codex-desktop-operator.json \
  --manifest /private/path/from-feature-apply/manifest.json \
  --confirm "ROLLBACK <hooks-feature-migration-id>"
```

Check the effective runtime:

```bash
SUPERMEMORY_VAULT_ROOT=/absolute/path/to/SuperMemory/identity-vault \
SUPERMEMORY_BACKUPS_ROOT=/Users/you/.supermemory/backups \
SUPERMEMORY_CODEX_DESKTOP_EXECUTABLE=/Applications/ChatGPT.app/Contents/Resources/codex \
SUPERMEMORY_CODEX_KEY_FILE=/Users/you/.supermemory/runtime/codex/archive.key \
SUPERMEMORY_CODEX_TOKEN_FILE=/Users/you/.supermemory/runtime/codex/daemon.token \
SUPERMEMORY_CODEX_DAEMON_ENDPOINT=http://127.0.0.1:8765 \
npm run doctor -- --codex --json

npm run desktop -- status \
  --config /private/path/codex-desktop-operator.json
```

`ready: true` requires a bound project, installed/enabled plugin, trusted
plugin hooks, no legacy Codex hook, a loaded LaunchAgent, and an authenticated
healthy daemon. Hook capture remains honestly `partial`: local lifecycle and
tool events are covered, but hosted tools and cloud/web work are not.

The cutover changes only matching `claude-memory-compiler` blocks in
`~/.codex/config.toml`; `~/.claude/settings.json` is reported but left
untouched. A Remote/SSH project needs the same runtime installed on that remote
host because plugins, MCP servers and files come from the execution host.

Rollback uses the manifest stored by apply:

```bash
npm run desktop -- rollback \
  --config /private/path/codex-desktop-operator.json \
  --manifest /private/path/from-apply/manifest.json \
  --confirm "ROLLBACK <desktop-install-id>"
```

Rollback restores the pre-deployment Codex config, plugin and LaunchAgent,
keeps the canonical vault and project binding, and saves the post-install
runtime as a safety copy before restoring/removing it.

### Low-level Codex Installer

The lower-level installer remains available for isolated profiles and
non-macOS hosts. It does not perform the Desktop legacy-hook cutover,
LaunchAgent setup, plugin trust review, or project binding.

Create a private operator file:

```json
{
  "schema": "supermemory.codex-operator.v1",
  "codex_home": "/absolute/path/to/isolated-or-user-codex-home",
  "project_root": "/absolute/path/to/project",
  "plugin_source": "/absolute/path/to/SuperMemory/plugins/supermemory",
  "vault_root": "/absolute/path/to/identity-vault",
  "runtime_root": "/absolute/path/to/private-runtime",
  "key_file": "/absolute/path/to/private-runtime/archive.key",
  "token_file": "/absolute/path/to/private-runtime/daemon.token",
  "hook_script": "/absolute/path/to/SuperMemory/scripts/supermemory-hook.mjs",
  "mcp_script": "/absolute/path/to/SuperMemory/scripts/supermemory-mcp.mjs",
  "daemon_endpoint": "http://127.0.0.1:8765",
  "install_backups_root": "/absolute/path/to/install-backups",
  "vault_backups_root": "/absolute/path/to/vault-backups"
}
```

The key and token files must be regular, non-symlinked `0600` files. Keep the
vault backups outside the vault.

### Plan, Install and Diagnose with the Low-level Installer

Generate the plan without writing to the Codex profile:

```bash
npm run codex -- install-plan \
  --config /private/path/codex-operator.json \
  --out /private/path/install-plan.json
```

Review `warnings`, duplicate-hook detection, native-memory status and target
fingerprints. Apply only that exact reviewed plan:

```bash
npm run codex -- install-apply \
  --config /private/path/codex-operator.json \
  --plan /private/path/install-plan.json \
  --confirm "APPLY sha256:<exact-plan-hash>" \
  --out /private/path/install-manifest.json
```

The install writes only the SuperMemory plugin, private plugin runtime metadata
and project-local runtime metadata, including the repository marketplace used
by Codex discovery. It preserves unrelated marketplace entries and any
existing targets in a dedicated backup; it does not govern Codex native
memories or silently trust the repository. Open the repository as a trusted
Codex project and review/activate the installed-by-default SuperMemory plugin
if the client presents that choice. Diagnose the effective local capability
profile:

```bash
SUPERMEMORY_VAULT_ROOT=/absolute/path/to/identity-vault \
SUPERMEMORY_BACKUPS_ROOT=/absolute/path/to/vault-backups \
SUPERMEMORY_CODEX_KEY_FILE=/absolute/path/to/private-runtime/archive.key \
npm run doctor -- --codex --json
```

`capture_coverage: rich` requires the tested App Server protocol and an
actually configured host integration. Merely detecting a compatible Codex
binary is not enough. Hook-only coverage is reported as `partial`;
cloud/web coverage remains `none`. The doctor reports App Server availability,
configuration and runtime observation as separate facts.

### Runtime Flow

In production, start the complete Z2 Compose stack and persistent Mac mini SSH
tunnel before Codex. The daemon port forwarded to `127.0.0.1:8765` must match
`daemon_endpoint`. Standard trusted Codex clients use the project plugin,
hooks and MCP tools. The historical App Server wrapper below writes directly
to a same-host vault and is therefore a compatibility/debug surface only; do
not use it for the remote Z2 production path:

```bash
npm run app-server -- \
  --config /absolute/path/to/project/.codex/supermemory/app-server-runtime.json
```

That wrapper is a JSON-RPC App Server transport, not an interactive terminal
UI. If it is not the client transport, capture remains honestly `partial`.

On session start, the plugin resolves the project binding from its Git markers
and may inject only a small set of active, cited memories returned by Z2.
During a session, visible supported events are redacted and deduplicated before
being sent through the authenticated tunnel. If Z2 is unavailable, they are
persisted only in the encrypted Mac outage spool and drained before the next
online capture.
An `assistant.completed` event is acknowledged immediately after durable
capture; the daemon then compiles it asynchronously. It groups the redacted
prompt, visible assistant answer and supported tool events into an immutable
turn snapshot, writes an encrypted conversation archive, and asks the sole
OpenAI Codex provider (`gpt-5.6-luna`, reasoning `high`) for at most one
structured durable-memory proposal. Shell, web search, plugins and other agent
tools are disabled for this constrained extraction. Transient chat produces an
archive without a candidate. Provider failure never
loses the capture: the archived turn remains retryable and startup recovery
replays unfinished compilation. The same startup pass drains every encrypted
outage spool before scheduling compilation, so a daemon restart preserves event
ordering and never compiles a partial spooled turn. Compilation is idempotent
per completed turn.

Every extracted candidate is independently verified and evaluated by the
deterministic automatic admission policy. Standard evidence-backed candidates
activate; conflicts, permission risks, high-impact facts and destructive
ontology changes remain quarantined for human exception review. The daemon
`/health` response exposes only content-free counters under `compiler`
(`pending`, `compiled`, `candidates`, `archived_only`, `retryable`); the doctor
blocks readiness when the compiler is missing or retryable work remains.
The project-bound MCP server answers from canonical active memory, optionally
using Hindsight for ranking, and falls back to deterministic local recall when
Hindsight is unavailable.

Use a private `0600` review configuration:

```json
{
  "schema": "supermemory.review-runtime.v1",
  "vault_root": "/absolute/path/to/identity-vault",
  "workspace_id": "<workspace-id>",
  "project_id": "<project-id>"
}
```

Then inspect and decide candidates. Approval requires the exact candidate ID as
confirmation:

```bash
npm run review -- --config /private/path/review.json list
npm run review -- --config /private/path/review.json approve <candidate-id> \
  --confirm <candidate-id> \
  --title "Reviewed title" \
  --text "Reviewed canonical memory"
```

### Legacy Migration

Migration is always dry-run first. It refuses an unbound
`workspace:local`, ambiguous source collisions and any plan whose state changed
after review:

```bash
npm run codex -- migration-plan \
  --config /private/path/codex-operator.json \
  --out /private/path/migration-plan.json

npm run codex -- migration-apply \
  --config /private/path/codex-operator.json \
  --plan /private/path/migration-plan.json \
  --confirm "APPLY <migration-id-from-reviewed-plan>" \
  --out /private/path/migration-checkpoint.json
```

Apply creates and verifies a complete external vault backup before importing
legacy approved memory. Reapplying the same migration is idempotent.

### Rollback

Rollback an installation with the exact manifest identifier:

```bash
npm run codex -- install-rollback \
  --config /private/path/codex-operator.json \
  --manifest /private/path/install-manifest.json \
  --confirm "ROLLBACK <install-id>"
```

Rollback a migration with its exact checkpoint:

```bash
npm run codex -- migration-rollback \
  --config /private/path/codex-operator.json \
  --checkpoint /private/path/migration-checkpoint.json \
  --confirm "ROLLBACK <migration-id>"
```

Both operations preserve the current vault through a verified safety backup and
leave dual capture disabled. Git rollback is still for code only; never use Git
to roll back user memory.

### Release Evidence

Run the isolated Codex integration test (this is a disposable fixture, never a
deployment strategy):

```bash
npm run test:codex-integration -- --json
npm run verify:codex -- --json
```

The sacrificial integration test creates only temporary local fixtures. It asks the real
Codex App Server to discover and activate the repository plugin, exercises the
installed bridge, encrypted outage spool, replay, review, cited MCP recall,
source invalidation, deletion and installer rollback, then removes the fixture.
The verifier must contain exactly 80 unique acceptance IDs and no failed gate.
It remains honest about observation: the CLI/App Server protocol is exercised,
but a Desktop or third-party IDE UI is not; Codex web/cloud is not covered.
Final production approval requires reviewing the dated runtime evidence,
deletion and rollback results, plus the full pre-release audit.

## Observability

Use JSON outputs from the doctor, release verifier, operator workflow, product smoke, adapter smoke, and promotion CLI as the operational audit trail. Redacted evidence may be kept under ignored `tmp/` during local work. Check `/health`, the app status strip, pending projection/deletion counts, and the **Gérer** tab before declaring recovery complete.

## Rollback

Rollback code with Git:

```bash
git revert <release-commit-sha>
node scripts/verify-supermemory-release-readiness.mjs
```

Interrupted registry transactions recover on the next commit, and failures detected during a commit restore both registry files immediately. If operator rollback is still needed after a completed transaction, restore reviewed prior registry entries with a new bounded change; never delete content-addressed snapshot evidence merely to hide history. Then rerun the release gate and the relevant capture or refresh workflow smoke.

Do not use Git to roll back user data. Restore a verified vault backup through
the web product. If reconstruction remains pending, canonical data is already
restored safely: restore OpenAI/Codex authentication and Hindsight health, then
use **Resynchroniser**.

## Credential Boundaries

Do not commit `.env`, live smoke evidence, API keys, bank ids, backups, or raw customer data. Run `npm run verify:secrets` before release. The loopback product does not need an API key; the legacy governed promotion workflow and readiness preflight retain explicit environment gates. CI must remain mock-only. See `SECURITY.md` for reporting guidance.

## Non-goals

- No hosted SaaS UI.
- No Gmail, Drive, CRM, web crawler, or paid external source connectors in this release.
- No real production customer data in tests.
- No database migrations, background workers, auth/RLS, billing, or multi-tenant web deployment.
- No Hindsight Cloud dependency.
- No live writes in CI.
