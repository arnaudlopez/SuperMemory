# Source Freshness

Mutable sources are external records that may change without giving SuperMemory a clean version number.

This policy implements the broader living memory principle in `75_governance/living_memory.md`.

Examples:

- API documentation at a stable URL.
- CRM contract records.
- Business application records.
- Google Docs, Notion pages, or cloud files.
- Local files replaced under the same path.
- Email threads that receive new messages.

## Core Rule

An external mutable source is a pointer, not proof.

Only an immutable snapshot captured in `00_inbox/snapshot_registry.md` can become source evidence.

## Freshness States

- `fresh`: checked or captured within the expected policy window.
- `stale`: not checked recently enough for confident current answers.
- `changed`: a new hash, updated timestamp, or connector event indicates different content.
- `unavailable`: the source cannot currently be fetched.
- `needs_review`: change detected and derived notes require human or memory-agent review.

## Change Handling

```text
external source checked
  -> compare hash or connector version
  -> same content: update last_checked_at
  -> changed content: create new snapshot
  -> mark impacted compiled notes stale or needs_review
  -> re-promote active Hindsight document after review
```

## Derived Memory

Compiled notes should record `derived_from` snapshot ids when they depend on mutable sources.

If a snapshot changes, every derived note with `staleness_policy: needs_review_on_source_change` must be reviewed before it is treated as current memory.

## Answering Rule

If active memory depends on a stale or changed source, the agent must say which snapshot it is using and avoid pretending the answer is current.
