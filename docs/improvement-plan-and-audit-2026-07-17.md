# SuperMemory Improvement Plan And Audit

Date: 2026-07-17

## Outcome

The hardening plan below is implemented. SuperMemory is **contract-ready** for the documented local-first operator scope. On 2026-07-17, a fresh successful live smoke also proved **runtime-ready** against the pinned localhost Hindsight container and a unique sacrificial bank. That evidence remains local under ignored `tmp/` and expires from the readiness window after 24 hours by default. Production approval remains a separate explicit post-evidence operator decision.

## Executed Plan

1. **Preserve real immutable evidence — complete.** Capture, refresh, and onboarding now reread the reviewed source at commit time, verify identity and SHA-256, and store the actual bytes as a `0600` content-addressed artifact under `00_inbox/snapshots/sha256/`.
2. **Enforce governed Hindsight promotion and recall — complete.** Real writes require an untampered reviewed plan plus owner confirmation. Promotion and recall require workspace, access, sensitivity, domain, consumer, entity, schema, and active-status constraints. Cloud is a second explicit opt-in.
3. **Separate readiness levels — complete.** The release gate proves only `contract-ready`. The runtime gate reruns it, requires strict healthy preflight and fresh successful live evidence, and still leaves production approval manual.
4. **Make registry commits recoverable — complete.** Vault commits use an exclusive lock, transaction journal, temporary files, backups, atomic renames, immediate rollback on detected failure, and recovery after interruption. Onboarding ids include a relative-path hash.
5. **Harden runtime and supply chain — complete.** Hindsight requests have timeouts and typed partial-failure reports without unsafe automatic retries. The Hindsight image and CI actions are immutable-pinned. CI covers Node 18 and 22. Secret hygiene scans tracked and untracked non-ignored files.
6. **Align operator documentation — complete.** README, runbooks, security guidance, and historical audit pointers now describe the actual implementation and the three readiness levels.

## Readiness Model

- `contract-ready`: deterministic specs, tests, mock workflows, safety gates, docs, and CI configuration pass without live credentials or writes.
- `runtime-ready`: contract-ready plus healthy strict local preflight and successful redacted live-smoke evidence within the accepted age window.
- `production-ready`: runtime-ready plus an explicit operator decision for the intended environment, data, rollback plan, and credentials.

Commands:

```bash
npm test
npm run verify
npm run verify:release
npm run verify:runtime -- --evidence-path tmp/hindsight-live-smoke-local.jsonl --json
npm run verify:production -- --evidence-path tmp/hindsight-live-smoke-local.jsonl --deployment-scope local-first-operator --rollback-acknowledged --owner-approved --approval-reference <approval-reference> --json
git diff --check
```

## Remaining Risks And Non-Goals

- The 2026-07-17 real Hindsight smoke passed all three governed cases with redacted evidence. It used a unique local sacrificial bank and did not target Hindsight Cloud. Because runtime evidence is deliberately short-lived and untracked, it must be regenerated for later production decisions.
- The supported ingestion runtime is local/manual and local-file based. Remote connectors, scheduled refresh, hosted UI, auth/RLS, billing, and multi-tenant deployment are not implemented.
- The secret scanner is heuristic and supplements, rather than replaces, provider-side secret scanning and credential rotation.
- Registry recovery covers the operator workflows in this repository; it is not a general multi-host transaction coordinator.
- Content-addressed snapshots intentionally preserve evidence. Retention and deletion must follow a separately approved governance procedure rather than ad hoc filesystem removal.

## Final Operator Decision

Do not label the tool production-ready solely because CI or `verify:release` is green. First run the strict preflight and live smoke described in `docs/production-runbook.md`, pass `verify:runtime` with fresh evidence, review the target bank and data classification, and then run the explicit production approval gate.
