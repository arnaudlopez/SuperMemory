# Hindsight Local Live Smoke Execution

## Intent

Move SuperMemory from mock-only Hindsight runtime readiness to a real local/self-hosted Hindsight smoke, using the existing Docker compose and live smoke runner.

The repository already has:

- `compose.hindsight.yml` for a local Hindsight runtime;
- `scripts/hindsight-promote.mjs` with dry-run, mock transport, and live-mode guards;
- `scripts/hindsight-live-smoke-runner.mjs` with capture retain, source-change upsert/recall, and revocation delete cases;
- verifiers proving mock evidence and missing-env live blocking.

The next step is to either execute the local live smoke end-to-end against `http://127.0.0.1:8888`, or make the operational blocker explicit and improve local runbook/tooling so the owner can complete it without guesswork.

## User Outcome

A maintainer can run one local command sequence and know whether local Hindsight is actually reachable and compatible with SuperMemory's promotion/recall/delete transport contract. If the local runtime cannot run in this environment, the result must clearly say what is missing and must not silently fall back to Hindsight Cloud.

## Non-Goals

- Do not use Hindsight Cloud unless the owner explicitly chooses that endpoint.
- Do not commit secrets or env files.
- Do not run broad vault scans.
- Do not promote arbitrary vault content.
- Do not modify source capture, refresh, compilation, review queue, or answer generation behavior.
- Do not weaken existing mock, dry-run, source, refresh, or global specs.

## Acceptance

- Local preflight checks Docker availability and local Hindsight compose configuration.
- The live smoke target is explicit and local by default: `HINDSIGHT_BASE_URL=http://127.0.0.1:8888`.
- The smoke runner refuses cloud fallback and still blocks without explicit live opt-in.
- If local Hindsight is reachable, the smoke performs retain/upsert/recall/delete cases and writes redacted evidence under an ignored/local path.
- If local Hindsight is not reachable or Docker is unavailable, the goal records an explicit operational blocker with exact next commands, while mock verifiers remain green.
- Existing runtime preflight, live smoke runner, Docker compose, Hindsight adapter, and global specs remain green.

## Oracle

Hindsight local live smoke execution is complete when `node scripts/verify-hindsight-docker-compose.mjs`, `node scripts/verify-hindsight-live-smoke-runner.mjs`, `node scripts/verify-hindsight-live-smoke-readiness.mjs`, `node --test tests/hindsight-promote.test.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass, and the final receipt records either local live smoke evidence or an explicit local-runtime blocker without cloud fallback.
