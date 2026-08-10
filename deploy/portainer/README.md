# SuperMemory Personal Manager production stack — Z2

Memory Fabric v2.5 utilise le contrat runtime v8 et l'image
`supermemory-runtime:5.0.0`. Les identifiants workspace/projet ne sont plus des
variables globales de stack : chaque checkout Codex s'authentifie avec son
jeton et le daemon résout son périmètre dans le registre canonique. La
migration v7 vers v8 conserve le coffre et le graphe ; elle exige une
sauvegarde complète avant le redéploiement direct de toute la stack.

Z2 is the always-on, single-user production authority. It owns the encrypted
canonical vault, runtime spool, backups, learned memory and temporal graph.
Home 101 runs the existing native Hermes Personal Manager and its action
connectors. It reaches the Z2 daemon through a restricted SSH local forward.
The Mac mini M4 Pro is only a trusted work client: Codex captures through its
own SSH tunnel and the browser displays the two private interfaces.

The six Compose services on Z2 are:

1. `hindsight` 0.9.0 for learned memory and its Control Plane;
2. `neo4j` 5.26 LTS for the canonical temporal projection;
3. `neo4j-migrate` for idempotent graph constraints;
4. `supermemory-graphd` for authenticated workspace-scoped graph access;
5. `supermemory-daemon` for capture, governed Personal Manager APIs, recall and canonical compilation;
6. `supermemory-web` for the SuperMemory product interface.

There is exactly one generative provider and one model across the native
Hermes installation on Home 101, Hindsight and the canonical pipeline on Z2.
The `llm` block is the desired-state contract: Home 101 must match its provider,
model and `high` reasoning settings. `fallback_provider` remains `null`. There
is no Ollama, local generative model, provider failover, canary or progressive
rollout. Local embedding and reranking inside Hindsight remain non-generative
infrastructure.

## Capacity gate

The default hard memory limits total about 9.5 GiB before Docker and operating
system overhead. Require at least 16 GiB genuinely available RAM and 35 GiB
free disk; 32 GiB RAM gives comfortable room for the vault, indexes and
backups. No GPU or NVIDIA driver is required by this stack.

## Server directories and secrets

Create all state outside Git. The runtime containers run as uid/gid 1000;
Neo4j runs with gid 7474.

```bash
sudo install -d -m 0700 -o 1000 -g 1000 \
  /opt/supermemory/vault \
  /opt/supermemory/runtime \
  /opt/supermemory/backups \
  /opt/supermemory/codex-auth
sudo install -d -m 0700 -o root -g root \
  /opt/supermemory/secrets \
  /opt/supermemory/config
```

The required secret files are:

| File | Purpose | Owner/mode |
| --- | --- | --- |
| `neo4j_auth` | `neo4j/<password>` | `root:7474 0440` |
| `graphd_token` | GraphD root token | `root:1000 0440` |
| `archive_key` | 32-byte capture/vault encryption key | `root:1000 0440` |
| `daemon_token` | daemon bearer, at least 32 bytes | `root:1000 0440` |
| `agent_token` | owner-bound Home 101 Hermes token, at least 32 bytes | `root:1000 0440` |
| `hermes_llm_credential` | OpenRouter key when selected; inert placeholder for Codex OAuth | `root:1000 0440` |

Generate new Neo4j and GraphD credentials only for a fresh installation. The
archive key and daemon token must be copied from the current canonical Mac mini
runtime during migration; replacing the archive key would make existing
encrypted records unreadable.

```bash
NEO4J_PASSWORD_VALUE=$(openssl rand -base64 36 | tr -d '\n')
printf 'neo4j/%s\n' "$NEO4J_PASSWORD_VALUE" | \
  sudo tee /opt/supermemory/secrets/neo4j_auth >/dev/null
openssl rand -hex 32 | \
  sudo tee /opt/supermemory/secrets/graphd_token >/dev/null
AGENT_TOKEN_VALUE="sma_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
printf '%s\n' "$AGENT_TOKEN_VALUE" | \
  sudo tee /opt/supermemory/secrets/agent_token >/dev/null
sudo install -m 0440 -o root -g 1000 /dev/null \
  /opt/supermemory/secrets/hermes_llm_credential
sudo chown root:7474 /opt/supermemory/secrets/neo4j_auth
sudo chown root:1000 \
  /opt/supermemory/secrets/graphd_token \
  /opt/supermemory/secrets/agent_token \
  /opt/supermemory/secrets/hermes_llm_credential
sudo chmod 0440 /opt/supermemory/secrets/*
unset NEO4J_PASSWORD_VALUE AGENT_TOKEN_VALUE
```

Never put secret values or `auth.json` in Portainer variables, `.env`, Git,
logs or tickets.

## ChatGPT/Codex authentication

Authenticate Codex on a trusted interactive machine with the intended ChatGPT
Pro account. For the headless Z2, copy the resulting `auth.json` over SSH into
`/opt/supermemory/codex-auth/auth.json`, then enforce:

```bash
sudo chown -R 1000:1000 /opt/supermemory/codex-auth
sudo chmod 0700 /opt/supermemory/codex-auth
sudo chmod 0600 /opt/supermemory/codex-auth/auth.json
```

This credential grants model usage through the personal subscription and must
be treated as a high-value secret. On Z2 it is used by Hindsight 0.9.0 and the
pinned Codex CLI. Hermes keeps its own existing OpenAI Codex OAuth session under
the dedicated `agent` account on Home 101. Do not configure an API key or a
second provider in parallel.

For OpenRouter, set the single provider and model only in
`runtime-contract.json`, write the key to
`/opt/supermemory/secrets/hermes_llm_credential`, and leave Codex OAuth unused.
The Z2 credential is consumed by Hindsight and the canonical pipeline; Home 101
must be configured with the same single OpenRouter provider separately.

## Personal Manager credential operations

The browser shows credential status but never receives the agent token. Rotate
by first replacing the protected `agent_token` file, copying it securely to
Home 101, then adopting its hash and Home 101 device binding in the canonical
credential ledger before restarting Hermes:

```bash
npm run personal-manager:credential -- \
  --vault-root /opt/supermemory/vault \
  --rotate-from-file \
  --agent-token-file /opt/supermemory/secrets/agent_token \
  --device-id device_home101 \
  --confirm 'ROTATE personal-manager credential'
```

Emergency revocation is immediate and invalidates context, recall, capture and
mutation calls. It intentionally requires a later operator rotation to restore
service:

```bash
npm run personal-manager:credential -- \
  --vault-root /opt/supermemory/vault \
  --revoke \
  --confirm 'REVOKE personal-manager credential'
```

## Configuration and preflight

Create a private environment file and install the runtime v8 contract:

```bash
cp deploy/portainer/supermemory-ai.env.example \
  /opt/supermemory/config/supermemory-ai.env
cp deploy/runtime/runtime-contract.production.json \
  /opt/supermemory/config/runtime-contract.json
chmod 0600 /opt/supermemory/config/supermemory-ai.env
chown root:1000 /opt/supermemory/config/runtime-contract.json
chmod 0640 /opt/supermemory/config/runtime-contract.json
```

The v8 runtime contract at
`/opt/supermemory/config/runtime-contract.json` must activate Working Memory,
Topic Continuity, Temporal Retrieval, Quiet Authority, offload, Hindsight,
GraphD, continuous improvement and longitudinal consolidation with
`deployment.activation=full`.
It must point GraphD to `http://127.0.0.1:8787` and its token file to
`/run/supermemory/graphd.token`. Its Personal Manager block fixes Home 101 as
the agent runtime, `device_home101` as its credential binding and
`http://127.0.0.1:18765` as the tunnel-local endpoint.

## Home 101 Hermes runtime

Hermes is installed and operated outside this Compose stack under the dedicated
`agent` account on Home 101. Follow `deploy/home101/README.md` to install the
`supermemory-fabric` user plugin, restricted SSH tunnel, agent token and native
Hermes gateway system service. Z2 port `8765` remains bound to loopback and is
never exposed on the LAN.

Run the non-mutating structural gates:

```bash
npm ci --ignore-scripts
npm run verify:memory-fabric-v2
npm run verify:memory-fabric-v22
npm run verify:memory-fabric-v24
npm run verify:secrets
docker compose \
  --env-file /opt/supermemory/config/supermemory-ai.env \
  -f deploy/portainer/supermemory-ai-stack.yml \
  config --quiet
```

Before replacing an existing Neo4j instance, create and verify a backup:

```bash
SUPERMEMORY_ENV_FILE=/opt/supermemory/config/supermemory-ai.env \
  deploy/portainer/neo4j-backup.sh
```

## Canonical vault migration from the Mac mini M4 Pro

Stop writes only for the final synchronization. Copy the Mac mini vault into a new
staging directory on Z2, compare a sorted SHA-256 manifest on both machines,
then rename the verified staging directory atomically to
`/opt/supermemory/vault`. Copy the existing archive key, daemon token and
GraphD token through SSH with their modes preserved. Never use an unverified
copy as the production authority and never keep two writable canonical vaults.

Once Z2 passes the full post-deployment smoke, unload the old Mac mini daemon. Keep
only its encrypted offline spool so captures remain recoverable while the SSH
tunnel or Z2 is unavailable.

## Atomic deployment

Use Portainer **Docker Standalone → Stacks → Add stack → Git repository**, or
run the equivalent command from the checked-out repository:

```bash
docker compose \
  --env-file /opt/supermemory/config/supermemory-ai.env \
  -f deploy/portainer/supermemory-ai-stack.yml \
  up -d --build --wait --remove-orphans
```

The dependency chain is deterministic: Hindsight and Neo4j become healthy,
the graph migration completes, GraphD becomes healthy, the daemon starts, then
the web interface starts. Home 101 Hermes reconnects through its independent
systemd tunnel. Deploy the complete Z2 artifact; do not release selected Z2
services individually.

At daemon startup, Working Set temporal metadata, Topic memberships and graph
authority/temporal state are migrated idempotently from the canonical vault.
Historical roots become isolated topics and only verified fork chains inherit a
topic. Semantic similarity never merges historical topics automatically. A
failed projection leaves capture durable and is repaired through the bounded
fabric rebuild operation.

`--remove-orphans` removes containers from the retired local-LLM topology. It
does not delete named volumes. Never use `docker compose down -v`.

## Private Mac mini M4 Pro connection and visualization

Every published service binds to Z2 loopback. Establish one authenticated SSH
tunnel from the Mac mini:

```bash
ssh -N \
  -L 4310:127.0.0.1:4310 \
  -L 8765:127.0.0.1:8765 \
  -L 9999:127.0.0.1:9999 \
  -L 8888:127.0.0.1:8888 \
  -L 8787:127.0.0.1:8787 \
  user@z2
```

The repository can generate the remote-only hook/MCP configs and persistent
macOS LaunchAgent without retaining a writable vault on the Mac mini:

```bash
node scripts/configure-z2-client.mjs --project-root "$PWD"
node scripts/configure-z2-client.mjs --project-root "$PWD" --apply
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.supermemory.z2-tunnel.plist"
```

The first command is a read-only plan. The second writes private `0600`
configuration and the LaunchAgent. Unload the retired local daemon before
bootstrapping the tunnel because both use local port `8765`.

- `http://127.0.0.1:4310` is the SuperMemory product UI: sources, cited search,
  backups, **Personal Manager**, **Travail** and silent **Exceptions**. Travail accepts only a bound
  `working_set_id`; the browser never lists or selects a raw `topic_id`.
- `http://127.0.0.1:9999` is the Hindsight Control Plane: banks, entities,
  relationships, Constellation graph, operations and recall/reflect tests.
- `127.0.0.1:8765` is the authenticated Codex capture/recall daemon.
- `8888` and `8787` are optional operator diagnostics.

Neo4j has no host port and remains inaccessible from the Mac mini and the LAN. GraphD
accepts only bounded workspace-scoped operations, never raw Cypher.

## Post-deployment verification

On Z2, verify service health without printing credentials:

```bash
curl -fsS http://127.0.0.1:8888/health
curl -fsS http://127.0.0.1:8787/ready
curl -fsS http://127.0.0.1:4310/api/status
docker compose \
  --env-file /opt/supermemory/config/supermemory-ai.env \
  -f deploy/portainer/supermemory-ai-stack.yml \
  ps --format json
```

Then run one complete authenticated flow through the Mac mini tunnel: capture,
automatic admission, topic resolution, checkpoint, temporal graph projection,
hybrid cited recall, evidence-coverage audit and visualization in both UIs.
Restart the stack and repeat health, topic recall and authority checks to prove
persistence.

The Z2 runtime and Home 101 Hermes must report exactly the provider/model
selected in the v8 contract and reasoning `high`. Any drift, missing
authentication, provider fallback or model substitution fails closed.

## Backup, restore and rollback

Restore requires the exact phrase `RESTORE neo4j`, verifies the selected
SHA-256 file, creates a safety backup, stops GraphD and Neo4j, loads the
database, then starts the complete stack:

```bash
SUPERMEMORY_ENV_FILE=/opt/supermemory/config/supermemory-ai.env \
  deploy/portainer/neo4j-restore.sh \
  neo4j-YYYYmmddTHHMMSSZ.dump \
  'RESTORE neo4j'
```

For application rollback, redeploy the previous reviewed Git revision. For a
data-format rollback, restore the exact verified vault/Neo4j backups. Never
delete named volumes or treat Git rollback as data recovery.

The product vault backup includes the encrypted Topic, Authority and Exception
ledgers as well as checkpoints. Product restore verifies hashes, keeps a safety
copy, atomically replaces the vault, then requests a deterministic fabric
rebuild. Stop capture writes for the final production restore window; do not
run two writable canonical vaults.

## Image and migration policy

- Hindsight remains exactly 0.9.0 and digest-pinned.
- Neo4j remains on the pinned 5.26 LTS line.
- The runtime image pins the Codex CLI version and runs as uid/gid 1000.
- GraphD keeps an explicit major image and contract version.
- Any image change requires backup, Compose validation, complete-stack deploy
  and six-service health verification.
- `neo4j-migrate` is idempotent; migration failure blocks GraphD and the daemon.
