# Hindsight Live Smoke Runbook

Date: 2026-05-23

## Purpose

Run the first owner-approved Hindsight live smoke against a sacrificial bank, then keep a redacted local proof of what happened.

SuperMemory is local-first. Prefer a self-hosted/local Hindsight runtime for the first smoke. Hindsight Cloud is allowed only when the owner explicitly chooses that endpoint.

This runbook is for the runtime boundary only. It does not replace the vault as source of truth, does not run source capture, and does not promote arbitrary vault content.

## Preconditions

Use a sacrificial Hindsight bank. Do not point the first smoke at a production or long-lived bank.

Start or identify the local Hindsight API before running the live smoke. The expected local endpoint is:

```bash
export HINDSIGHT_BASE_URL="http://127.0.0.1:8888"
```

## Docker Local Runtime

Start Docker Desktop, then run the self-hosted Hindsight container with Compose:

```bash
docker compose -f compose.hindsight.yml up -d
```

The repository compose file binds Hindsight to localhost only:

```text
127.0.0.1:8888 -> Hindsight API
127.0.0.1:9999 -> Hindsight UI
```

If you already started the manual container before the compose file existed, either keep using it or stop and remove it before switching to Compose:

```bash
docker stop supermemory-hindsight-local
docker rm supermemory-hindsight-local
docker compose -f compose.hindsight.yml up -d
```

Manual equivalent:

```bash
docker run -d --name supermemory-hindsight-local --pull always \
  -p 127.0.0.1:8888:8888 \
  -p 127.0.0.1:9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=llamacpp \
  -e HINDSIGHT_API_WORKER_ID=supermemory-local \
  -v "$HOME/.hindsight-docker-supermemory:/home/hindsight/.pg0" \
  ghcr.io/vectorize-io/hindsight:latest
```

First boot with `llamacpp` can download a local model. Watch readiness with:

```bash
docker logs -f supermemory-hindsight-local
curl http://127.0.0.1:8888/health
```

Useful lifecycle commands:

```bash
docker compose -f compose.hindsight.yml stop
docker compose -f compose.hindsight.yml start
docker logs --tail 120 supermemory-hindsight-local
```

Required environment:

```bash
export HINDSIGHT_API_KEY="..."
export HINDSIGHT_BANK_ID="..."
export HINDSIGHT_BASE_URL="http://127.0.0.1:8888"
export SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1
```

Optional environment:

```bash
export SUPERMEMORY_LIVE_SMOKE_EVIDENCE_PATH="tmp/hindsight-live-smoke-evidence.jsonl"
```

Cloud alternative, explicit only:

```bash
export HINDSIGHT_BASE_URL="https://api.hindsight.vectorize.io"
```

Rules:

- never commit env files or evidence files with live run data;
- keep evidence under `tmp/` unless a separate goal approves another location;
- verify the target bank is disposable before running `--execute-live`;
- prefer local/self-hosted Hindsight; do not silently fall back to cloud;
- stop if the runner reports anything other than `pass`.

## Rehearsal

Before live execution, run the mock transport rehearsal:

```bash
node scripts/hindsight-live-smoke-runner.mjs --mock-transport --json
```

Expected result:

```text
status=pass
mode=mock
live_writes_performed=false
secrets_redacted=true
```

The rehearsal exercises:

- capture retain followed by strict recall;
- source-change upsert followed by strict recall;
- revocation delete, with a setup retain of `doc-acme-pricing-note` before deleting that same document.

## Live Execution

Run the live smoke only after the required env is set and the target bank is confirmed sacrificial:

```bash
node scripts/hindsight-live-smoke-runner.mjs --execute-live --json
```

The runner executes three governed fixtures:

1. `capture-retain`: retain `doc-acme-contract-june-rollout`, then recall with `tags_match: "all_strict"`.
2. `source-change-upsert`: upsert `doc-acme-prd`, then recall with `tags_match: "all_strict"`.
3. `revocation-delete`: seed `doc-acme-pricing-note` via retain, then delete that same document to avoid a false `404` from deleting a never-created id.

The runner writes one redacted JSON line to:

```text
tmp/hindsight-live-smoke-evidence.jsonl
```

If you want a different local path:

```bash
node scripts/hindsight-live-smoke-runner.mjs --execute-live --json --evidence-path tmp/hindsight-live-smoke-2026-05-23.jsonl
```

## Statuses

`pass`: all expected operations completed and evidence was written.

`fail`: at least one operation failed, a response could not be parsed, or redaction failed.

`blocked_missing_live_env`: live execution did not run because one or more required environment values were missing.

## Evidence Review

After a `pass`, inspect the JSON output or the evidence file for:

- `live_writes_performed: true`;
- `secrets_redacted: true`;
- all three cases present;
- retain, upsert, delete, and recall operations present;
- `revocation-delete.setup` retained `doc-acme-pricing-note` before the delete case;
- recall requests include `tags_match: "all_strict"`;
- response statuses are successful.

Do not paste API keys, raw headers, or full live response bodies into committed docs.

## Partial Failure

If a live run fails after a retain or upsert:

1. Save the redacted terminal output outside committed files.
2. Re-run the runner only after identifying which case failed.
3. If cleanup is needed, delete by `document_id` from the same sacrificial bank.
4. Do not point cleanup at another bank.
5. Record the follow-up as a new bounded goal before changing runtime code.

The expected cleanup document ids are:

```text
doc-acme-contract-june-rollout
doc-acme-prd
doc-acme-pricing-note
```

## Verification Before And After

Before live:

```bash
export HINDSIGHT_BASE_URL="http://127.0.0.1:8888"
node scripts/verify-hindsight-live-smoke-runner.mjs
node scripts/verify-hindsight-docker-compose.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

After live:

```bash
node scripts/hindsight-live-smoke-runner.mjs --mock-transport --json
node scripts/verify-supermemory-specs.mjs
git diff --check
```

The live smoke itself is intentionally not part of CI.
