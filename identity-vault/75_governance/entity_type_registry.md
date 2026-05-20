# Entity Type Registry

This registry defines business types that can appear in compiled notes, signals, and Hindsight tags.

## Kernel Concepts

These concepts exist in every SuperMemory deployment:

| Type | Status | Purpose |
| --- | --- | --- |
| `source` | stable | Evidence captured with provenance, sensitivity, and status. |
| `entity` | stable | Named thing that can be linked and recalled. |
| `fact` | stable | Source-backed assertion. |
| `signal` | stable | Minimal published memory for specialized agents. |
| `action` | stable | Task, commitment, or external operation candidate. |
| `policy` | stable | Rule governing memory or agent behavior. |
| `review` | stable | Human or agent review item. |
| `promotion` | stable | Governed transfer into Hindsight. |

## Current Business Types

| Type | Status | Domain | Default Sensitivity | Allowed Consumers | Notes |
| --- | --- | --- | --- | --- | --- |
| `client` | stable | professional | medium | memory, project_manager, email, crm | Organization receiving professional work. |
| `person` | stable | professional | medium | memory, project_manager, email, crm | Individual with aliases, roles, and linked organizations. |
| `project` | stable | professional | medium | memory, project_manager, email, crm | Bounded work stream. |
| `action` | stable | professional | medium | memory, project_manager, email | Task or commitment; external execution requires confirmation. |
| `relationship_signal` | stable | professional | medium | memory, project_manager, crm | Contextual signal about relationship state. |
| `availability_constraint` | stable | shared | restricted | memory, calendar | Time constraint exposed only as redacted shared signal. |

## Candidate And Experimental Types

No enterprise-specific extension type is active by default.

Examples that may be proposed later:

| Type | Status | Trigger Required |
| --- | --- | --- |
| `contract` | candidate | A contract must be tracked as an entity, not only as source evidence. |
| `product` | candidate | Product facts must be reused across clients or campaigns. |
| `sector` | candidate | Sector knowledge must be recalled independently of one client. |
| `marketing_strategy` | candidate | A real strategy appears and must be tracked over time. |
| `campaign` | candidate | Campaign goals, channels, or results must be followed. |
| `persona` | candidate | Persona assumptions become source-backed and reusable. |

## Hindsight Tag Mapping

Every promoted item with a business type should include:

```text
entity_type:<type>
schema_status:<experimental|stable>
```

Candidate types are not promoted as active Hindsight memory.
