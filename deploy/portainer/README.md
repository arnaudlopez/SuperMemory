# SuperMemory six-service production stack — Z2

Z2 is the always-on, single-user production authority. It owns the encrypted
canonical vault, runtime spool, backups, learned memory and temporal graph.
The Mac mini M4 Pro is only a trusted client: Codex captures through an SSH tunnel and
the browser displays the two private interfaces.

The six Compose services are:

1. `hindsight` 0.9.0 for learned memory and its Control Plane;
2. `neo4j` 5.26 LTS for the canonical temporal projection;
3. `neo4j-migrate` for idempotent graph constraints;
4. `supermemory-graphd` for authenticated workspace-scoped graph access;
5. `supermemory-daemon` for capture, recall and canonical compilation;
6. `supermemory-web` for the SuperMemory product interface.

There is exactly one generative provider and one model across the runtime:
OpenAI through the ChatGPT/Codex subscription, `gpt-5.6-luna`, reasoning
`high`. There is no Ollama, local generative model, OpenRouter fallback,
provider failover. There is no canary or progressive rollout. Hindsight and the daemon
share the same private Codex authentication directory. Local embedding and
reranking inside Hindsight remain non-generative infrastructure.

## Capacity gate

The default hard memory limits total about 11.5 GiB before Docker and operating
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
sudo chown root:7474 /opt/supermemory/secrets/neo4j_auth
sudo chown root:1000 /opt/supermemory/secrets/graphd_token
sudo chmod 0440 /opt/supermemory/secrets/*
unset NEO4J_PASSWORD_VALUE
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
be treated as a high-value secret. Both Hindsight 0.9.0 and the pinned Codex
CLI refresh it in the shared directory. Do not configure an API key or a
second provider in parallel.

## Configuration and preflight

Create a private environment file and set the real workspace and project IDs:

```bash
cp deploy/portainer/supermemory-ai.env.example \
  /opt/supermemory/config/supermemory-ai.env
cp deploy/runtime/runtime-contract.production.json \
  /opt/supermemory/config/runtime-contract.json
chmod 0600 /opt/supermemory/config/supermemory-ai.env
chmod 0644 /opt/supermemory/config/runtime-contract.json
```

The runtime contract at
`/opt/supermemory/config/runtime-contract.json` must activate Working Memory,
offload, Hindsight, GraphD and continuous improvement in full deployment mode.
It must point GraphD to `http://127.0.0.1:8787` and its token file to
`/run/supermemory/graphd.token`.

Run the non-mutating structural gates:

```bash
npm ci --ignore-scripts
npm run verify:memory-fabric-v2
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
the web interface starts. Deploy the complete artifact; do not release selected
services individually.

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

- `http://127.0.0.1:4310` is the SuperMemory product UI: sources, exceptions,
  cited search, projection freshness and backups.
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
automatic admission, temporal graph projection, hybrid cited recall, freshness
audit and visualization in both UIs. Restart the stack and repeat health and
recall checks to prove persistence.

The runtime must report only provider `openai-codex`, model `gpt-5.6-luna` and
reasoning `high`. Any drift, missing authentication, provider fallback or model
substitution fails closed.

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

## Image and migration policy

- Hindsight remains exactly 0.9.0 and digest-pinned.
- Neo4j remains on the pinned 5.26 LTS line.
- The runtime image pins the Codex CLI version and runs as uid/gid 1000.
- GraphD keeps an explicit major image and contract version.
- Any image change requires backup, Compose validation, complete-stack deploy
  and all-service health verification.
- `neo4j-migrate` is idempotent; migration failure blocks GraphD and the daemon.
