# Goal: Implement Vault Sync Governance M2

## Outcome

Advance the runtime preflight from generic promotion payload planning to a stricter vault-derived sync contract.

The tranche should keep dry-run as the default, keep live writes fail-closed, and add deterministic guards for M2 requirements:

- candidate schema/entity types are not promotable;
- promoted vault-derived payloads carry source version, freshness, and derived snapshot metadata;
- sync input does not imply a global vault scan or connector refresh job;
- existing Hindsight adapter and global specs remain green.

## Oracle

The goal is complete when the CLI test suite proves the new M2 governance failures and valid metadata propagation, and all current SuperMemory regression commands pass.

## Non-Goals

- Do not implement source capture connectors.
- Do not scan the whole vault automatically.
- Do not run live Hindsight writes.
- Do not add dependencies, env files, migrations, jobs, or UI.

## Command

```bash
node --test tests/hindsight-promote.test.mjs
```
