#!/bin/sh
set -eu

contract="${SUPERMEMORY_RUNTIME_CONTRACT:-/run/supermemory/runtime-contract.json}"
test -r "$contract" || { echo "hindsight_runtime_contract_missing" >&2; exit 1; }
provider="$(python -c 'import json,sys; print(json.load(open(sys.argv[1]))["llm"]["provider"])' "$contract")"
model="$(python -c 'import json,sys; print(json.load(open(sys.argv[1]))["llm"]["model"])' "$contract")"

case "$provider" in
  openrouter)
    credential_file="${SUPERMEMORY_LLM_CREDENTIAL_FILE:-/run/supermemory/llm.credential}"
    test -s "$credential_file" || { echo "hindsight_openrouter_credential_missing" >&2; exit 1; }
    export HINDSIGHT_API_LLM_API_KEY="$(cat "$credential_file")"
    ;;
  openai-codex)
    codex_auth="${CODEX_HOME:-/var/lib/supermemory-codex}/auth.json"
    test -s "$codex_auth" || { echo "hindsight_codex_auth_missing" >&2; exit 1; }
    ;;
  *) echo "hindsight_llm_provider_invalid" >&2; exit 1 ;;
esac

export HINDSIGHT_API_LLM_PROVIDER="$provider"
export HINDSIGHT_API_LLM_MODEL="$model"
export HINDSIGHT_API_LLM_REASONING_EFFORT="high"
exec /app/start-all.sh
