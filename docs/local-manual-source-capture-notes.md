# Local Manual Source Capture

## Intent

Implement the first concrete source-capture workflow without external credentials, network calls, or a real connector.

The existing tranches already prove mutable source refresh, refresh preflight, and connector safety boundaries. The next useful step is to prove that a manually supplied local source can become a governed source record and immutable snapshot candidate without scanning neighboring files or bypassing governance.

## Outcome

A local/manual source capture fixture proves:

- a manually provided file/text source has explicit owner intent, connector metadata, workspace, source kind, sensitivity, and allowed scope;
- capture produces a source registry entry and an immutable snapshot record;
- snapshot proof includes content hash, captured_at, original_ref, connector_id, connector_scope, and source_id;
- the capture is bounded to the requested file/ref only, not a folder or broad local scan;
- source text is evidence only and cannot provide agent instructions;
- secrets are redacted before snapshot-derived memory/promotion surfaces;
- `do_not_use` sources are not snapshotted or promoted as active evidence;
- invalid captures fail closed with named errors.

## Non-goals

- No real filesystem crawler.
- No live external connector.
- No Hindsight runtime call.
- No UI.
- No database migration.
- No broad folder scan.

## Oracle

Complete when all commands pass:

```bash
node scripts/verify-local-manual-source-capture.mjs
node --test tests/local-manual-source-capture.test.mjs
node scripts/verify-source-refresh-connector-boundary.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

## Acceptance

The first tests/evidence should cover these user-visible paths:

- happy path: one explicit local/manual source is accepted and yields exactly one source registry entry plus one immutable snapshot;
- bounded capture: a folder-like source scope or neighboring file reference is rejected as `manual_capture_scope_escape`;
- owner intent: a capture without `requested_by`, `capture_reason`, or `owner_confirmed: true` is rejected as `missing_owner_intent`;
- provenance: a snapshot without `source_id`, `connector_id`, `connector_scope`, `original_ref`, `content_hash`, `captured_at`, or `immutable: true` is rejected as `missing_snapshot_proof`;
- source text safety: source content containing agent instructions is recorded only as evidence and rejected if surfaced as executable guidance, with error `source_instruction_leaked`;
- secret safety: raw API keys/tokens/password-like values are rejected from derived memory/promotion surfaces as `secret_leaked_from_manual_capture`;
- forbidden status: `do_not_use` source capture creates no active snapshot or promotion and fails as `do_not_use_manual_source_captured`;
- global regression: source refresh connector boundary and full SuperMemory specs still pass.

## Expected files

- `identity-vault/90_evals/cases/local-manual-source-capture/**`
- `scripts/verify-local-manual-source-capture.mjs`
- `tests/local-manual-source-capture.test.mjs`
- `scripts/verify-supermemory-specs.mjs`
- `README.md`
- `docs/golden-case-implementation-roadmap.md`
- `docs/goals/local-manual-source-capture/**`
