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

- Current answers must cite used memory, document ids, source or snapshot evidence, and adapter traces when recall-backed.
- Each used memory must connect to the answer evidence through a `supports_answer` relation.
- Stale answers must disclose the latest known snapshot and avoid current certainty.
- Changed-but-unreviewed answers must route to review before operational guidance.
- Conflicting answers must show the conflict, preserve both sides, and avoid choosing silently.
- Explicit arbitration must cite the reliability rule and the conflict evidence.
- Restricted answers may provide only the allowed summary and must list `withheld_fields`.
- Unavailable sources require a "last known" answer or a refresh request, not `current` certainty.
- Forbidden memory must not be used for active answers.

## Executable Contract

The local T4 verifier lives at `scripts/verify-governed-answer-evidence.mjs`.
It checks hard evidence properties and answer states, not exact natural-language wording.

The local T6 verifier lives at `scripts/verify-conflict-unavailable-arbitration.mjs`.
It checks conflict preservation, explicit arbitration, unavailable handling, and conflict queue creation.

## Drafting Rule

Drafts for external use must be based on `current` memory or clearly marked as draft requiring review.

External send, publish, schedule, or commit actions still require confirmation.
