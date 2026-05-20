# Snapshot Registry

This registry records immutable captures of external or mutable sources.

An external source can keep the same URL, path, CRM id, or thread id while its content changes. The snapshot is the proof used by memory.

| Snapshot ID | Source ID | Captured At | Capture Method | Content Hash | Previous Snapshot | Change Status | Freshness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `snap:doc:2026-05-19:acme-contract-excerpt:20260519` | `doc:2026-05-19:acme-contract-excerpt` | 2026-05-19 | extract_text | `sha256:fixture-sha256-acme-contract-excerpt` | none | initial_capture | fresh |
| `snap:email:gmail:2026-05-19:paul-analytics-proposal:20260519` | `email:gmail:2026-05-19:paul-analytics-proposal` | 2026-05-19 | copy | `sha256:67b1c201a69815fe5fa2529b0f8b88d85dd1c945de13c7b01ef226c9f7957e5f` | none | initial_capture | fresh |

## Rules

- Never overwrite a snapshot.
- A same `original_ref` with a different content hash creates a new snapshot.
- The source registry points to the active snapshot.
- Compiled notes record the snapshots they derive from.
- Hindsight receives active promoted content plus snapshot metadata.
