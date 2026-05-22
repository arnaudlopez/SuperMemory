# Goal: Implement T10 Agent Use Patterns

## Outcome

Implement the executable T10 contract proving that enterprise agent requests map to a small set of reusable use patterns instead of bespoke one-off workflows.

## Oracle

The goal is complete when `node scripts/verify-agent-use-patterns.mjs` is wired into `node scripts/verify-supermemory-specs.mjs`, proves T10.1-T10.6 plus bespoke-workflow rejection, all prior T0-T9 specs remain green, docs are aligned, and the work is committed and pushed.

## Non-Goals

- Do not implement runtime agent orchestration.
- Do not implement MCP/API/UI work.
- Do not execute email, calendar, CRM, or other external-system actions.
- Do not add queue infrastructure beyond fixture/proof references.
- Do not create an exhaustive workflow catalog.
- Do not weaken T0-T9 contracts.

## Command

```bash
node scripts/verify-agent-use-patterns.mjs
```
