#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STACK_FILE="$SCRIPT_DIR/supermemory-ai-stack.yml"
ENV_FILE="${SUPERMEMORY_ENV_FILE:-$SCRIPT_DIR/supermemory-ai.env}"
BACKUP_NAME=${1:-}
CONFIRMATION=${2:-}

if [ -z "$BACKUP_NAME" ] || [ "$CONFIRMATION" != "RESTORE neo4j" ]; then
  echo "usage: $0 neo4j-YYYYmmddTHHMMSSZ.dump 'RESTORE neo4j'" >&2
  exit 2
fi
case "$BACKUP_NAME" in
  neo4j-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.dump) ;;
  *) echo "invalid backup name" >&2; exit 2 ;;
esac
if [ ! -f "$ENV_FILE" ]; then
  echo "missing environment file: $ENV_FILE" >&2
  exit 2
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$STACK_FILE" "$@"
}

# Always create a new verified safety backup before replacing the database.
SUPERMEMORY_ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/neo4j-backup.sh"
compose stop supermemory-graphd neo4j
compose run --rm --no-deps neo4j sh -ec \
  "cd /backups && sha256sum -c '$BACKUP_NAME.sha256' && cp '$BACKUP_NAME' neo4j.dump"
compose run --rm --no-deps neo4j neo4j-admin database load neo4j \
  --from-path=/backups --overwrite-destination=true
compose rm -f neo4j-migrate

# Restore is completed as one full-stack start, never as a progressive rollout.
compose up -d --wait
echo "restore complete: $BACKUP_NAME"
