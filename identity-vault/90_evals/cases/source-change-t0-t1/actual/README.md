# T5 Source Change t0/t1

This case is a deterministic local contract for mutable source freshness.

It verifies that changed pointers create immutable t1 snapshots, preserve t0, route dependent memory through review, and keep stable `document_id` on reviewed re-promotion.
