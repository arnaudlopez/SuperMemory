# Conflict Arbitration

## Rule

If agents create incompatible intentions, record a review item before external action.

If sources create incompatible facts, preserve both sources, record the conflict, apply source reliability ordering, and avoid silently promoting one active answer unless the rule is explicit.

Conflicting memory should be marked `needs_review` or `conflicting` until resolved.

## Source Conflict Contract

- Both sides of a source conflict must remain addressable and linked with `conflicts_with`.
- Without an explicit source reliability rule, the answer state is `conflicting` and no single memory is selected as the winner.
- With an explicit rule, the answer may prefer one source for guidance, but it must cite the rule and the conflict.
- Unresolved conflicts create a `conflict_queue` item for human or later agent review.
- Connector unavailability is not conflict resolution; it produces last-known or unverified wording only.

## Example

- Calendar blocks 2026-05-27 morning.
- Project manager tries to schedule Acme work at the same time.
- Email agent drafts a promise to respond that morning.

Result: escalate to review before sending or scheduling.

## Source Conflict Example

- API snapshot t1 says `trust_score` replaced `risk_score`.
- Support note says the old `risk_score` field is still available.

Result: product memory must show the conflict, prefer API documentation for integration guidance, and queue support clarification before external commitments.

## Executable Contract

The local T6 verifier lives at `scripts/verify-conflict-unavailable-arbitration.mjs`.
