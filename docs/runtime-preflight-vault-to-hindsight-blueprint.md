# Runtime Preflight: Vault-To-Hindsight Promotion Blueprint

Date: 2026-05-22

## Purpose

This blueprint prepares the first real runtime implementation after the T0-T14 executable specification.

The target is a vault-to-Hindsight promotion preflight, not a broad connector system:

- read governed promotion payloads from existing SuperMemory fixtures or vault-derived inputs;
- validate them against the current Hindsight contract;
- support dry-run as the default;
- only allow live writes after explicit env and command opt-in;
- preserve the fake/local adapter as the contract oracle.
- prefer a self-hosted/local Hindsight runtime for the first real smoke; Hindsight Cloud is an explicit optional endpoint, not the default runtime assumption.

## Current Contract Inputs

Authoritative sources:

- `identity-vault/75_governance/hindsight_contract.md`
- `identity-vault/75_governance/sequential_relational_model.md`
- `identity-vault/90_evals/cases/hindsight-adapter-minimal/input/fixture.json`
- `identity-vault/90_evals/cases/hindsight-adapter-minimal/expected/adapter-state.json`
- `scripts/verify-hindsight-adapter-minimal.mjs`
- `scripts/verify-governed-answer-evidence.mjs`
- `scripts/verify-supermemory-specs.mjs`

The runtime preflight must preserve these invariants:

- vault remains the source of truth;
- Hindsight receives governed `ValidatedMemory` or explicitly approved raw audit payloads, not unchecked LLM conclusions;
- every promoted item has stable `document_id`;
- active promotion requires source, snapshot, observation, interpretation, and memory provenance;
- recall is fail-closed and scoped by workspace, access policy, status, and consumer;
- `do_not_use` deletes or excludes active Hindsight documents;
- adapter traces stay auditable and connect recall to answer evidence.

## Runtime Unknowns

The implementation goal must verify official Hindsight API details before writing live calls.

Do not hard-code unverified endpoint syntax from this blueprint. Treat live API method names, auth header shape, rate limits, retry semantics, delete/upsert semantics, and local-vs-hosted setup as implementation-time documentation checks.

Runtime placement decision:

- SuperMemory should run the first real smoke against self-hosted/local Hindsight, not Hindsight Cloud.
- `HINDSIGHT_BASE_URL` must be explicit for live runs. For local smoke, use a local endpoint such as `http://127.0.0.1:8888`.
- Hindsight Cloud (`https://api.hindsight.vectorize.io`) may be used only when the owner intentionally chooses a cloud target.
- The transport layer must not silently fall back from local/self-hosted to cloud.
- CI remains mock-only.

This blueprint only fixes the SuperMemory side of the contract.

## Proposed CLI Contract

Recommended command:

```bash
node scripts/hindsight-promote.mjs --input identity-vault/90_evals/cases/hindsight-adapter-minimal/input/fixture.json --dry-run
```

Required modes:

- `--dry-run`: default; validates and prints a promotion plan; performs no network write.
- `--live`: opt-in; allowed only when credentials and target bank are present.
- `--input <path>`: JSON input containing `promotion_payloads`, `recall_policies`, and optional answer evidence checks.
- `--bank <bank_id>`: optional override, defaulting to configured SuperMemory bank.
- `--json`: machine-readable summary for tests and logs.

Recommended exit behavior:

- exit `0` when validation passes and dry-run or live operations complete;
- non-zero when governance validation fails;
- non-zero when `--live` is requested without required env;
- non-zero when live response shape cannot be reconciled with the adapter trace contract.

## Environment Contract

No env file should be committed.

Required for `--live` only:

```text
HINDSIGHT_API_KEY
HINDSIGHT_BANK_ID
```

Optional:

```text
HINDSIGHT_BASE_URL
SUPERMEMORY_PROMOTION_LOG_PATH
SUPERMEMORY_PROMOTION_MODE
```

Rules:

- dry-run must not require credentials;
- dry-run must not read or print secrets;
- live mode must fail closed if required env is missing;
- live self-hosted/local smoke should set `HINDSIGHT_BASE_URL` explicitly;
- cloud usage must be opt-in by setting `HINDSIGHT_BASE_URL=https://api.hindsight.vectorize.io` intentionally;
- logs must redact token-like values;
- `SUPERMEMORY_PROMOTION_MODE=live` may confirm intent, but the command still needs `--live`.

## Implementation Slices

### Slice 1: Local CLI Dry-Run

Goal: implement the CLI without network calls.

Allowed files:

- `scripts/hindsight-promote.mjs`
- `tests/hindsight-promote.test.mjs`
- `identity-vault/90_evals/cases/hindsight-runtime-preflight/` if a new runtime-preflight fixture is useful
- README or docs updates only for command usage

Behavior:

- parse input fixture;
- validate promotion payloads using the same hard invariants as the local adapter contract;
- output planned operations: `retain`, `upsert`, `delete`, `skip`;
- include trace ids that can feed answer evidence;
- prove `do_not_use` becomes delete/skip, not active retain;
- prove unpromoted raw LLM items are ignored.

Oracle:

```bash
node scripts/verify-hindsight-adapter-minimal.mjs
node --test tests/hindsight-promote.test.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

### Slice 2: Live-Mode Guard Without Live Call

Goal: add the safety gate for `--live`, still without performing live writes in CI.

Behavior:

- `--live` fails when required env is absent;
- `--live --dry-run` is invalid because modes are mutually exclusive;
- `--live` prints a redacted operation summary before execution;
- test coverage uses fake env values and a mock transport.

Oracle:

```bash
node --test tests/hindsight-promote.test.mjs
node scripts/verify-hindsight-adapter-minimal.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

### Slice 3: Transport Adapter Behind A Mockable Boundary

Goal: introduce a transport interface without binding tests to live Hindsight.

Behavior:

- isolate Hindsight API calls behind a small adapter module;
- map SuperMemory operations to transport calls only after local validation;
- mock transport in tests;
- keep live network disabled in CI unless explicitly requested outside the test suite.

Stop condition:

- if official Hindsight API docs are unavailable or unclear, stop and record the missing contract instead of guessing.

Oracle:

```bash
node --test tests/hindsight-promote.test.mjs
node scripts/verify-hindsight-adapter-minimal.mjs
node scripts/verify-governed-answer-evidence.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

### Slice 4: Optional Manual Live Smoke

Goal: run a non-CI live smoke only when the owner provides credentials and explicitly asks for it.

Runtime target:

- prefer self-hosted/local Hindsight for the first smoke;
- require explicit `HINDSIGHT_BASE_URL`, normally `http://127.0.0.1:8888`;
- do not use Hindsight Cloud unless the owner explicitly chooses that endpoint.

Behavior:

- promote one governed fixture document;
- recall with restrictive tags;
- delete or exclude one `do_not_use` document;
- write redacted operation evidence to a local ignored or explicitly approved log path.
- fail rather than silently switching endpoints if the configured local runtime is unavailable.

This slice is not required for the first merged implementation PR.

## Test Strategy

Red tests to create first:

- CLI dry-run fails on promotion missing source/snapshot/observation/interpretation/memory provenance.
- CLI dry-run fails on broad recall policy.
- CLI dry-run plans delete/skip for `do_not_use`, never active retain.
- CLI dry-run ignores unpromoted raw LLM conclusions.
- `--live` fails without `HINDSIGHT_API_KEY` and `HINDSIGHT_BANK_ID`.
- `--live` and `--dry-run` together fail.

Green behavior:

- valid fixture produces deterministic planned operations;
- dry-run requires no credentials;
- JSON output includes operation count, document ids, memory ids, trace ids, and redacted env status;
- fake transport receives expected calls only in live-mode tests with fake env.

Regression commands:

```bash
node scripts/verify-hindsight-adapter-minimal.mjs
node scripts/verify-governed-answer-evidence.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```

## No-Touch Boundaries

Do not modify in the first runtime preflight unless a new goal explicitly approves it:

- raw inbox sources under `identity-vault/00_inbox/`;
- compiled professional/personal/private memory notes;
- existing production-like logs in `identity-vault/80_logs/`;
- source capture connectors;
- source refresh jobs;
- Graphiti, Memoria, or other engine ports;
- CI secrets;
- package dependencies, unless the implementation goal separately proves the need.

## Acceptance Criteria For The Next Goal

The next implementation goal is ready when it can start from this command:

```text
/goal Follow docs/goals/runtime-preflight-vault-to-hindsight-implementation/goal.md.
```

It should be accepted only if:

- Slice 1 and Slice 2 are implemented and verified;
- no live network is required in CI;
- dry-run remains default;
- live mode is impossible without explicit opt-in and env;
- the next live smoke target is self-hosted/local by default, with cloud documented as an explicit alternative only;
- all existing T0-T14 checks remain green;
- the implementation does not claim full runtime readiness until an owner-approved live smoke has run.

## Recommended Next Implementation Goal

Title:

```text
Implement Runtime Preflight Vault-To-Hindsight Promotion
```

Initial Worker scope:

1. Add `scripts/hindsight-promote.mjs` with dry-run validation and operation planning.
2. Add `tests/hindsight-promote.test.mjs`.
3. Keep live transport unimplemented or mocked behind an explicit boundary.
4. Preserve all current contract verifiers.

Recommended first oracle:

```bash
node --test tests/hindsight-promote.test.mjs
node scripts/verify-hindsight-adapter-minimal.mjs
node scripts/verify-governed-answer-evidence.mjs
node scripts/verify-supermemory-specs.mjs
git diff --check
```
