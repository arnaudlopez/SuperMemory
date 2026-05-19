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
- original reference such as local path, email id, URL, or cloud document id
- capture method
- capture date
- sensitivity
- compiled targets
