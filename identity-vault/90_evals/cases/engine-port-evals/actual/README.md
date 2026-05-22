# Engine Port Evals Fixture

This fixture proves Tranche 11 without installing or invoking Graphiti, Memoria, or another engine.

It checks that engine ports remain governed extension points:

- Graphiti is `not_activated` while Hindsight passes current temporal evals.
- Memoria is `not_activated` while vault snapshots and logs cover rollback and audit.
- A red temporal eval may create a `candidate_port` with justification.
- A port that wants to own permissions, revocation, freshness, or agent contracts is rejected.

The matching JSONL-shaped log lives in `identity-vault/80_logs/engine_port_evals.jsonl`.

