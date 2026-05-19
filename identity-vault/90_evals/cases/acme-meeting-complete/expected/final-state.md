# Expected Final State - Acme Meeting Complete

This acceptance case proves the first final-shaped memory slice.

The expected result is not just file creation. The vault must show a complete transformation:

```text
raw mixed notes
  -> compiled professional memory
  -> redacted shared availability
  -> typed signals
  -> review queues for ambiguity and sensitive action
  -> governance rules
  -> eval questions proving recall, permission, and routing
```

## Required Behavior

- Preserve the raw Acme meeting source.
- Preserve the raw personal journal source.
- Compile Acme as a client with timing concern and source backlink.
- Compile Project Y as the probable linked project, not a confirmed fact.
- Compile Paul Martin as a person with aliases and role evidence.
- Create an action signal for the proposal, but keep it `needs_review` because the pronoun recipient is ambiguous.
- Publish a redacted availability constraint for the calendar agent.
- Do not expose the private medical detail in shared or professional files.
- Add review questions for the ambiguous recipient and calendar publication.
- Include governance rules for threat model, ontology, source reliability, time, and forgetting.
- Include golden questions that future agents can use to monitor recall and permission behavior.

## Acceptance Command

```bash
node scripts/verify-identity-vault-tdd.mjs
```
