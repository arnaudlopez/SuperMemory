# Goal: Implement Runtime Preflight Vault-To-Hindsight Promotion

## Outcome

Implement Slice 1 and Slice 2 from the runtime preflight blueprint: a local vault-to-Hindsight promotion CLI with dry-run operation planning, governance validation, JSON output, and live-mode guards without real network calls.

## Oracle

The goal is complete when `scripts/hindsight-promote.mjs` and `tests/hindsight-promote.test.mjs` prove dry-run validation, `do_not_use` delete/skip behavior, unpromoted raw LLM exclusion, and fail-closed `--live` guards while all existing adapter, answer, global spec, and whitespace checks pass.

## Non-Goals

- Do not call the live Hindsight API.
- Do not add package dependencies or env files.
- Do not implement source capture, source refresh, migrations, or engine ports.
- Do not weaken T0-T14 contracts.

## Command

```bash
node --test tests/hindsight-promote.test.mjs
```
