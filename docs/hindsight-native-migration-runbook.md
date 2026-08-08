# Hindsight-Native Memory Plane — Migration and Rollback

This procedure upgrades the derived learned-memory plane to Hindsight 0.9.0.
It never rewrites the encrypted canonical vault. Deployment is one complete
stack action: there is no canary, traffic split or progressive activation.

## Preconditions

1. Run `npm test`, `npm run verify:hindsight-native`,
   `npm run verify:memory-fabric-v2`, `npm run verify:release` and
   `npm run verify:secrets`.
2. Validate `deploy/portainer/supermemory-ai-stack.yml` with Compose config;
   do not start it during repository verification.
3. Take and checksum the Neo4j offline backup described in
   `deploy/portainer/README.md`.
4. Preserve the previous Hindsight derived volume. The v0.9.0 stack uses new
   `supermemory-hindsight-v090-*` volumes, so rollback does not depend on a
   destructive in-place database upgrade.

## Plan

Run the migration module in plan mode against the explicit workspace. Record
the returned plan hash, source volume label, bank-template hash, GraphD
projection hash and active canonical-memory count. Planning is read-only.

The apply operation must receive that exact plan hash. A changed vault,
template or graph projection invalidates the plan and requires a new plan.

## Apply

1. Deploy the complete six-service stack from the pinned Portainer artifact.
2. Verify Hindsight reports exactly 0.9.0 and exposes retain, recall,
   observations, Reflect, consolidation, operation and bank-configuration
   capabilities.
3. Import the versioned bank template and reject any unresolved drift.
4. Rebuild the new Hindsight derived volume from active canonical memories,
   using deterministic native operation IDs.
5. Replace the complete workspace graph through authenticated GraphD v2 and
   require the exact projection-hash acknowledgement.
6. Consolidate at the controlled boundary and persist the encrypted migration
   receipt. Reapplying the same plan is idempotent.
7. Run cited hybrid recall, historical recall, multi-hop graph recall and a
   schema-bounded Reflect request. Derived output is accepted only when every
   source fact revalidates against the canonical vault.

## Rollback

Stop the complete stack. Restore the previous application revision, restore
the checksummed Neo4j dump when the graph was changed, and reattach the
preserved previous Hindsight derived volume. Never restore Hindsight data over
the canonical vault. Restart the complete previous stack and rerun its
readiness checks. The v0.9.0 volumes may be retained for audit or removed later
through an explicit, separately approved destructive operation.

## Repository-only status

When no runtime is deployed, record migration execution as
`not_applicable_no_runtime_deployed`. This is not a runtime-ready result: it
proves only that implementation, deterministic migration and rollback contracts
pass without starting containers or writing to a live bank.
