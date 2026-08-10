# Implement Memory Fabric v2.5 — Longitudinal Memory Consolidation

## Intent

Implement the complete product and technical blueprint in
`docs/longitudinal-memory-consolidation-blueprint.md` on top of the deployed Memory Fabric
v2.4 architecture. Ordinary governed Hermes and Codex conversations must become episodic
evidence automatically. The Z2 runtime must consolidate clear user conclusions, contextual
endorsements, repeated preferences and evolving project state without requiring the phrase
`retiens que`.

The canonical vault remains authoritative. Hindsight 0.9.0 and GraphD/Neo4j remain derived,
rebuildable planes. `retiens que` becomes an immediate governed pin. Longitudinal processing
must be asynchronous, bounded, encrypted, idempotent, cited, temporally aware and recoverable.
The final runtime contract is v8 and is deployed directly to Z2 with full activation,
`canary=false` and `progressive=false`. Hermes remains native on Home 101 and reaches Z2 only
through the existing restricted tunnel.

- Do not create a new vector engine, graph engine, agent orchestrator or standalone service.
- Do not replace Hindsight, Neo4j, GraphD or the canonical vault.
- Do not let Hindsight or an assistant proposal activate canonical truth by itself.
- Do not retain system prompts, hidden reasoning, credentials, attachments or raw tool output.
- Do not infer sensitive psychological or personal traits from weak behavioral evidence.
- Do not authorize Gmail, Calendar or another external action from recalled memory alone.
- Do not physically delete an old memory merely because its recall priority decays.
- Do not add a second LLM provider, fallback model, canary or progressive deployment.
- Do not broaden a Codex checkout identity beyond its enrolled project.
- Do not require human review for ordinary independently verified consolidations.
- Do not overwrite or revert unrelated existing worktree changes.

Build and test the production artifacts, back up the current Z2 deployment, deploy runtime v8
directly without a canary, verify the six memory services, verify the Home 101 tunnel and
native Hermes provider, execute the live consolidation/recall/restart smoke, and leave a
recoverable deployment receipt. Do not move Hermes back to Z2.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

Memory Fabric v2.5 consolide automatiquement les conclusions et préférences longitudinales sans commande retiens que, garde une lignée citée, respecte autorité/fraîcheur/scope, transforme retiens que en épinglage, passe les 22 critères d'acceptation et les régressions v2-v2.4, puis runtime v8 est déployé intégralement sur Z2 sans canari.

## Suggested Mode

implementation

## Acceptance Hints

- Automated evidence must prove all 22 acceptance criteria from section 23 of the blueprint:
- A natural user conclusion is admitted without `retiens que`.
- A mundane conversation is archived without active-memory pollution.
- An unendorsed assistant suggestion cannot become a user preference.
- A valid short endorsement cites both the proposal and user acceptance.
- An ambiguous short endorsement is not activated.
- A behavioral preference requires three concordant episodes in at least two sessions.
- One Gmail draft receipt does not create a style preference.
- Confirmation reinforces without duplicating canonical memory.
- A direct new preference creates a temporal revision of the old one.
- Decay deprioritizes but does not delete historical memory.
- `retiens que` creates or updates a governed pinned memory.
- Fresh current memory outranks salient stale memory.
- Lineage explains episodes, verification, admission, reinforcement and revisions.
- Forgetting evidence transitively recalculates or revokes dependent syntheses.
- Hindsight outage leaves durable retryable work and never activates unvalidated output.
- Z2 restart resumes without loss, duplicate admission or partial cluster commit.
- Owner and checkout scopes remain isolated as designed.
- Signals and receipts contain no hidden or raw sensitive payloads.
- Historical Codex backfill and consolidation are idempotent.
- Worker batches, tokens, concurrency and capture latency remain bounded.
- Every generative function uses the one configured provider/model with no fallback.
- Runtime v8 is fully active on Z2 with no canary or progressive mode.
- Additional required evidence:
- New v2.5 verifier and acceptance matrix pass exactly.
- Focused unit, integration, security and restart tests pass.
- Existing v2, v2.2, v2.3 and v2.4 verification suites pass.
- Hindsight-native, specs, release, production and secret-hygiene checks remain green.
- A real E2E covers Hermes Home 101 -> Z2 capture -> consolidation -> cited recall.
- A real Z2 restart preserves worker state and recall.
- Web UI visual verification succeeds from the Mac through the existing tunnel.
- Deployment receipts show the existing six-service Z2 stack and native Home 101 Hermes only.
- The first automated test must exercise a natural user conclusion through capture, signal,
- consolidation, canonical admission and cited recall without an explicit memory command. The
- first negative tests must prove that a mundane conversation, an unendorsed assistant
- suggestion, an ambiguous `OK` and one Gmail receipt do not activate personal truth. Final
- manual and shipping proof must include browser inspection, a real Home 101 Hermes round trip,
- a Z2 restart, six-service health, source-backed runtime v8 configuration and a recoverable
- deployment receipt.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- Reuse current AEAD, redaction, admission, revision, command bus, Hindsight gateway, GraphD,
- `WorkspaceRuntimeSupervisor`, Personal Context Card and scope resolvers.
- Preserve canonical-vault-first and read-after-write semantics.
- Treat repetition as salience evidence, never as factual verification.
- Treat an assistant message as low-authority evidence until directly endorsed by the user.
- Make the worker internal to `supermemoryd`; add no port, public credential or container.
- Keep capture ACK outside the consolidation critical path.
- Limit default worker concurrency to one, batch size to 50 episodes, cluster size to 24
- episodes and cluster context to 32,000 tokens.
- Keep the Personal Context Card at or below 8,000 tokens.
- Preserve all unrelated user changes already present in the dirty worktree.
- Refresh Codebase Memory after material changes and verify exact source before final claims.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/implement-longitudinal-memory-consolidation-v25/brief.md --mode implementation --oracle "Memory Fabric v2.5 consolide automatiquement les conclusions et préférences longitudinales sans commande retiens que, garde une lignée citée, respecte autorité/fraîcheur/scope, transforme retiens que en épinglage, passe les 22 critères d'acceptation et les régressions v2-v2.4, puis runtime v8 est déployé intégralement sur Z2 sans canari." --out docs/goals/implement-memory-fabric-v2-5-longitudinal-memory-consolidation
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/goals/implement-longitudinal-memory-consolidation-v25-spec.md

> # Implement Memory Fabric v2.5 — Longitudinal Memory Consolidation
>
> ## Intent
>
> Implement the complete product and technical blueprint in
> `docs/longitudinal-memory-consolidation-blueprint.md` on top of the deployed Memory Fabric
> v2.4 architecture. Ordinary governed Hermes and Codex conversations must become episodic
> evidence automatically. The Z2 runtime must consolidate clear user conclusions, contextual
> endorsements, repeated preferences and evolving project state without requiring the phrase
> `retiens que`.
>
> The canonical vault remains authoritative. Hindsight 0.9.0 and GraphD/Neo4j remain derived,
> rebuildable planes. `retiens que` becomes an immediate governed pin. Longitudinal processing
> must be asynchronous, bounded, encrypted, idempotent, cited, temporally aware and recoverable.
> The final runtime contract is v8 and is deployed directly to Z2 with full activation,
> `canary=false` and `progressive=false`. Hermes remains native on Home 101 and reaches Z2 only
> through the existing restricted tunnel.
>
> ## Non-Goals
>
> - Do not create a new vector engine, graph engine, agent orchestrator or standalone service.
> - Do not replace Hindsight, Neo4j, GraphD or the canonical vault.
> - Do not let Hindsight or an assistant proposal activate canonical truth by itself.
> - Do not retain system prompts, hidden reasoning, credentials, attachments or raw tool output.
> - Do not infer sensitive psychological or personal traits from weak behavioral evidence.
> - Do not authorize Gmail, Calendar or another external action from recalled memory alone.
> - Do not physically delete an old memory merely because its recall priority decays.
> - Do not add a second LLM provider, fallback model, canary or progressive deployment.
> - Do not broaden a Codex checkout identity beyond its enrolled project.
> - Do not require human review for ordinary independently verified consolidations.
> - Do not overwrite or revert unrelated existing worktree changes.
>
> ## Required Capabilities
>
> - `MemorySignal v1` with explicit authority role, scope, temporal class and evidence lineage.
> - Contextual endorsement resolution for short user acceptance of one preceding visible proposal.
> - Deterministic evidence clustering bounded by owner, workspace, subject, tokens and episode count.
> - A recoverable longitudinal consolidator supporting observe, activate, reinforce, revise,
>   supersede, deemphasize and noop.
> - Versioned `salience-v1` policy whose deterministic score uses user commitment,
>   consequentiality, future utility, recurrence, stability, reuse and recency.
> - Independent verification and canonical commit-before-projection for every activation or
>   revision.
> - Class-aware non-destructive decay and freshness-aware recall ranking.
> - Pin/unpin, lineage explanation and bounded recall feedback for the Personal Manager.
> - Recalculation of dependent syntheses after correction, revocation or forgetting.
> - Runtime contract v8, Web visibility, metrics and an encrypted worker checkpoint.
> - Historical Codex import by idempotent bounded batches after project-binding resolution.
>
> ## Proposed Oracle
>
> Memory Fabric v2.5 consolidates natural user conclusions and longitudinal preferences without
> requiring `retiens que`, preserves cited lineage and authority/freshness/scope, treats explicit
> remembering as pinning, passes the 22 blueprint acceptance criteria and all v2-v2.4
> regressions, then runs as fully active runtime v8 on Z2 without canary or progressive mode.
>
> ## Acceptance
>
> Automated evidence must prove all 22 acceptance criteria from section 23 of the blueprint:
>
> 1. A natural user conclusion is admitted without `retiens que`.
> 2. A mundane conversation is archived without active-memory pollution.
> 3. An unendorsed assistant suggestion cannot become a user preference.
> 4. A valid short endorsement cites both the proposal and user acceptance.
> 5. An ambiguous short endorsement is not activated.
> 6. A behavioral preference requires three concordant episodes in at least two sessions.
> 7. One Gmail draft receipt does not create a style preference.
> 8. Confirmation reinforces without duplicating canonical memory.
> 9. A direct new preference creates a temporal revision of the old one.
> 10. Decay deprioritizes but does not delete historical memory.
> 11. `retiens que` creates or updates a governed pinned memory.
> 12. Fresh current memory outranks salient stale memory.
> 13. Lineage explains episodes, verification, admission, reinforcement and revisions.
> 14. Forgetting evidence transitively recalculates or revokes dependent syntheses.
> 15. Hindsight outage leaves durable retryable work and never activates unvalidated output.
> 16. Z2 restart resumes without loss, duplicate admission or partial cluster commit.
> 17. Owner and checkout scopes remain isolated as designed.
> 18. Signals and receipts contain no hidden or raw sensitive payloads.
> 19. Historical Codex backfill and consolidation are idempotent.
> 20. Worker batches, tokens, concurrency and capture latency remain bounded.
> 21. Every generative function uses the one configured provider/model with no fallback.
> 22. Runtime v8 is fully active on Z2 with no canary or progressive mode.
>
> Additional required evidence:
>
> - New v2.5 verifier and acceptance matrix pass exactly.
> - Focused unit, integration, security and restart tests pass.
> - Existing v2, v2.2, v2.3 and v2.4 verification suites pass.
> - Hindsight-native, specs, release, production and secret-hygiene checks remain green.
> - A real E2E covers Hermes Home 101 -> Z2 capture -> consolidation -> cited recall.
> - A real Z2 restart preserves worker state and recall.
> - Web UI visual verification succeeds from the Mac through the existing tunnel.
> - Deployment receipts show the existing six-service Z2 stack and native Home 101 Hermes only.
>
> The first automated test must exercise a natural user conclusion through capture, signal,
> consolidation, canonical admission and cited recall without an explicit memory command. The
> first negative tests must prove that a mundane conversation, an unendorsed assistant
> suggestion, an ambiguous `OK` and one Gmail receipt do not activate personal truth. Final
> manual and shipping proof must include browser inspection, a real Home 101 Hermes round trip,
> a Z2 restart, six-service health, source-backed runtime v8 configuration and a recoverable
> deployment receipt.
>
> ## Constraints
>
> - Reuse current AEAD, redaction, admission, revision, command bus, Hindsight gateway, GraphD,
>   `WorkspaceRuntimeSupervisor`, Personal Context Card and scope resolvers.
> - Preserve canonical-vault-first and read-after-write semantics.
> - Treat repetition as salience evidence, never as factual verification.
> - Treat an assistant message as low-authority evidence until directly endorsed by the user.
> - Make the worker internal to `supermemoryd`; add no port, public credential or container.
> - Keep capture ACK outside the consolidation critical path.
> - Limit default worker concurrency to one, batch size to 50 episodes, cluster size to 24
>   episodes and cluster context to 32,000 tokens.
> - Keep the Personal Context Card at or below 8,000 tokens.
> - Preserve all unrelated user changes already present in the dirty worktree.
> - Refresh Codebase Memory after material changes and verify exact source before final claims.
>
> ## Deployment Outcome
>
> Build and test the production artifacts, back up the current Z2 deployment, deploy runtime v8
> directly without a canary, verify the six memory services, verify the Home 101 tunnel and
> native Hermes provider, execute the live consolidation/recall/restart smoke, and leave a
> recoverable deployment receipt. Do not move Hermes back to Z2.
