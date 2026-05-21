# Goal: Implement T7 Adaptive Business Types

## Outcome

Implement the executable T7 contract proving that business types are adaptive, source-backed, and governed by lifecycle status.

## Oracle

The goal is complete when `node scripts/verify-adaptive-business-types.mjs` is wired into `node scripts/verify-supermemory-specs.mjs`, proves T7.1-T7.5, all prior T0-T6 specs remain green, docs are aligned, and the work is committed and pushed.

## Non-Goals

- Do not implement a production ontology service.
- Do not integrate live Hindsight.
- Do not make `marketing_strategy` stable by default.
- Do not weaken T0-T6 contracts.

## Command

```bash
node scripts/verify-adaptive-business-types.mjs
```
