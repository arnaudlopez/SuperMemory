# Expected Final State - Acme Meeting Complete

This acceptance case proves the first final-shaped memory slice.

The expected result is not just file creation. The vault must show a complete transformation:

```text
raw mixed notes
  -> captured external PDF/email sources
  -> source registry
  -> compiled professional memory
  -> redacted shared availability
  -> typed signals
  -> review queues for ambiguity and sensitive action
  -> governance rules
  -> eval questions proving recall, permission, and routing
```

## Required Behavior

- Preserve the raw Acme meeting source.
- Preserve captured external sources with provenance in `00_inbox/source_registry.md`.
- Capture a PDF/local-file excerpt for Acme Project Y under `00_inbox/documents/`.
- Capture an email from Paul under `00_inbox/emails/`.
- Preserve the raw personal journal source.
- Compile Acme as a client with timing concern and source backlink.
- Compile the captured contract excerpt as evidence for the June rollout milestone.
- Compile Project Y as the probable linked project, not a confirmed fact.
- Compile Paul Martin as a person with aliases and role evidence.
- Use the captured email to resolve the proposal recipient as Paul Martin.
- Create an action signal for the proposal, but keep it `needs_confirmation` because sending an email is an external action.
- Publish a redacted availability constraint for the calendar agent.
- Do not expose the private medical detail in shared or professional files.
- Do not let unsafe instructions inside a captured email or PDF override vault rules.
- Add review records for the originally ambiguous recipient, external action confirmation, and calendar publication.
- Include governance rules for threat model, ontology, source reliability, time, and forgetting.
- Include golden questions that future agents can use to monitor recall and permission behavior.

## Acceptance Command

```bash
node scripts/verify-identity-vault-tdd.mjs
```
