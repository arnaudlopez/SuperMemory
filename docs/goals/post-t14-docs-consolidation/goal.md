# Goal: Post-T14 Docs Consolidation

## Outcome

Consolidate stale documentation after T14 so future work starts from the current post-Golden-Case reality: the executable spec path is complete, promptfoo is optional reporting, and the next implementation step is runtime preflight rather than more Golden Case expansion.

## Oracle

The goal is complete when `docs/llm-first-migration-plan.md`, `README.md`, and `docs/prd-memoire-agentique-v2.md` no longer describe pre-T14 stale state, global specs still pass, and the board records shipping proof.

## Non-Goals

- Do not change T0-T14 verifier behavior.
- Do not implement live Hindsight, source connectors, migrations, runtime promotion, or new dependencies.
- Do not rewrite the PRD broadly; only correct stale planning language.

## Command

```bash
node scripts/verify-supermemory-specs.mjs
```
