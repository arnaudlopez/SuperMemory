# Goal: Implement Hindsight Live Smoke Readiness

## Outcome

Add a credential-free readiness report for the manual real Hindsight smoke test.

The readiness report must run only local mock/verifier proofs, confirm live mode stays fail-closed without explicit opt-in, redact env/secrets, and output the exact manual live commands for:

- capture/retain metadata preservation;
- source-change upsert/re-promotion;
- do_not_use revocation delete.

## Oracle

The goal is complete when a dedicated verifier proves the readiness report is complete, redacted, and non-live, and the global SuperMemory specs include that verifier.

## Non-Goals

- Do not run real Hindsight writes.
- Do not require credentials.
- Do not add dependencies, migrations, background jobs, or UI.

## Command

```bash
node scripts/verify-hindsight-live-smoke-readiness.mjs
```
