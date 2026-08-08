#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/m1-hindsight-promotion-recall");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(caseRoot, relativePath), "utf8"));
}

function validateM1(input) {
  const errors = new Set();

  checkSourcesHaveSnapshots(input, errors);
  checkObservations(input, errors);
  checkInterpretationCandidates(input, errors);
  checkValidatedMemories(input, errors);
  checkPromotionPayloads(input, errors);
  checkAnswerEvidence(input, errors);

  return [...errors];
}

function list(input, key) {
  return Array.isArray(input?.[key]) ? input[key] : [];
}

const knownUsePatterns = new Set([
  "external_draft",
  "internal_draft",
  "decision_support",
  "interaction_brief",
  "strategic_analysis",
  "audit_and_proof",
  "external_system_update"
]);

function checkSourcesHaveSnapshots(input, errors) {
  const snapshotIds = new Set(list(input, "snapshots").map((snapshot) => snapshot.snapshot_id).filter(Boolean));

  for (const source of list(input, "sources")) {
    if (source.status === "active" && (!source.active_snapshot_id || !snapshotIds.has(source.active_snapshot_id))) {
      errors.add("source_without_snapshot");
    }
  }
}

function checkObservations(input, errors) {
  for (const observation of list(input, "observations")) {
    if (!observation.snapshot_id) {
      errors.add("observation_without_snapshot_id");
    }
  }
}

function checkInterpretationCandidates(input, errors) {
  for (const interpretation of list(input, "interpretation_candidates")) {
    const evidenceRefs = Array.isArray(interpretation.evidence_refs) ? interpretation.evidence_refs : [];
    const proposedFrom = Array.isArray(interpretation.proposed_from) ? interpretation.proposed_from : [];
    const hasEvidence = evidenceRefs.length > 0 || proposedFrom.length > 0;
    if (!hasEvidence) {
      errors.add("interpretation_without_evidence");
    }
    if (!interpretation.confidence) {
      errors.add("interpretation_without_confidence");
    }
    if (typeof interpretation.uncertainty !== "string") {
      errors.add("interpretation_without_uncertainty");
    }
    if (!knownUsePatterns.has(interpretation.use_pattern)) {
      errors.add("interpretation_unknown_use_pattern");
    }
  }
}

function checkValidatedMemories(input, errors) {
  const interpretationsById = new Map(
    list(input, "interpretation_candidates")
      .map((interpretation) => [interpretation.interpretation_id, interpretation])
      .filter(([interpretationId]) => Boolean(interpretationId))
  );

  for (const memory of list(input, "validated_memories")) {
    const derivesFrom = Array.isArray(memory.derives_from) ? memory.derives_from : [];
    if (memory.status === "active" && derivesFrom.length === 0) {
      errors.add("memory_without_derives_from");
    }
    if (
      memory.status === "active" &&
      derivesFrom.some((id) => {
        const interpretation = interpretationsById.get(id);
        return interpretation && !(
          interpretation.review_status === "approved" ||
          (
            ["auto_activate", "activate_ttl"].includes(interpretation.admission_decision) &&
            interpretation.admission_id &&
            interpretation.admission_policy_version &&
            interpretation.verifier?.independent === true
          )
        );
      })
    ) {
      errors.add("interpretation_not_reviewed_for_active_memory");
    }
  }
}

function checkPromotionPayloads(input, errors) {
  const doNotUseMemoryIds = new Set(
    list(input, "validated_memories")
      .filter((memory) => memory.status === "do_not_use")
      .map((memory) => memory.memory_id)
      .filter(Boolean)
  );
  const doNotUseDocumentIds = new Set(
    list(input, "validated_memories")
      .filter((memory) => memory.status === "do_not_use")
      .map((memory) => memory.document_id)
      .filter(Boolean)
  );

  for (const payload of list(input, "promotion_payloads")) {
    if (payload.status !== "active") continue;
    if (doNotUseMemoryIds.has(payload.memory_id) || doNotUseDocumentIds.has(payload.document_id)) {
      errors.add("do_not_use_promoted");
      continue;
    }

    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    const metadata = payload.metadata ?? {};
    const hasBaseProvenance =
      Boolean(metadata.source_id) &&
      Boolean(metadata.snapshot_id) &&
      Boolean(metadata.observation_id) &&
      Boolean(metadata.memory_id);

    if (!payload.document_id || tags.length === 0 || !hasBaseProvenance) {
      errors.add("incomplete_promotion_payload");
    } else if (!metadata.interpretation_id) {
      errors.add("promotion_missing_interpretation_provenance");
    } else if (
      metadata.review_status === "admitted" &&
      (
        !metadata.admission_id ||
        !["auto_activate", "activate_ttl"].includes(metadata.admission_decision) ||
        !metadata.admission_policy_version
      )
    ) {
      errors.add("promotion_missing_admission");
    }
  }
}

function checkAnswerEvidence(input, errors) {
  const activeSnapshotIds = new Set(
    list(input, "sources")
      .filter((source) => source.status === "active")
      .map((source) => source.active_snapshot_id)
      .filter(Boolean)
  );

  for (const evidence of list(input, "answer_evidence")) {
    if (evidence.answer_state !== "current") continue;
    const citedSnapshotIds = Array.isArray(evidence.cited_snapshot_ids) ? evidence.cited_snapshot_ids : [];
    const citesActiveSnapshot = [...activeSnapshotIds].some((snapshotId) => citedSnapshotIds.includes(snapshotId));
    if (activeSnapshotIds.size > 0 && !citesActiveSnapshot) {
      errors.add("answer_missing_active_snapshot");
    }
  }
}

function requireEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(message);
  }
}

function requireIncludesAll(actualValues, requiredValues, message) {
  for (const requiredValue of requiredValues) {
    if (!actualValues.includes(requiredValue)) {
      fail(`${message}: ${requiredValue}`);
    }
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const finalState = readJson("expected/final-state.json");
  const promotionPayload = readJson("expected/promotion-payload.json");
  const answerEvidence = readJson("expected/answer-evidence.json");
  const valid = fixture.valid;

  const source = list(valid, "sources").find((item) => item.source_id === finalState.source_id);
  const snapshot = list(valid, "snapshots").find((item) => item.snapshot_id === finalState.snapshot_id);
  const observation = list(valid, "observations").find((item) => item.observation_id === finalState.observation_id);
  const interpretation = list(valid, "interpretation_candidates").find(
    (item) => item.interpretation_id === finalState.interpretation_id
  );
  const memory = list(valid, "validated_memories").find((item) => item.memory_id === finalState.memory_id);
  const payload = list(valid, "promotion_payloads").find((item) => item.document_id === finalState.document_id);
  const evidence = list(valid, "answer_evidence").find((item) => item.answer_id === answerEvidence.answer_id);

  if (!source || !snapshot || !observation || !interpretation || !memory || !payload || !evidence) {
    fail("valid case does not contain the complete M1 chain");
    return;
  }

  requireEqual(finalState.chain, assertions.required_chain, "final-state chain mismatch");
  requireEqual(source.active_snapshot_id, finalState.snapshot_id, "source active snapshot mismatch");
  requireEqual(observation.snapshot_id, finalState.snapshot_id, "observation snapshot mismatch");
  requireIncludesAll(
    interpretation.evidence_refs ?? [],
    [finalState.observation_id],
    "interpretation evidence missing observation"
  );
  requireEqual(interpretation.use_pattern, assertions.required_use_pattern, "interpretation use_pattern mismatch");
  requireIncludesAll(
    memory.derives_from ?? [],
    [finalState.interpretation_id],
    "memory derives_from missing interpretation"
  );

  const interpretsRelation = list(valid, "relations").find(
    (relation) =>
      relation.relation_type === "interprets_observation" &&
      relation.from === finalState.interpretation_id &&
      relation.to === finalState.observation_id
  );
  if (!interpretsRelation) {
    fail("missing interprets_observation relation from interpretation to observation");
  }

  const derivesRelation = list(valid, "relations").find(
    (relation) =>
      relation.relation_type === "derives_from" &&
      relation.from === finalState.memory_id &&
      relation.to === finalState.interpretation_id
  );
  if (!derivesRelation) {
    fail("missing derives_from relation from memory to interpretation");
  }

  requireEqual(payload.document_id, promotionPayload.document_id, "promotion document_id mismatch");
  requireIncludesAll(payload.tags ?? [], assertions.required_tags ?? [], "promotion payload missing tag");
  requireEqual(payload.metadata?.source_id, promotionPayload.metadata.source_id, "promotion metadata source_id mismatch");
  requireEqual(payload.metadata?.snapshot_id, promotionPayload.metadata.snapshot_id, "promotion metadata snapshot_id mismatch");
  requireEqual(
    payload.metadata?.observation_id,
    promotionPayload.metadata.observation_id,
    "promotion metadata observation_id mismatch"
  );
  requireEqual(
    payload.metadata?.interpretation_id,
    promotionPayload.metadata.interpretation_id,
    "promotion metadata interpretation_id mismatch"
  );
  requireEqual(payload.metadata?.memory_id, promotionPayload.metadata.memory_id, "promotion metadata memory_id mismatch");

  const activeDocumentIds = list(valid, "promotion_payloads")
    .filter((item) => item.status === "active")
    .map((item) => item.document_id);
  for (const forbiddenDocumentId of assertions.forbidden_document_ids ?? []) {
    if (activeDocumentIds.includes(forbiddenDocumentId)) {
      fail(`forbidden document promoted: ${forbiddenDocumentId}`);
    }
  }

  requireIncludesAll(evidence.used_memory_ids ?? [], answerEvidence.used_memory_ids ?? [], "answer evidence missing memory");
  requireIncludesAll(
    evidence.cited_snapshot_ids ?? [],
    [assertions.required_active_snapshot_id],
    "answer evidence missing active snapshot"
  );

  for (const interpretationId of assertions.required_equivalent_interpretation_ids ?? []) {
    const equivalent = list(fixture, "equivalent_valid_interpretations").find(
      (item) => item.interpretation_id === interpretationId
    );
    if (!equivalent) {
      fail(`missing equivalent interpretation: ${interpretationId}`);
      continue;
    }
    const equivalentErrors = validateM1({ interpretation_candidates: [equivalent] });
    if (equivalentErrors.length > 0) {
      fail(`equivalent interpretation ${interpretationId} failed: ${equivalentErrors.join(",")}`);
    }
    requireIncludesAll(
      equivalent.evidence_refs ?? [],
      [finalState.observation_id],
      "equivalent interpretation evidence missing observation"
    );
    requireEqual(equivalent.use_pattern, assertions.required_use_pattern, "equivalent interpretation use_pattern mismatch");
    if (equivalent.claim === interpretation.claim) {
      fail(`equivalent interpretation ${interpretationId} must use different wording`);
    }
  }
}

const fixture = readJson("input/fixture.json");
const assertions = readJson("expected/assertions.json");

for (const testId of assertions.required_test_ids ?? []) {
  const invalidCase = fixture.invalid_cases?.find((item) => item.id === testId);
  if (!invalidCase) {
    fail(`missing invalid case ${testId}`);
    continue;
  }
  if (invalidCase.expected_error !== assertions.expected_errors?.[testId]) {
    fail(`${testId} expected_error mismatch`);
  }
}

for (const invalidCase of fixture.invalid_cases ?? []) {
  const errors = validateM1(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateM1(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: M1 promotion recall fixture is valid`);
}
