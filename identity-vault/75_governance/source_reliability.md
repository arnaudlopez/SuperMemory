# Source Reliability

## Reliability Order

1. explicit_user_correction
2. confirmed_decision
3. direct_note
4. meeting_note
5. email_received
6. captured_external_document
7. transcript
8. inference
9. legacy_memory

## Rule

An inference cannot have the same authority as an explicit user correction.

Reliability order is not an automatic winner picker. It can arbitrate a conflict only when the rule is explicit for the source pair, domain, and intended use. The answer evidence must expose the rule id and the conflict it is resolving.

## Current Scenario

- Acme timing concern: meeting_note, high confidence.
- Acme contractual June rollout milestone: captured_external_document, high confidence.
- Proposal recipient: email_received, high confidence.
- Project Y link: metadata/context inference, probable.
- Original proposal recipient from meeting phrase: pronoun inference, superseded by captured email.
- Availability private source: direct_note, restricted source access.

## External Source Provenance

Every external source used for memory must preserve:

- `source_id`
- `snapshot_id`
- original reference such as local path, email id, URL, or cloud document id
- capture method
- capture date
- content hash or connector version when available
- sensitivity
- compiled targets

## Mutable Source Rule

External sources can change without warning. A stable URL, path, thread id, or business app id is not enough to prove the content that memory used.

Every mutable source must be represented as:

```text
external_ref
  -> immutable snapshot
  -> compiled note or signal
  -> Hindsight promotion
```

If the external content changes, preserve the old snapshot, create a new snapshot, and mark derived notes according to `75_governance/source_freshness.md`.

If the external source cannot be checked, mark the check `unavailable` and keep any answer last-known or unverified.
