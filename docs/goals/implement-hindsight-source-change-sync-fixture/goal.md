# Goal: Implement Hindsight Source-Change Sync Fixture

## Outcome

Add a complete mock sync fixture proving the T5 source-change path through the Hindsight preflight:

```text
source changed -> reviewed validated_memory -> generated promotion_payload -> mock Hindsight transport
```

The fixture must stay local and deterministic. It must not use a real connector, scan the vault, or run live Hindsight writes.

## Oracle

The goal is complete when a dedicated verifier proves the source-change sync fixture and the global SuperMemory specs include that verifier.

## Non-Goals

- Do not run live Hindsight writes.
- Do not implement real source capture or refresh connectors.
- Do not scan the whole vault.
- Do not add dependencies, migrations, background jobs, or UI.

## Command

```bash
node scripts/verify-hindsight-source-change-sync.mjs
```
