#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/governed-answer-evidence");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(caseRoot, relativePath), "utf8"));
}

function list(input, key) {
  return Array.isArray(input?.[key]) ? input[key] : [];
}

function mapBy(items, key) {
  return new Map(items.map((item) => [item[key], item]).filter(([value]) => Boolean(value)));
}

function hasSupportsAnswerRelation(input, memoryId, answerId) {
  return list(input, "relations").some(
    (relation) =>
      relation.relation_type === "supports_answer" &&
      relation.from === memoryId &&
      relation.to === answerId
  );
}

function arrayIncludesAll(actual, required) {
  return required.every((value) => actual.includes(value));
}

function validateGovernedAnswers(input) {
  const errors = new Set();
  const memories = mapBy(list(input, "validated_memories"), "memory_id");
  const traceIds = new Set(list(input, "adapter_traces").map((trace) => trace.trace_id).filter(Boolean));

  for (const answer of list(input, "answer_evidence")) {
    checkForbiddenMemory(input, answer, memories, errors);
    if (errors.size > 0) continue;

    const usedMemories = (answer.used_memory_ids ?? []).map((memoryId) => memories.get(memoryId)).filter(Boolean);

    checkSupportsAnswer(input, answer, errors);
    checkRecallTrace(answer, traceIds, errors);
    checkCurrentAnswer(answer, usedMemories, errors);
    checkStaleAnswer(answer, usedMemories, errors);
    checkChangedAnswer(answer, usedMemories, errors);
    checkRestrictedAnswer(answer, usedMemories, errors);
  }

  return [...errors];
}

function checkForbiddenMemory(input, answer, memories, errors) {
  const forbiddenUsed = (answer.used_memory_ids ?? []).some((memoryId) => memories.get(memoryId)?.status === "do_not_use");
  const forbiddenRelation = list(input, "relations").some((relation) => {
    if (relation.relation_type !== "supports_answer" || relation.to !== answer.answer_id) return false;
    return memories.get(relation.from)?.status === "do_not_use";
  });

  if (forbiddenUsed || forbiddenRelation) {
    errors.add("forbidden_memory_used");
  }
}

function checkSupportsAnswer(input, answer, errors) {
  for (const memoryId of answer.used_memory_ids ?? []) {
    if (!hasSupportsAnswerRelation(input, memoryId, answer.answer_id)) {
      errors.add("missing_supports_answer_relation");
    }
  }
}

function checkRecallTrace(answer, traceIds, errors) {
  if (!answer.recall_backed) return;
  const adapterTraceIds = Array.isArray(answer.adapter_trace_ids) ? answer.adapter_trace_ids : [];
  if (adapterTraceIds.length === 0) {
    errors.add("answer_missing_adapter_trace");
    return;
  }
  if (traceIds.size > 0 && !adapterTraceIds.some((traceId) => traceIds.has(traceId))) {
    errors.add("answer_missing_adapter_trace");
  }
}

function checkCurrentAnswer(answer, usedMemories, errors) {
  if (answer.answer_state !== "current") return;

  const usedMemoryIds = Array.isArray(answer.used_memory_ids) ? answer.used_memory_ids : [];
  const usedDocumentIds = Array.isArray(answer.used_document_ids) ? answer.used_document_ids : [];
  const citedSnapshotIds = Array.isArray(answer.cited_snapshot_ids) ? answer.cited_snapshot_ids : [];
  const hasCurrentEvidence = usedMemoryIds.length > 0 && usedDocumentIds.length > 0 && citedSnapshotIds.length > 0;
  if (!hasCurrentEvidence) {
    errors.add("current_answer_missing_evidence");
    return;
  }

  for (const memory of usedMemories) {
    if (memory.freshness === "stale") {
      errors.add("stale_answer_claims_current");
      continue;
    }
    if (memory.freshness === "changed" || memory.status === "needs_review") {
      errors.add("changed_memory_used_for_guidance");
      continue;
    }
    if (memory.sensitivity === "restricted") {
      errors.add("restricted_answer_missing_withheld_fields");
      continue;
    }
    if (memory.snapshot_id && !citedSnapshotIds.includes(memory.snapshot_id)) {
      errors.add("current_answer_missing_evidence");
    }
  }
}

function checkStaleAnswer(answer, usedMemories, errors) {
  const usesStaleMemory = usedMemories.some((memory) => memory.freshness === "stale");
  if (!usesStaleMemory) return;

  if (answer.answer_state === "current") {
    errors.add("stale_answer_claims_current");
    return;
  }

  if (answer.answer_state === "stale") {
    const lastKnownSnapshotIds = Array.isArray(answer.last_known_snapshot_ids) ? answer.last_known_snapshot_ids : [];
    const citedSnapshotIds = Array.isArray(answer.cited_snapshot_ids) ? answer.cited_snapshot_ids : [];
    if (lastKnownSnapshotIds.length === 0 && citedSnapshotIds.length === 0 && !answer.review_required) {
      errors.add("stale_answer_claims_current");
    }
  }
}

function checkChangedAnswer(answer, usedMemories, errors) {
  const usesChangedMemory = usedMemories.some(
    (memory) => memory.freshness === "changed" || memory.status === "needs_review"
  );
  if (!usesChangedMemory) return;

  if (
    answer.answer_state !== "changed_needs_review" ||
    answer.review_required !== true ||
    answer.operational_guidance_allowed !== false
  ) {
    errors.add("changed_memory_used_for_guidance");
  }
}

function checkRestrictedAnswer(answer, usedMemories, errors) {
  const restrictedFields = usedMemories.flatMap((memory) =>
    Array.isArray(memory.restricted_fields) ? memory.restricted_fields : []
  );
  const usesRestrictedMemory = usedMemories.some((memory) => memory.sensitivity === "restricted") || restrictedFields.length > 0;
  if (!usesRestrictedMemory) return;

  const withheldFields = Array.isArray(answer.withheld_fields) ? answer.withheld_fields : [];
  if (
    answer.answer_state !== "restricted" ||
    !answer.allowed_summary ||
    withheldFields.length === 0 ||
    !arrayIncludesAll(withheldFields, restrictedFields)
  ) {
    errors.add("restricted_answer_missing_withheld_fields");
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const expected = readJson("expected/answer-evidence.json");
  const answers = list(fixture.valid, "answer_evidence");
  const answersById = mapBy(answers, "answer_id");

  for (const answerId of assertions.required_answer_ids ?? []) {
    if (!answersById.has(answerId)) {
      fail(`missing required answer: ${answerId}`);
    }
  }

  for (const expectedAnswer of expected.answers ?? []) {
    const actual = answersById.get(expectedAnswer.answer_id);
    if (!actual) {
      fail(`missing expected answer evidence: ${expectedAnswer.answer_id}`);
      continue;
    }
    for (const [key, expectedValue] of Object.entries(expectedAnswer)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expectedValue)) {
        fail(`${expectedAnswer.answer_id} ${key} mismatch`);
      }
    }
  }

  const current = answersById.get(assertions.required_current_answer_id);
  if (!current || current.answer_state !== "current") {
    fail("required current answer is missing or not current");
  }

  const restricted = answersById.get(assertions.required_restricted_answer_id);
  if (!restricted || !Array.isArray(restricted.withheld_fields) || restricted.withheld_fields.length === 0) {
    fail("required restricted answer is missing withheld_fields");
  }

  const forbidden = answersById.get(assertions.required_forbidden_answer_id);
  if (!forbidden || forbidden.answer_state !== "forbidden" || (forbidden.used_memory_ids ?? []).length > 0) {
    fail("required forbidden answer must refuse without used memory");
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
  const errors = validateGovernedAnswers(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateGovernedAnswers(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: governed answer evidence contract is valid`);
}
