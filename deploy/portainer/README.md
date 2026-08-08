# SuperMemory six-service server stack — Docker/Portainer

This directory defines the complete Hindsight-native server plane:

- Ollama with `qwen3.5:9b`;
- Hindsight 0.9.0 with observations, bank configuration and audit enabled;
- Neo4j 5.26 LTS;
- the authenticated `supermemory-graphd` v2 gateway and its one-shot migration.

The six Compose services are `ollama`, `qwen-model`, `hindsight`, `neo4j`,
`neo4j-migrate` and `supermemory-graphd`. Graphiti and
`supermemory-improved` are deliberately absent. Hindsight owns learned memory
and Neo4j/GraphD owns exact temporal graph projection; the encrypted canonical
vault on the trusted workstation remains the authority.

There is no canary or progressive rollout. Validate and deploy or roll back the
whole stack as one operator action.

## Capacity gate

The default hard limits total roughly 18.5 GiB before Docker and operating
system overhead. Require at least 24 GiB genuinely available RAM and 35 GiB
free disk. A 32–64 GiB server and a GPU with at least 12 GiB VRAM are
recommended. Do not compensate for insufficient capacity by moving server
components onto the workstation.

The Ollama service reserves one NVIDIA GPU explicitly through the Compose
device contract. A smaller GPU may use partial CPU/RAM offload for functional
validation, but performance results from that host are not production SLO
evidence.

## Secret preparation

Docker Standalone uses Compose secret files mounted read-only under
`/run/secrets`. Create the two secrets outside Git:

```bash
sudo install -d -m 0700 /opt/supermemory/secrets
NEO4J_PASSWORD_VALUE=$(openssl rand -base64 36 | tr -d '\n')
printf 'neo4j/%s\n' "$NEO4J_PASSWORD_VALUE" | sudo tee /opt/supermemory/secrets/neo4j_auth >/dev/null
openssl rand -hex 32 | sudo tee /opt/supermemory/secrets/graphd_token >/dev/null
sudo chmod 0600 /opt/supermemory/secrets/*
unset NEO4J_PASSWORD_VALUE
```

Never put those values in Portainer variables, `.env`, Git, logs or tickets.

## Full preflight

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

`config` is the offline structural gate. `build --pull` is an explicit operator
action. Implementation and CI never execute `pull`, `build`, `up`, Portainer
webhooks or a remote Docker API.

Before replacing Neo4j, create and verify a backup:

```bash
SUPERMEMORY_ENV_FILE=/private/path/supermemory-ai.env \
  deploy/portainer/neo4j-backup.sh
```

## Atomic deployment

Use Portainer **Docker Standalone → Stacks → Add stack → Git repository** so the
GraphD build context is available. Select
`deploy/portainer/supermemory-ai-stack.yml`, load non-secret variables from the
private environment file, verify capacity, then deploy once.

The dependency chain is deterministic:

1. Ollama becomes healthy and `qwen-model` downloads the pinned model.
2. Hindsight starts after the model is available.
3. Neo4j becomes healthy.
4. `neo4j-migrate` creates idempotent constraints and exits successfully.
5. `supermemory-graphd` starts only after migration.

Equivalent command outside Portainer:

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

The daemon derives a workspace-scoped HMAC bearer from the private GraphD root
token. Neo4j remains unreachable from both workstation and LAN.

## Post-deployment verification

```bash
curl -fsS http://127.0.0.1:11434/api/tags
curl -fsS http://127.0.0.1:8888/health
curl -fsS http://127.0.0.1:8787/ready
docker compose \
  --env-file deploy/portainer/supermemory-ai.env \
  -f deploy/portainer/supermemory-ai-stack.yml \
  ps --format json
```

GraphD v2 accepts only `replace_workspace_projection_v2` and
`bounded_path_v2`; it never accepts raw Cypher. It scopes every record to one
workspace, caps traversal at five hops and returns only a candidate projection
that the local authority revalidates.

The runtime preflight must additionally prove the exact Hindsight 0.9.0 image
digest, required OpenAPI capabilities, bank-template schema and behavioral
redaction before activation.

## Backup, restore and rollback

Restore requires the exact phrase `RESTORE neo4j`, verifies the selected
SHA-256 file, creates a safety backup, stops GraphD and Neo4j, loads the
database, then starts the full stack:

```bash
SUPERMEMORY_ENV_FILE=/private/path/supermemory-ai.env \
  deploy/portainer/neo4j-restore.sh \
  neo4j-YYYYmmddTHHMMSSZ.dump \
  'RESTORE neo4j'
```

For application rollback, redeploy the previous reviewed Git revision. For a
data-format rollback, use the exact restore procedure. Never delete named
volumes, use `docker compose down -v`, or treat Git rollback as database
restore.

## Image and migration policy

- Ollama and Hindsight are digest-pinned; Hindsight must remain exactly 0.9.0.
- Neo4j is pinned to the 5.26 LTS line.
- GraphD uses an explicit major version tag and contract.
- Any image change requires backup, offline Compose validation, full-stack
  deployment and all-service health verification.
- `neo4j-migrate` is idempotent; migration failure prevents GraphD startup.
