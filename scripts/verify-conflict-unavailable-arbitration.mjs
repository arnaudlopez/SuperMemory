#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/conflict-unavailable-arbitration");

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

function relationExists(input, from, to, type = "conflicts_with") {
  return list(input, "relations").some(
    (relation) => relation.relation_type === type && relation.from === from && relation.to === to
  );
}

function hasConflictRelations(input, conflictIds) {
  if (conflictIds.length < 2) return false;
  return relationExists(input, conflictIds[0], conflictIds[1]) && relationExists(input, conflictIds[1], conflictIds[0]);
}

function validateConflictUnavailable(input) {
  const errors = new Set();
  const memories = mapBy(list(input, "validated_memories"), "memory_id");
  const rules = mapBy(list(input, "source_reliability_rules"), "rule_id");

  for (const answer of list(input, "answer_evidence")) {
    const conflictIds = Array.isArray(answer.conflict_memory_ids) ? answer.conflict_memory_ids : [];
    const hasConflict = conflictIds.length >= 2;

    if (hasConflict && !hasConflictRelations(input, conflictIds)) {
      errors.add("missing_conflicts_with_relation");
      continue;
    }

    if (hasConflict && answer.selected_memory_id && !answer.arbitration_rule_id) {
      errors.add("silent_arbitration_without_rule");
      continue;
    }

    if (answer.arbitration_rule_id) {
      const rule = rules.get(answer.arbitration_rule_id);
      const citesConflict = conflictIds.length >= 2 && (answer.used_memory_ids ?? []).some((id) => conflictIds.includes(id));
      if (!rule || !citesConflict || !answer.selected_memory_id || !conflictIds.includes(answer.selected_memory_id)) {
        errors.add("arbitration_missing_rule_or_conflict");
        continue;
      }
    }

    const usesUnavailable = (answer.used_memory_ids ?? []).some((memoryId) => {
      const memory = memories.get(memoryId);
      return memory?.freshness === "unavailable" || memory?.status === "unavailable";
    });
    if (usesUnavailable && answer.answer_state === "current") {
      errors.add("unavailable_answer_claims_current");
      continue;
    }

    if (answer.answer_state === "conflicting") {
      const reviewExists = list(input, "review_items").some((review) => {
        if (review.queue !== "conflict_queue") return false;
        const reviewConflictIds = Array.isArray(review.conflict_memory_ids) ? review.conflict_memory_ids : [];
        return conflictIds.every((id) => reviewConflictIds.includes(id));
      });
      if (!reviewExists) {
        errors.add("missing_conflict_queue_item");
      }
    }
  }

  for (const check of list(input, "source_checks")) {
    if (check.result === "unavailable" && check.freshness_after_check === "fresh") {
      errors.add("unavailable_answer_claims_current");
    }
  }

  return [...errors];
}

function verifyExpectedOutputs(fixture, assertions) {
  const expected = readJson("expected/answer-evidence.json");
  const valid = fixture.valid;
  const answers = mapBy(list(valid, "answer_evidence"), "answer_id");

  for (const id of assertions.required_conflict_memory_ids ?? []) {
    if (!list(valid, "validated_memories").some((memory) => memory.memory_id === id)) {
      fail(`missing required conflict memory: ${id}`);
    }
  }

  if (!hasConflictRelations(valid, assertions.required_conflict_memory_ids ?? [])) {
    fail("valid case missing bidirectional conflicts_with relation");
  }

  const review = list(valid, "review_items").find((item) => item.review_id === assertions.required_review_id);
  if (!review || review.queue !== "conflict_queue") {
    fail(`missing conflict queue review: ${assertions.required_review_id}`);
  }

  for (const expectedAnswer of expected.answers ?? []) {
    const actual = answers.get(expectedAnswer.answer_id);
    if (!actual) {
      fail(`missing expected answer: ${expectedAnswer.answer_id}`);
      continue;
    }
    for (const [key, expectedValue] of Object.entries(expectedAnswer)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expectedValue)) {
        fail(`${expectedAnswer.answer_id} ${key} mismatch`);
      }
    }
  }

  const arbitrated = answers.get(assertions.required_arbitrated_answer_id);
  if (!arbitrated || arbitrated.arbitration_rule_id !== assertions.required_rule_id) {
    fail("arbitrated answer missing required rule");
  }

  const unavailable = answers.get(assertions.required_unavailable_answer_id);
  if (!unavailable || unavailable.answer_state !== "unavailable") {
    fail("unavailable answer state mismatch");
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
  const errors = validateConflictUnavailable(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateConflictUnavailable(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: conflict unavailable arbitration contract is valid`);
}
