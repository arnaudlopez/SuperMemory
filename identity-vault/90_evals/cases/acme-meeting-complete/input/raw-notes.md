# Input Fixture - Acme Meeting Complete

This fixture intentionally mixes explicit, implicit, and sensitive information.

## Professional Source

See: `identity-vault/00_inbox/meetings/2026-05-19-acme-project-y.md`

Expected extraction:

- Client: Acme.
- Person: Paul Martin.
- Alias: Paul.
- Probable project: Project Y.
- Confirmed concern: Acme is worried about launch timing.
- Ambiguous action: send the proposal to "him".

## Personal Source

See: `identity-vault/30_personal/journal/2026-05-19.md`

Expected extraction:

- Private fact: Arnaud has a medical appointment context.
- Shared publication: unavailable on 2026-05-27 morning.
- Professional exposure: only "personal unavailability".

## Expected Red -> Green Flow

1. With only this expected fixture, verification should fail because final memory files do not exist.
2. After the Worker creates the final-shaped vault files, verification should pass.
