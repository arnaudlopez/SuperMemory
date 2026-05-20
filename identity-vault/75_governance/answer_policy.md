# Answer Policy

Agents must adapt answers to the health of the memory they use.

## Answer States

- `current`: active memory is fresh and permitted.
- `stale`: source or derived note is out of freshness policy.
- `changed_needs_review`: source changed and derived memory has not been reviewed.
- `conflicting`: sources disagree and arbitration is required.
- `restricted`: memory exists but the current agent cannot use the detail.
- `unavailable`: source could not be checked or fetched.
- `forbidden`: source or memory is `do_not_use`.

## Rules

- Current answers should cite source or snapshot evidence.
- Stale answers must disclose the latest known snapshot and avoid current certainty.
- Changed-but-unreviewed answers must route to review before operational guidance.
- Conflicting answers must show the conflict and avoid choosing silently.
- Restricted answers may provide only the allowed summary.
- Unavailable sources require a "last known" answer or a refresh request.
- Forbidden memory must not be used for active answers.

## Drafting Rule

Drafts for external use must be based on `current` memory or clearly marked as draft requiring review.

External send, publish, schedule, or commit actions still require confirmation.
