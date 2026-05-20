# Target Structure - Enterprise Living Memory Complete

This is the target file structure for the maximal V2 TDD tranche.

```text
identity-vault/
  00_inbox/
    source_registry.md
    snapshot_registry.md
    api_docs/
      2026-05-20-acme-payments-api.md
      2026-05-27-acme-payments-api.md
    contracts/
      2026-05-20-orion-msa.md
      2026-05-27-orion-msa.md
    crm/
      2026-05-20-orion-opportunity.md
    emails/
      2026-05-27-orion-launch-readiness.md
    support/
      2026-05-26-orion-checkout-escalation.md
      2026-05-27-risk-score-legacy-note.md
    marketing/
      2026-05-27-checkout-recovery-strategy.md
    pricing/
      2026-05-18-obsolete-pricing-sheet.md
  20_professional/
    clients/
      orion-retail.md
    products/
      acme-payments-api.md
    contracts/
      orion-msa.md
    prds/
      orion-checkout-integration.md
    opportunities/
      orion-checkout-expansion.md
    strategies/
      orion-checkout-recovery.md
    sectors/
      retail.md
    people/
      maya-singh.md
    actions.md
  50_review/
    staleness_queue.md
    conflict_queue.md
    type_queue.md
    permission_queue.md
    action_confirmation_queue.md
  60_signals/
    actions.jsonl
    product_changes.jsonl
    strategy_signals.jsonl
    staleness.jsonl
  70_agent_contracts/
    memory.md
    email.md
    marketing.md
    product.md
  75_governance/
    access_control.md
    answer_policy.md
    conflict_arbitration.md
    entity_type_registry.md
    forgetting_policy.md
    hindsight_contract.md
    living_memory.md
    memory_engine_ports.md
    source_freshness.md
    source_reliability.md
    sequential_relational_model.md
    threat_model.md
    type_lifecycle.md
    use_patterns.md
  80_logs/
    source_changes.jsonl
    hindsight_promotions.jsonl
    engine_port_evals.jsonl
  90_evals/
    golden_questions.md
    cases/
      enterprise-living-memory-complete/
        input/
        expected/
        actual/
```

## Stable Contract

Every promoted item must preserve:

```text
document_id
source_id
snapshot_id
derived_from
freshness
status
visibility
sensitivity
entity_type
schema_status
consumer
workspace_id
access_policy
retention_policy
use_pattern
source_path or compiled_path
```

## Stable Relation Contract

Every implementation must be able to explain promoted memory and answers with these relation verbs:

```text
has_snapshot
supersedes_snapshot
contains_observation
proposes_memory
validates_memory
cites_snapshot
derives_from
concerns_entity
supersedes_memory
conflicts_with
restricts_access
promotes_to
recalled_by
supports_answer
creates_feedback
opens_review
```

These relation verbs are semantic requirements, not a mandatory database schema.
