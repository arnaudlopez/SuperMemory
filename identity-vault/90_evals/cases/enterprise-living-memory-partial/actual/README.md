# Enterprise Living Memory Partial Fixture

This fixture proves Tranche 12 without making the full enterprise Golden Case pass.

It covers the executable core:

- API docs move from `risk_score` at t0 to `trust_score` at t1.
- Contract retention moves from 30 days at t0 to 90 days at t1.
- The t0-derived PRD becomes `needs_review`; the reviewed t1 PRD becomes active.
- Hindsight re-promotion keeps the same stable `document_id`.
- Obsolete pricing is marked `do_not_use` and excluded from active recall.
- Core answers cite source snapshots and evidence.

Full-case dimensions such as marketing strategy, legal-hold behavior, secrets, engine-port expansion, and complete specialized-agent coverage stay explicitly `pending`.
