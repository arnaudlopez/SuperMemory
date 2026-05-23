# Source Snapshot Refresh Preflight

This case proves the local, deterministic preflight that sits before real source connectors.

It compares existing mutable-source snapshots with refresh candidates and emits a governed plan:

- unchanged sources update check metadata only;
- changed sources plan a new immutable snapshot with `previous_snapshot_id`;
- affected derived memory is routed to review before active promotion;
- unavailable sources stay last-known or unknown, never fresh;
- `do_not_use` sources are skipped and never become active Hindsight promotion payloads.

The case is intentionally fixture-only. It does not fetch external sources, scan the whole vault, or call live Hindsight.
