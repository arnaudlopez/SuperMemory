# Review Queues And Actions Fixture

This directory is intentionally fixture-backed, not runtime-backed.

T9 proves that ambiguous or unsafe states produce explicit review work:

- changed source-derived memory opens `staleness_queue`;
- unresolved source disagreement opens `conflict_queue`;
- new business concept creation opens `type_queue`;
- restricted-field ambiguity opens `permission_queue`;
- external email send opens `action_confirmation_queue` and remains unexecuted.

