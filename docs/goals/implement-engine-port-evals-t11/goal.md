# T11 Engine Port Evals

## Original Request

# Goal: Implement T11 Engine Port Evals

## Outcome

Implement the executable T11 contract proving that Graphiti, Memoria, and other engines remain governed optional ports instead of implicit dependencies.

## Oracle

The goal is complete when `node scripts/verify-engine-port-evals.mjs` is wired into `node scripts/verify-supermemory-specs.mjs`, proves T11.1-T11.4, all prior T0-T10 specs remain green, docs are aligned, and the work is committed and pushed.

## Non-Goals

- Do not install Graphiti.
- Do not install Memoria.
- Do not add runtime engine adapters, package dependencies, hosted services, databases, or migrations.
- Do not replace Hindsight as the default engine.
- Do not make any port the source of truth for permissions, freshness, revocation, or agent contracts.
- Do not weaken T0-T10 contracts.

## Command

```bash
node scripts/verify-engine-port-evals.mjs
```

## Ready Mode Instruction

Use this goal as a implementation Ready Mode run.

LLM first principle: the free-form conversation already did the exploration work. This board starts only after the owner says the spec is mature enough to freeze into proof.

1. Clarify the design concept and domain language before implementation.
2. Turn the desired end state into observable acceptance tests or equivalent proof.
3. Follow the board policy for red tests before production code.
4. Complete the largest safe useful slice inside approved boundaries.
5. Verify, review, commit, push, and finish only when the oracle is true.

## Oracle

A T11 verifier is wired into node scripts/verify-supermemory-specs.mjs and proves engine ports remain governed optional ports while T0-T10 remain green.

## Files

- `state.yaml`: GoalBuddy board state.
- `acceptance-contract.md`: initial owner-facing acceptance contract to refine during T001/T002.
