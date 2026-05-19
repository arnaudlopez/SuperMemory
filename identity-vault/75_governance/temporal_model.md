# Temporal Model

## Required Fields

- `observed_at`
- `created_at`
- `confirmed_at`
- `valid_from`
- `valid_until`
- `event_date`
- `review_after`
- `superseded_by`

## Scenario

- Acme timing concern observed on 2026-05-19.
- Availability constraint applies to 2026-05-27 morning.
- The constraint should expire after the event date unless preserved as history.
