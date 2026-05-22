# Goal: Implement Validated Memory Promotion Generation

## Outcome

Add an explicit vault-derived payload generation path to the Hindsight promotion preflight.

The CLI should be able to accept governed `validated_memories` and generate `promotion_payloads` only when the input explicitly requests it. This keeps the handoff LLM-first upstream and strict at promotion time: no broad vault scan, no connector, no live write, and no promotion from unapproved/candidate memory.

## Oracle

The goal is complete when tests prove valid active `validated_memories` produce Hindsight promotion payloads with provenance/snapshot/freshness metadata, invalid memories fail closed, and all existing SuperMemory regression commands pass.

## Non-Goals

- Do not scan the vault automatically.
- Do not implement source capture or refresh connectors.
- Do not run live Hindsight writes.
- Do not add dependencies, migrations, jobs, or UI.

## Command

```bash
node --test tests/hindsight-promote.test.mjs
```
