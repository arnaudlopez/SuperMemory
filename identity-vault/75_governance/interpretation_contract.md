# Interpretation Contract

SuperMemory is LLM-first for interpretation and deterministic for governance.

The memory agent or LLM may read unfamiliar source formats, infer likely meaning, compare alternatives, and adapt to a request that was not anticipated by a fixture. The deterministic verifier does not try to encode that understanding. It checks whether the proposed interpretation is safe to advance.

## Boundary

LLM responsibilities:

- extract candidate meaning from observations;
- identify the use pattern the interpretation serves;
- state confidence, uncertainty, assumptions, and alternatives;
- decide whether review is needed before promotion;
- propose a memory candidate or answer state.

Deterministic responsibilities:

- require source-backed evidence;
- require explicit uncertainty and confidence;
- require a known use pattern;
- require review routing for blocking ambiguity;
- reject active promotion when proof, freshness, access, status, or `do_not_use` gates fail;
- preserve the audit chain from snapshot to answer.

## InterpretationCandidate

Required shape:

```yaml
interpretation_id: <stable id>
proposed_from: [<observation ids>]
claim: <proposed meaning>
confidence: <high|medium|low>
uncertainty: <known uncertainty or none>
assumptions: [<assumptions>]
alternative_interpretations: [<other plausible readings>]
use_pattern: <pattern from 75_governance/use_patterns.md>
review_status: <approved|needs_review|rejected>
evidence_refs: [<observation ids or snapshot ids>]
```

## Rule

A verifier may reject an interpretation for missing evidence, missing uncertainty, missing confidence, unknown use pattern, or unsafe review state. It should not require one exact wording when multiple source-backed interpretations satisfy the same governance contract.
