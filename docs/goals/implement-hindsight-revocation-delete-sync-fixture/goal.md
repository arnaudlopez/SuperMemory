# Goal: Implement Hindsight Revocation Delete Sync Fixture

## Outcome

Add a local fixture proving governed revocation through the Hindsight mock transport:

```text
captured source marked do_not_use -> revoked validated_memory -> generated delete payload -> mock Hindsight DELETE
```

The fixture must stay explicit and local. It must not scan the vault, call a connector, or perform live Hindsight writes.

## Oracle

The goal is complete when a dedicated verifier proves explicit revocation generates a delete operation/request and the global SuperMemory specs include that verifier.

## Non-Goals

- Do not implement a real connector.
- Do not scan the whole vault.
- Do not run live Hindsight writes.
- Do not add dependencies, migrations, background jobs, or UI.

## Command

```bash
node scripts/verify-hindsight-revocation-delete-sync.mjs
```
