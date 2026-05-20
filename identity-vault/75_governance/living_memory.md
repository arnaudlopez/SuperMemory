# Living Memory

SuperMemory treats memory as a living governed system, not a static index.

It should remain flexible: the core guardrails are strict, but business workflows emerge through reusable patterns rather than a fixed exhaustive catalog.

## Principle

Memory changes because sources change, people change, projects change, decisions change, and interpretations get corrected.

A useful memory system must know whether a memory item is current, stale, historical, uncertain, forbidden, or waiting for review.

## Lifecycle

```text
discovered
  -> captured
  -> snapshotted
  -> compiled
  -> promoted
  -> used
  -> monitored
  -> changed
  -> reviewed
  -> active | historical_only | do_not_use
```

## Health States

- `fresh`: current enough for the intended use.
- `stale`: not checked recently enough for confident current use.
- `changed`: source changed after the active memory was compiled.
- `conflicting`: active candidates disagree and arbitration is required.
- `unavailable`: source could not be checked or fetched.
- `needs_review`: human or memory-agent decision required.
- `historical_only`: retained as context, excluded from active answers by default.
- `do_not_use`: forbidden for agentic use.

## Governing Rules

- Preserve proof before interpretation.
- Prefer immutable snapshots over mutable external pointers.
- Keep derived notes linked to the snapshots they depend on.
- Re-promote Hindsight documents when source-backed memory changes.
- Treat stale memory differently from active memory.
- Treat conflicting and unavailable memory as unsafe for confident operational answers.
- Keep historical memory available for audit, but filtered out of active recall unless explicitly requested.
- Delete or exclude forbidden memory from active Hindsight recall.
- Let new business types emerge only when real sources or workflows require them.
- Use flexible patterns for business workflows instead of hard-coding every possible use case.

## Answering Rule

Agents should answer with the freshest governed memory available.

If freshness is uncertain, they must disclose the snapshot, source date, or review state instead of pretending the memory is current.

## Design Test

Every memory feature should answer:

- What is the proof?
- Is it still current?
- What changed?
- Are there unresolved conflicts or unavailable sources?
- Who can use it?
- Is it active, historical, or forbidden?
- What should happen if the source changes tomorrow?
- Which use pattern governs this workflow?
