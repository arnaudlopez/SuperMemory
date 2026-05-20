# Conflict Arbitration

## Rule

If agents create incompatible intentions, record a review item before external action.

If sources create incompatible facts, preserve both sources, record the conflict, apply source reliability ordering, and avoid silently promoting one active answer unless the rule is explicit.

Conflicting memory should be marked `needs_review` or `conflicting` until resolved.

## Example

- Calendar blocks 2026-05-27 morning.
- Project manager tries to schedule Acme work at the same time.
- Email agent drafts a promise to respond that morning.

Result: escalate to review before sending or scheduling.

## Source Conflict Example

- API snapshot t1 says `trust_score` replaced `risk_score`.
- Support note says the old `risk_score` field is still available.

Result: product memory must show the conflict, prefer API documentation for integration guidance, and queue support clarification before external commitments.
