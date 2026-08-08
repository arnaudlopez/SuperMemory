#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STACK_FILE="$SCRIPT_DIR/supermemory-ai-stack.yml"
ENV_FILE="${SUPERMEMORY_ENV_FILE:-$SCRIPT_DIR/supermemory-ai.env}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

if [ ! -f "$ENV_FILE" ]; then
  echo "missing environment file: $ENV_FILE" >&2
  exit 2
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$STACK_FILE" "$@"
}

restart_full_stack() {
  compose up -d --wait
}

trap restart_full_stack EXIT INT TERM
compose stop supermemory-graphd neo4j
compose run --rm --no-deps neo4j neo4j-admin database dump neo4j \
  --to-path=/backups --overwrite-destination
compose run --rm --no-deps neo4j sh -ec \
  "cp /backups/neo4j.dump /backups/neo4j-$STAMP.dump && sha256sum /backups/neo4j-$STAMP.dump > /backups/neo4j-$STAMP.dump.sha256"
restart_full_stack
trap - EXIT INT TERM

echo "backup complete: neo4j-$STAMP.dump"
