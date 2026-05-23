# Goal: Implement Hindsight Capture Refresh Sync Fixture

## Outcome

Add a local fixture proving that authorized source-capture metadata participates in the Hindsight mock sync path:

```text
captured source -> immutable snapshot -> reviewed validated_memory -> generated payload -> mock Hindsight transport
```

The fixture must stay explicit and local. It must not scan the vault, call a connector, or perform live Hindsight writes.

## Oracle

The goal is complete when a dedicated verifier proves capture metadata propagation into the mock Hindsight transport and the global SuperMemory specs include that verifier.

## Non-Goals

- Do not implement a real connector.
- Do not scan the whole vault.
- Do not run live Hindsight writes.
- Do not add dependencies, migrations, background jobs, or UI.

## Command

```bash
node scripts/verify-hindsight-capture-refresh-sync.mjs
```
