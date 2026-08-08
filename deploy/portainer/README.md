# SuperMemory full server stack — Docker/Portainer

This directory defines one atomic server deployment for every replaceable or
resource-heavy SuperMemory component:

- Ollama with `qwen3.5:9b` and Hindsight;
- Neo4j 5.26 LTS and Graphiti;
- the authenticated `supermemory-graphd` gateway;
- the idempotent `supermemory-improved` queue.

The encrypted canonical vault and `supermemoryd` remain on the trusted Codex
workstation. The server receives only authorized, redacted projections. It
never receives the vault key. Neo4j, Graphiti and the improvement worker have
no published host port; the workstation reaches graph and improvement routes
through `supermemory-graphd` only.

This is a full-stack deployment. There is no canary or progressive rollout.
Prepare and validate the complete artifact first, then deploy or roll back the
complete stack as one operator action.

## Capacity gate

The default hard limits total roughly 22 GiB before Docker and operating-system
overhead. Require at least 28 GiB genuinely available RAM and 35 GiB free disk
before first deployment; a 40–64 GiB server and an NVIDIA GPU with at least
12 GiB VRAM are recommended. Do not compensate for insufficient capacity by
running part of the stack on the workstation.

## Secret preparation on Docker Standalone

Portainer exposes managed Docker Secrets only for Swarm environments. This
stack targets the existing Docker Standalone workflow and uses Compose secret
files mounted read-only under `/run/secrets`. On the server, outside the Git
checkout:

```bash
sudo install -d -m 0700 /opt/supermemory/secrets
NEO4J_PASSWORD_VALUE=$(openssl rand -base64 36 | tr -d '\n')
printf 'neo4j/%s\n' "$NEO4J_PASSWORD_VALUE" | sudo tee /opt/supermemory/secrets/neo4j_auth >/dev/null
openssl rand -hex 32 | sudo tee /opt/supermemory/secrets/graphd_token >/dev/null
openssl rand -hex 32 | sudo tee /opt/supermemory/secrets/improved_token >/dev/null
openssl rand -hex 32 | sudo tee /opt/supermemory/secrets/improved_state_key >/dev/null
sudo chmod 0600 /opt/supermemory/secrets/*
unset NEO4J_PASSWORD_VALUE
```

Do not put these values in Portainer environment variables, `.env`, Git, logs
or tickets. `supermemory-ai.env.example` contains names and limits only.

## Full preflight

Copy the example environment file to a private server path and adjust resource
limits only after measuring capacity:

```bash
cp deploy/portainer/supermemory-ai.env.example deploy/portainer/supermemory-ai.env
docker compose \
  --env-file deploy/portainer/supermemory-ai.env \
  -f deploy/portainer/supermemory-ai-stack.yml \
  config --quiet
docker compose \
  --env-file deploy/portainer/supermemory-ai.env \
  -f deploy/portainer/supermemory-ai-stack.yml \
  build --pull
```

`config` is the offline structural gate. `build --pull` is an explicit
operator pre-deployment action and contacts the configured registries. The
implementation and CI checks never execute `pull`, `build`, `up`, Portainer
webhooks or a remote Docker API.

Before replacing an existing graph database, create and verify a backup:

```bash
SUPERMEMORY_ENV_FILE=/private/path/supermemory-ai.env \
  deploy/portainer/neo4j-backup.sh
```

The backup script performs an offline Neo4j Community dump, writes a SHA-256
sidecar inside the dedicated backup volume and restarts the entire stack.

## One full Portainer deployment

Use a Portainer **Docker Standalone → Stacks → Add stack → Git repository**
deployment so the two local Docker build contexts are available. Select the
repository and `deploy/portainer/supermemory-ai-stack.yml`, load the non-secret
variables from the private environment file, verify the capacity gate, then
choose **Deploy the stack** once.

The dependency chain is deterministic:

1. Ollama becomes healthy and downloads the pinned Qwen and embedding models;
2. Neo4j becomes healthy;
3. `neo4j-migrate` creates idempotent constraints and exits successfully;
4. Graphiti becomes healthy;
5. `supermemory-graphd` becomes ready;
6. `supermemory-improved` starts its persisted retry queue.

The equivalent full deployment outside Portainer is:

```bash
docker compose \
  --env-file deploy/portainer/supermemory-ai.env \
  -f deploy/portainer/supermemory-ai-stack.yml \
  up -d --build --wait
```

Do not start selected services individually as a release strategy.

## Private workstation connection

All published ports bind to server loopback. Establish one authenticated SSH
tunnel from the trusted workstation:

```bash
ssh -N \
  -L 11434:127.0.0.1:11434 \
  -L 8888:127.0.0.1:8888 \
  -L 9999:127.0.0.1:9999 \
  -L 8787:127.0.0.1:8787 \
  user@server
```

The daemon derives a workspace-scoped HMAC bearer from the graph gateway root
token kept in its own private local secret file. The gateway proxies
improvement notifications internally; the worker and databases stay
unreachable from the workstation and LAN. The persisted improvement queue is
sealed with AES-256-GCM using `improved_state_key`; plaintext episode content
is never written to its volume.

## Post-deployment verification

After the one full deployment, verify every dependency before pointing
`supermemoryd` at it:

```bash
curl -fsS http://127.0.0.1:11434/api/tags
curl -fsS http://127.0.0.1:8888/health
curl -fsS http://127.0.0.1:8787/ready
docker compose \
  --env-file deploy/portainer/supermemory-ai.env \
  -f deploy/portainer/supermemory-ai-stack.yml \
  ps --format json
```

The graph gateway accepts only the versioned typed statements
`replace_workspace_projection_v1` and `bounded_path_v1`; it never accepts raw
Cypher. It scopes every node and relationship to a workspace, caps traversals
at five hops, and uses parameterized direct Neo4j queries when Graphiti cannot
provide a verified projection.

## Backup, restore and rollback

List the named `supermemory-neo4j-backups` volume before restoration. Restore
requires the exact phrase `RESTORE neo4j`, verifies the selected SHA-256 file,
creates another safety backup, stops graph consumers, loads the database, and
starts the full stack:

```bash
SUPERMEMORY_ENV_FILE=/private/path/supermemory-ai.env \
  deploy/portainer/neo4j-restore.sh \
  neo4j-YYYYmmddTHHMMSSZ.dump \
  'RESTORE neo4j'
```

For an application-only rollback, select the previous reviewed Git revision
in Portainer and redeploy the complete stack. For a data-format rollback, use
the exact restore procedure above. Never delete the named volumes during a
rollback, never use `docker compose down -v`, and never treat Git rollback as a
database restore.

## Image and migration policy

- Ollama and Hindsight are digest-pinned.
- Neo4j is pinned to the Graphiti-compatible 5.26 LTS line.
- Graphiti and both SuperMemory services use explicit version tags.
- Any image/version change requires a fresh complete backup, offline Compose
  validation, full-stack deployment and all-service health verification.
- `neo4j-migrate` is idempotent; failed migration prevents graph services from
  starting.
