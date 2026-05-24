# SuperMemory Production Readiness Notes

## Intent

Enchainer tout ce qu'il reste a faire jusqu'a une version prete a mettre en production, avec une approche TDD, sans revenir vers le owner avant que le produit soit pret ou qu'un vrai blocker de production exige une decision/credential.

- Do not build a hosted SaaS UI.
- Do not add Gmail, Drive, CRM, web crawler, or paid external source connectors.
- Do not run real production customer data.
- Do not require Hindsight Cloud for readiness.
- Do not add database migrations, background workers, auth/RLS, billing, or multi-tenant web deployment.
- Do not replace the existing deep scripts with a large framework.
- Do not weaken existing T0-T14 contracts or bypass reviewed-plan/owner-confirmation gates.
- Do not make live writes in CI.

SuperMemory is considered ready to put in production when a maintainer can:

1. run one release preflight command that proves the repository, docs, operator workflow, and critical TDD contracts are green;
2. see a clear operator command surface for the supported local-first workflow;
3. use the local Docker Hindsight target as the default live-smoke target, with cloud only as explicit opt-in;
4. produce reviewed plans before applying capture, refresh, or Hindsight promotion;
5. prove fail-closed behavior for secrets, unsafe writes, tampering, missing owner confirmation, broad scope, live env absence, and cloud fallback;
6. read a production runbook with setup, preflight, smoke, release, rollback, observability, credential boundaries, and known non-goals;
7. see CI enforce the production release verifier without live credentials.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

The production readiness goal is complete when node scripts/verify-supermemory-release-readiness.mjs, node scripts/verify-supermemory-specs.mjs, git diff --check, and the GoalBuddy final quality check pass; CI contains the release readiness verifier; docs describe the production operator workflow and rollback; no secrets/live evidence are committed; and all changes are committed and pushed.

## Suggested Mode

implementation

## Acceptance Hints

- Required final evidence:
- `node scripts/verify-supermemory-release-readiness.mjs` passes and emits a release-ready report.
- `node scripts/verify-supermemory-specs.mjs` passes.
- `git diff --check` passes.
- The release readiness verifier is wired into `.github/workflows/supermemory-specs.yml`.
- A production runbook exists and is referenced from `README.md`.
- The runbook covers setup, release preflight, local Docker Hindsight, fake/live smoke separation, reviewed capture/refresh/promotion flow, rollback, observability, credential boundaries, and non-goals.
- The release verifier proves no tracked release artifact contains obvious secret-like values or tracked live-smoke evidence from `tmp/`.
- Tests/verifiers cover fail-closed behavior for owner confirmation, tampering, scope escape, unsafe vault writes, missing live env, and no implicit cloud fallback.
- GoalBuddy T998 records commit SHA, remote branch, pushed files, and push result.
- GoalBuddy T999 records final production-readiness audit decision.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- Keep the architecture LLM-first for interpretation and deterministic for governance.
- Use TDD: write or extend failing tests/verifiers before implementation for each production slice.
- Do not commit secrets, env files, live evidence, or production-like local logs.
- Do not silently use Hindsight Cloud; local Docker/self-hosted remains the default runtime target.
- CI remains mock-only and must not perform live Hindsight writes.
- Live/local writes may only happen through explicit opt-in env and owner-confirmed local commands.
- Keep `identity-vault` as source of truth.
- Do not invent broad external connectors before the local operator release is coherent.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/supermemory-production-readiness/brief.md --mode implementation --oracle "The production readiness goal is complete when node scripts/verify-supermemory-release-readiness.mjs, node scripts/verify-supermemory-specs.mjs, git diff --check, and the GoalBuddy final quality check pass; CI contains the release readiness verifier; docs describe the production operator workflow and rollback; no secrets/live evidence are committed; and all changes are committed and pushed." --out docs/goals/supermemory-production-readiness-notes
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/supermemory-production-readiness-notes.md

> # SuperMemory Production Readiness Notes
> 
> ## Owner intent
> 
> Enchainer tout ce qu'il reste a faire jusqu'a une version prete a mettre en production, avec une approche TDD, sans revenir vers le owner avant que le produit soit pret ou qu'un vrai blocker de production exige une decision/credential.
> 
> ## Current known state
> 
> - T0-T14 executable specification path is complete and covered by `node scripts/verify-supermemory-specs.mjs`.
> - Local/manual capture has dry-run, write-plan, apply-plan, owner-confirmed vault commit, and workflow smoke.
> - Local-file refresh has dry-run, write-plan, apply-plan, owner-confirmed vault commit, and workflow smoke.
> - Hindsight local Docker compose exists and binds localhost-only.
> - Hindsight transport is mockable and local live smoke with fake local credentials has passed against Docker.
> - Hindsight promotion now supports reviewed `--write-plan` and owner-confirmed `--apply-plan`.
> - Golden End State workflow verifier exists and is wired into the global specs.
> - CI currently runs the CI regression verifier, global specs, and whitespace check.
> 
> ## Production-readiness gap
> 
> The repo is now operator-capable in slices, but not yet productized as a release surface. Remaining production work should focus on packaging the existing safe pieces into a coherent operator/release workflow instead of adding broad new concepts.
> 
> Known gaps:
> 
> - no single release preflight command that proves the repo is ready to ship;
> - no single operator command surface that guides capture, refresh, Hindsight preflight, reviewed promotion, smoke, and audit commands;
> - docs still require maintainers to stitch several scripts together manually;
> - no explicit release readiness artifact or runbook that says what can be deployed, what remains local-only, what needs credentials, and how rollback works;
> - no release gate proving no committed secret-like evidence/log paths are included in the shipping surface;
> - no CI/release verifier that combines global specs, golden workflow, Hindsight local preflight expectations, reviewed promotion tests, capture/refresh workflow smokes, and release docs checks.
> 
> ## Constraints
> 
> - Keep the architecture LLM-first for interpretation and deterministic for governance.
> - Use TDD: write or extend failing tests/verifiers before implementation for each production slice.
> - Do not commit secrets, env files, live evidence, or production-like local logs.
> - Do not silently use Hindsight Cloud; local Docker/self-hosted remains the default runtime target.
> - CI remains mock-only and must not perform live Hindsight writes.
> - Live/local writes may only happen through explicit opt-in env and owner-confirmed local commands.
> - Keep `identity-vault` as source of truth.
> - Do not invent broad external connectors before the local operator release is coherent.
> 
> ## Non-Goals
> 
> - Do not build a hosted SaaS UI.
> - Do not add Gmail, Drive, CRM, web crawler, or paid external source connectors.
> - Do not run real production customer data.
> - Do not require Hindsight Cloud for readiness.
> - Do not add database migrations, background workers, auth/RLS, billing, or multi-tenant web deployment.
> - Do not replace the existing deep scripts with a large framework.
> - Do not weaken existing T0-T14 contracts or bypass reviewed-plan/owner-confirmation gates.
> - Do not make live writes in CI.
> 
> ## Acceptance
> 
> Required final evidence:
> 
> - `node scripts/verify-supermemory-release-readiness.mjs` passes and emits a release-ready report.
> - `node scripts/verify-supermemory-specs.mjs` passes.
> - `git diff --check` passes.
> - The release readiness verifier is wired into `.github/workflows/supermemory-specs.yml`.
> - A production runbook exists and is referenced from `README.md`.
> - The runbook covers setup, release preflight, local Docker Hindsight, fake/live smoke separation, reviewed capture/refresh/promotion flow, rollback, observability, credential boundaries, and non-goals.
> - The release verifier proves no tracked release artifact contains obvious secret-like values or tracked live-smoke evidence from `tmp/`.
> - Tests/verifiers cover fail-closed behavior for owner confirmation, tampering, scope escape, unsafe vault writes, missing live env, and no implicit cloud fallback.
> - GoalBuddy T998 records commit SHA, remote branch, pushed files, and push result.
> - GoalBuddy T999 records final production-readiness audit decision.
> 
> ## Desired production-ready outcome
> 
> SuperMemory is considered ready to put in production when a maintainer can:
> 
> 1. run one release preflight command that proves the repository, docs, operator workflow, and critical TDD contracts are green;
> 2. see a clear operator command surface for the supported local-first workflow;
> 3. use the local Docker Hindsight target as the default live-smoke target, with cloud only as explicit opt-in;
> 4. produce reviewed plans before applying capture, refresh, or Hindsight promotion;
> 5. prove fail-closed behavior for secrets, unsafe writes, tampering, missing owner confirmation, broad scope, live env absence, and cloud fallback;
> 6. read a production runbook with setup, preflight, smoke, release, rollback, observability, credential boundaries, and known non-goals;
> 7. see CI enforce the production release verifier without live credentials.
> 
> ## Suggested implementation slices
> 
> ### Slice 1: Release readiness verifier
> 
> Create a top-level verifier script that runs or checks the critical production gates and produces a compact machine-readable release report.
> 
> Expected coverage:
> 
> - global specs;
> - golden end-state workflow;
> - local manual capture CLI/workflow;
> - local file refresh CLI/workflow;
> - Hindsight promotion reviewed-plan tests;
> - Hindsight transport/live-smoke mock and local preflight checks;
> - Docker compose localhost binding;
> - production runbook/doc presence;
> - no committed secret-like evidence/log artifacts in tracked files.
> 
> ### Slice 2: Operator workflow CLI or command index
> 
> Add the smallest coherent operator surface, probably a Node script under `scripts/`, that prints or verifies the supported production workflow and refuses unsupported modes. It should not replace existing deep scripts prematurely; it can orchestrate/read them and expose a stable release/operator interface.
> 
> ### Slice 3: Production runbook and README alignment
> 
> Document:
> 
> - local setup;
> - release preflight;
> - capture/refresh/promotion flow;
> - local Hindsight Docker;
> - fake credential smoke vs real local credentials;
> - cloud opt-in boundary;
> - rollback;
> - observability/log evidence;
> - what is not production-ready yet.
> 
> ### Slice 4: CI release gate
> 
> Wire the release verifier into CI while keeping it mock-only and live-write-free.
> 
> ### Slice 5: Final production audit
> 
> Run the full release verifier, global specs, whitespace check, GoalBuddy final check, commit and push. Final audit should say whether production readiness is satisfied or blocked by explicit owner credentials/infrastructure choices.
> 
> ## Oracle
> 
> The production readiness goal is complete when `node scripts/verify-supermemory-release-readiness.mjs`, `node scripts/verify-supermemory-specs.mjs`, `git diff --check`, and the GoalBuddy final quality check pass; CI contains the release readiness verifier; docs describe the production operator workflow and rollback; no secrets/live evidence are committed; and all changes are committed and pushed.
