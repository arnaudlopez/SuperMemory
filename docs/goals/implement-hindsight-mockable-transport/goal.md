# Goal: Implement Hindsight Mockable Transport Boundary

## Outcome

Add a mockable Hindsight transport boundary behind the existing dry-run promotion CLI, using official Hindsight docs for retain, recall, and document delete request shapes, while keeping live network disabled by default and out of CI.

## Oracle

The goal is complete when transport request mapping is covered by tests, the CLI can execute live-mode through a mock transport, real live mode remains fail-closed without explicit opt-in, and all existing adapter/global checks pass.

## Non-Goals

- Do not run real Hindsight network calls in tests or CI.
- Do not commit credentials or env files.
- Do not add package dependencies.
- Do not implement source capture, refresh, migrations, or manual smoke.

## Command

```bash
node --test tests/hindsight-transport.test.mjs tests/hindsight-promote.test.mjs
```
