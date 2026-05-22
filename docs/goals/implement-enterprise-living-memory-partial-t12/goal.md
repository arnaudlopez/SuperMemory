# Goal: Implement T12 Enterprise Living Memory Partial

## Outcome

Implement the executable T12 contract proving the first partial Orion enterprise Golden Case: source snapshots change, derived memory updates, Hindsight re-promotion stays stable, forbidden pricing is excluded, and core answers are source-backed.

## Oracle

The goal is complete when `node scripts/verify-enterprise-living-memory-partial.mjs` is wired into `node scripts/verify-supermemory-specs.mjs`, proves T12.1-T12.6, all prior T0-T11 specs remain green, non-covered Golden Case areas remain explicitly `pending`, docs are aligned, and the work is committed and pushed.

## Non-Goals

- Do not make the full enterprise Golden Case pass yet.
- Do not implement `marketing_strategy`, legal-hold automation, secrets handling, engine-port evals, or all specialized agents in this tranche.
- Do not add runtime Hindsight integration, databases, migrations, external services, or package dependencies.
- Do not weaken T0-T11 contracts.

## Command

```bash
node scripts/verify-enterprise-living-memory-partial.mjs
```
