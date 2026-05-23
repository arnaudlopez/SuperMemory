# Implement Hindsight API Contract Readiness

## Outcome

Harden the Hindsight transport contract before a real owner-approved live smoke by proving that SuperMemory's generated retain, recall, upsert, and delete requests match the documented Hindsight HTTP shape and remain fail-closed with fake credentials only.

## Oracle

The goal is complete when a dedicated verifier proves:

- retain/upsert uses `POST /v1/default/banks/:bank_id/memories` with `content`, `document_id`, `tags`, and `metadata`;
- recall uses `POST /v1/default/banks/:bank_id/memories/recall` with scoped tags and `tags_match: "all_strict"`;
- delete uses `DELETE /v1/default/banks/:bank_id/documents/:document_id`;
- no live writes occur, no fake key is printed, and all global SuperMemory specs still pass.

## Non-Goals

- Do not run real Hindsight writes.
- Do not add credentials, env files, dependencies, source capture, source refresh, or runtime connector work.
- Do not weaken any T0-T14 or Hindsight governance verifier.

## Command

```bash
node scripts/verify-hindsight-api-contract-readiness.mjs
```
