# Access Control

SuperMemory uses deny-by-default access for enterprise memory.

## Required Metadata

Enterprise memory should carry:

- `workspace_id`: organization or tenant boundary.
- `data_owner`: team or person accountable for the source.
- `allowed_consumers`: agents or modes allowed to use the memory.
- `restricted_fields`: details that require redaction or summary-only access.
- `access_policy`: named policy applied before recall or promotion.

## Rules

- Do not cross workspace, client, or tenant boundaries without explicit permission.
- Do not expose restricted contract, pricing, legal, health, security, or credential details to agents that only need a summary.
- Specialized agents receive the narrowest useful memory.
- Missing access metadata means `needs_review`, not active recall.

## Hindsight Tags

Recommended tags:

```text
workspace:<id>
access_policy:<policy>
consumer:<agent>
visibility:<scope>
sensitivity:<level>
```

The vault remains the authority for access. Hindsight tags execute the vault decision.

## Executable Contract

The local T8 verifier lives at `scripts/verify-enterprise-access-secrets-retention.mjs`.

It proves that enterprise memory and promotion payloads carry `workspace_id`, `access_policy`, `data_owner`, and `allowed_consumers`; that secrets and restricted fields are withheld from promotion payloads and drafts; and that legal-hold evidence remains retained while active Hindsight use can be excluded.
