# Forgetting Policy

## Status Values

- active
- archived
- deprecated
- historical_only
- do_not_use

## Rule

Raw sources may remain as proof while compiled facts can be marked `do_not_use` or `historical_only`.

Arnaud may revise or revoke a preference, constraint, or self-description.

## Enterprise Retention

- `do_not_use` excludes memory from active agentic use.
- `legal_hold` preserves proof even when active recall is forbidden.
- `retention_until` records when a source or snapshot can be deleted or archived.
- Hindsight active memory should be deleted or replaced when a source becomes forbidden, but the vault may retain proof for audit.

## Required Fields For Regulated Sources

```text
retention_policy
retention_until
legal_hold
deletion_behavior
```
