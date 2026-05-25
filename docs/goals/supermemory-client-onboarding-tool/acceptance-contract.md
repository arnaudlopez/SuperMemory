# Acceptance Contract

## Goal

# SuperMemory Client Onboarding Tool Notes

## Intent

Implement a small local-first onboarding tool that helps an operator set up SuperMemory for a client or project without needing to manually stitch together lower-level scripts.

The tool should make the first enterprise setup safer and faster while preserving the existing SuperMemory operating model: explicit scope, reviewable plans, staging, owner confirmation, no live writes by default, and the vault as source of truth.

- No hosted UI.
- No interactive prompt UI in this slice.
- No real external connectors.
- No Hindsight live write.
- No memory compilation.
- No folder watching daemon.
- No hidden scan outside the explicit source root.
- No database, auth, billing, background worker, or SaaS deployment.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

The client onboarding tool goal is complete when an operator can create a redacted reviewed onboarding plan from an explicit client source folder, apply it to staging, commit staging into a vault only with owner confirmation, and see fail-closed behavior for missing owner intent, scope escape, no matched files, secret-like source warnings, tampered plans/staging, non-empty staging dirs, identity-vault apply destinations, duplicate vault entries, raw-content leakage, and any network/Hindsight write attempt, while node --test tests/supermemory-onboard.test.mjs, node scripts/verify-supermemory-onboarding.mjs, node scripts/verify-supermemory-release-readiness.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

## Suggested Mode

implementation

## Acceptance Hints

- Required evidence:
- A red TDD test first proves the onboarding CLI is missing or incomplete.
- `node --test tests/supermemory-onboard.test.mjs` passes.
- `node scripts/verify-supermemory-onboarding.mjs` passes.
- `node scripts/verify-supermemory-release-readiness.mjs` passes.
- `node scripts/verify-supermemory-specs.mjs` passes.
- `git diff --check` passes.
- README and production runbook mention the onboarding command.
- Release readiness includes onboarding verification.
- GoalBuddy T998 records commit SHA and push proof.
- GoalBuddy T999 records final outcome complete.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- TODO: Capture constraints, must-preserve behavior, boundaries, or forbidden changes.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/supermemory-client-onboarding-tool/brief.md --mode implementation --oracle "The client onboarding tool goal is complete when an operator can create a redacted reviewed onboarding plan from an explicit client source folder, apply it to staging, commit staging into a vault only with owner confirmation, and see fail-closed behavior for missing owner intent, scope escape, no matched files, secret-like source warnings, tampered plans/staging, non-empty staging dirs, identity-vault apply destinations, duplicate vault entries, raw-content leakage, and any network/Hindsight write attempt, while node --test tests/supermemory-onboard.test.mjs, node scripts/verify-supermemory-onboarding.mjs, node scripts/verify-supermemory-release-readiness.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass." --out docs/goals/supermemory-client-onboarding-tool-notes
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/supermemory-client-onboarding-tool-notes.md

> # SuperMemory Client Onboarding Tool Notes
> 
> ## Intent
> 
> Implement a small local-first onboarding tool that helps an operator set up SuperMemory for a client or project without needing to manually stitch together lower-level scripts.
> 
> The tool should make the first enterprise setup safer and faster while preserving the existing SuperMemory operating model: explicit scope, reviewable plans, staging, owner confirmation, no live writes by default, and the vault as source of truth.
> 
> ## Current context
> 
> - SuperMemory is now a local-first operator release candidate.
> - Local manual capture already supports dry-run, `--write-plan`, `--apply-plan`, staging, and owner-confirmed vault commit for one explicit file.
> - Local file refresh already supports reviewed plans and owner-confirmed commit for registered `local_file` sources.
> - Hindsight promotion already supports reviewed promotion plans and owner-confirmed apply.
> - `scripts/supermemory-operator.mjs` and `docs/production-runbook.md` expose the production workflow.
> - `scripts/verify-supermemory-release-readiness.mjs` is the release gate.
> 
> ## Proposed feature
> 
> Add a new onboarding CLI:
> 
> ```bash
> node scripts/supermemory-onboard.mjs
> ```
> 
> MVP modes:
> 
> ```bash
> node scripts/supermemory-onboard.mjs \
>   --client "Client ACME" \
>   --workspace workspace:acme \
>   --source-root /path/to/client-folder \
>   --include "**/*.md" \
>   --include "**/*.json" \
>   --exclude "**/.env*" \
>   --exclude "node_modules/**" \
>   --requested-by arnaud \
>   --capture-reason "client memory bootstrap" \
>   --write-plan tmp/acme-onboarding-plan.json \
>   --json
> 
> node scripts/supermemory-onboard.mjs \
>   --apply-plan tmp/acme-onboarding-plan.json \
>   --out-dir tmp/acme-onboarding-staging \
>   --json
> 
> node scripts/supermemory-onboard.mjs \
>   --commit-staging tmp/acme-onboarding-staging \
>   --vault-root identity-vault \
>   --owner-confirmed \
>   --json
> ```
> 
> ## Desired behavior
> 
> Dry-run / write-plan:
> 
> - Accept a client name, workspace id, requested-by, capture reason, source root, include patterns, and exclude patterns.
> - Inventory only files under the explicit `source-root`.
> - Support safe glob-like patterns for MVP:
>   - `**/*.md`
>   - `**/*.json`
>   - `*.md`
>   - exact relative file paths
>   - directory excludes such as `node_modules/**`, `.git/**`, `tmp/**`
>   - exact filename excludes such as `**/.env*`
> - Default excludes must include `.git/**`, `node_modules/**`, `tmp/**`, `dist/**`, `build/**`, `.env*`, and `**/.env*`.
> - Refuse missing owner intent, missing workspace, missing include patterns, missing/invalid source root, source-root outside filesystem, or patterns that match no files.
> - Refuse scope escape attempts.
> - Do not print or persist raw file content.
> - Compute per-file hashes and create source registry / snapshot candidates.
> - Mark files with secret-like text as warnings and default them to `needs_review`, not active capture.
> - Produce a reviewable onboarding plan with `generated_from: supermemory_client_onboarding`, `network_writes: false`, `writes_performed: false`, `promotion_payloads: []`, and no raw content.
> 
> Apply-plan:
> 
> - Accept only valid onboarding plans with no validation errors.
> - Refuse tampered plans by checking a stable plan hash.
> - Refuse plans containing raw content fields.
> - Refuse non-empty output directories.
> - Refuse output inside `identity-vault`.
> - Write reviewable JSON artifacts only:
>   - `onboarding-plan.json`
>   - `workspace.json`
>   - `source-registry.json`
>   - `snapshots.json`
>   - `warnings.json`
>   - `manifest.json`
> 
> Commit-staging:
> 
> - Require `--owner-confirmed`.
> - Read only staging artifacts.
> - Refuse tampered/incomplete staging.
> - Refuse duplicate source ids or snapshot ids in the target vault.
> - Create missing `00_inbox/source_registry.md` and `00_inbox/snapshot_registry.md` if needed with clear generated sections.
> - Append only source registry rows and snapshot registry rows.
> - Do not compile active memory, do not promote to Hindsight, and do not call network services.
> 
> ## Non-Goals
> 
> - No hosted UI.
> - No interactive prompt UI in this slice.
> - No real external connectors.
> - No Hindsight live write.
> - No memory compilation.
> - No folder watching daemon.
> - No hidden scan outside the explicit source root.
> - No database, auth, billing, background worker, or SaaS deployment.
> 
> ## Acceptance
> 
> Required evidence:
> 
> - A red TDD test first proves the onboarding CLI is missing or incomplete.
> - `node --test tests/supermemory-onboard.test.mjs` passes.
> - `node scripts/verify-supermemory-onboarding.mjs` passes.
> - `node scripts/verify-supermemory-release-readiness.mjs` passes.
> - `node scripts/verify-supermemory-specs.mjs` passes.
> - `git diff --check` passes.
> - README and production runbook mention the onboarding command.
> - Release readiness includes onboarding verification.
> - GoalBuddy T998 records commit SHA and push proof.
> - GoalBuddy T999 records final outcome complete.
> 
> ## Oracle
> 
> The client onboarding tool goal is complete when an operator can create a redacted reviewed onboarding plan from an explicit client source folder, apply it to staging, commit staging into a vault only with owner confirmation, and see fail-closed behavior for missing owner intent, scope escape, no matched files, secret-like source warnings, tampered plans/staging, non-empty staging dirs, identity-vault apply destinations, duplicate vault entries, raw-content leakage, and any network/Hindsight write attempt, while `node --test tests/supermemory-onboard.test.mjs`, `node scripts/verify-supermemory-onboarding.mjs`, `node scripts/verify-supermemory-release-readiness.mjs`, `node scripts/verify-supermemory-specs.mjs`, and `git diff --check` all pass.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

The client onboarding tool goal is complete when an operator can create a redacted reviewed onboarding plan from an explicit client source folder, apply it to staging, commit staging into a vault only with owner confirmation, and see fail-closed behavior for missing owner intent, scope escape, no matched files, secret-like source warnings, tampered plans/staging, non-empty staging dirs, identity-vault apply destinations, duplicate vault entries, raw-content leakage, and any network/Hindsight write attempt, while node --test tests/supermemory-onboard.test.mjs, node scripts/verify-supermemory-onboarding.mjs, node scripts/verify-supermemory-release-readiness.mjs, node scripts/verify-supermemory-specs.mjs, and git diff --check all pass.

## Visible Outcome

T001/T002 must replace this placeholder with the observable user-facing behavior, generated artifact, audit answer, or verification result that should exist at the end.

## Acceptance Tests To Write First

- Given the clarified spec, when the owner exercises the main path, then the visible outcome matches the requested behavior.
- Given an important edge case from the spec, when the code handles it, then the result is deterministic and documented.
- Given a likely failure mode, when the implementation is incomplete, then a targeted test fails before production code is changed.

## Failure Modes To Prevent

- Implementation starts before the acceptance/evidence contract is specific enough.
- Tests pass but do not prove the owner-visible outcome.
- The work drifts outside the LLM-first intent, non-goals, or approved boundaries.
- Operational risks such as migrations, env/secrets, auth, external services, or shipping proof are discovered but not handled.

## Manual Or Visual Proof If Needed

If code tests cannot fully prove the outcome, T001/T002 must define the manual, artifact, source-backed, or browser proof required before final audit.

## Out Of Scope

T001/T002 must keep or revise this list:

- Do not implement behavior outside the approved acceptance contract.
- Do not change unrelated dirty files.
- Do not skip the red test stage because implementation seems obvious.

## Shipping Proof

- T998 must record commit SHA, remote branch or push string, push result, committed files, and unrelated dirty files left untouched.

## End-State Evidence To Produce

- Product behavior or artifact visible to the owner.
- Acceptance tests that fail before implementation and pass after implementation.
- Verification commands with results.
- Design review mapped back to the original request.
- Commit and push proof, or an explicit shipping blocker such as `no_git_repository` or `no_github_remote`.

## Acceptance Or Evidence Draft

T001 must replace this draft with concrete tests after reading the target repository.

- Given the clarified spec, when the owner exercises the main path, then the visible outcome matches the requested behavior.
- Given an important edge case from the spec, when the code handles it, then the result is deterministic and documented.
- Given a likely failure mode, when the implementation is incomplete, then a targeted test fails before production code is changed.

## Visual Or Demo Oracle

If the goal has UI, T001/T002 must decide whether browser or screenshot evidence is required before Worker work starts.

## Non-Goals

T001/T002 must keep or revise this list:

- Do not implement behavior outside the approved acceptance contract.
- Do not change unrelated dirty files.
- Do not skip the red test stage because implementation seems obvious.
