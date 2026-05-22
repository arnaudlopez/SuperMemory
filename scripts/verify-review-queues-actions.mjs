#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/review-queues-actions");

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

function hasValue(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function includesAll(actual, required) {
  return required.every((item) => actual.includes(item));
}

function relationExists(input, from, to, type = "conflicts_with") {
  return list(input, "relations").some(
    (relation) => relation.relation_type === type && relation.from === from && relation.to === to
  );
}

function queueItems(input, queue) {
  return list(input, "review_items").filter((item) => item.queue === queue);
}

function isOpenQueueItem(item) {
  return Boolean(item) && hasValue(item.owner) && hasValue(item.blocker) && hasValue(item.required_decision);
}

function validateReviewQueuesActions(input) {
  const errors = new Set();

  checkStalenessQueue(input, errors);
  checkConflictQueue(input, errors);
  checkTypeQueue(input, errors);
  checkPermissionQueue(input, errors);
  checkActionConfirmationQueue(input, errors);

  return [...errors];
}

function checkStalenessQueue(input, errors) {
  const changedSources = list(input, "sources").filter(
    (source) => source.status === "changed" || source.freshness === "changed"
  );
  for (const source of changedSources) {
    const affectedMemories = list(input, "validated_memories").filter(
      (memory) =>
        memory.source_id === source.source_id &&
        (memory.status === "needs_review" || memory.freshness === "changed")
    );
    if (affectedMemories.length === 0) continue;

    const review = queueItems(input, "staleness_queue").find((item) => {
      const affectedIds = Array.isArray(item.affected_memory_ids) ? item.affected_memory_ids : [];
      return (
        isOpenQueueItem(item) &&
        item.source_id === source.source_id &&
        item.old_snapshot_id === source.previous_snapshot_id &&
        item.new_snapshot_id === source.active_snapshot_id &&
        affectedMemories.every((memory) => affectedIds.includes(memory.memory_id))
      );
    });

    if (!review) errors.add("missing_staleness_queue_item");
  }
}

function checkConflictQueue(input, errors) {
  for (const answer of list(input, "answer_evidence")) {
    if (answer.answer_state !== "conflicting") continue;
    const conflictIds = Array.isArray(answer.conflict_memory_ids) ? answer.conflict_memory_ids : [];
    if (conflictIds.length < 2) {
      errors.add("missing_conflict_queue_item");
      continue;
    }
    if (!relationExists(input, conflictIds[0], conflictIds[1]) || !relationExists(input, conflictIds[1], conflictIds[0])) {
      errors.add("missing_conflict_queue_item");
      continue;
    }
    const review = queueItems(input, "conflict_queue").find((item) => {
      const reviewIds = Array.isArray(item.conflict_memory_ids) ? item.conflict_memory_ids : [];
      return isOpenQueueItem(item) && conflictIds.every((id) => reviewIds.includes(id));
    });
    if (!review) errors.add("missing_conflict_queue_item");
  }
}

function checkTypeQueue(input, errors) {
  for (const proposal of list(input, "type_queue")) {
    if (proposal.queue !== "type_queue" || proposal.status !== "open") continue;
    if (
      !hasValue(proposal.proposal_id) ||
      !hasValue(proposal.proposed_type) ||
      !hasValue(proposal.trigger_source_id) ||
      !hasValue(proposal.owner) ||
      !hasValue(proposal.blocker) ||
      !hasValue(proposal.required_decision)
    ) {
      errors.add("missing_type_queue_item");
    }
  }
}

function checkPermissionQueue(input, errors) {
  const restrictedAnswers = list(input, "answer_evidence").filter(
    (answer) => answer.answer_state === "permission_review_required"
  );
  for (const answer of restrictedAnswers) {
    const withheldFields = Array.isArray(answer.withheld_fields) ? answer.withheld_fields : [];
    const revealedValues = Array.isArray(answer.revealed_values) ? answer.revealed_values : [];
    const review = queueItems(input, "permission_queue").find(
      (item) => isOpenQueueItem(item) && item.request_id === answer.request_id && Array.isArray(item.restricted_fields)
    );
    if (!review || withheldFields.length === 0 || revealedValues.length > 0) {
      errors.add("missing_permission_queue_item");
    }
  }
}

function checkActionConfirmationQueue(input, errors) {
  for (const action of list(input, "external_actions")) {
    if (action.action_type !== "email_send") continue;
    const review = queueItems(input, "action_confirmation_queue").find(
      (item) =>
        isOpenQueueItem(item) &&
        item.action_id === action.action_id &&
        item.status === "needs_confirmation" &&
        item.external_action === action.action_type
    );
    if (!review || action.execution_state !== "not_executed" || action.confirmation_review_id !== review.review_id) {
      errors.add("missing_action_confirmation_queue_item");
    }
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const expected = readJson("expected/answer-evidence.json");
  const valid = fixture.valid;
  const answers = mapBy(list(valid, "answer_evidence"), "answer_id");
  const actions = mapBy(list(valid, "external_actions"), "action_id");
  const reviews = mapBy(list(valid, "review_items"), "review_id");
  const proposals = mapBy(list(valid, "type_queue"), "proposal_id");

  for (const reviewId of [
    assertions.required_staleness_review_id,
    assertions.required_conflict_review_id,
    assertions.required_permission_review_id,
    assertions.required_confirmation_review_id
  ]) {
    if (!reviews.has(reviewId)) fail(`missing required review item: ${reviewId}`);
  }

  if (!proposals.has(assertions.required_type_proposal_id)) {
    fail(`missing required type proposal: ${assertions.required_type_proposal_id}`);
  }

  const confirmation = reviews.get(assertions.required_confirmation_review_id);
  const action = actions.get(assertions.required_external_action_id);
  if (!action || action.execution_state !== "not_executed" || action.confirmation_review_id !== confirmation?.review_id) {
    fail("required external action must remain unexecuted and linked to confirmation queue");
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

  for (const expectedAction of expected.external_actions ?? []) {
    const actual = actions.get(expectedAction.action_id);
    if (!actual) {
      fail(`missing expected action: ${expectedAction.action_id}`);
      continue;
    }
    for (const [key, expectedValue] of Object.entries(expectedAction)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expectedValue)) {
        fail(`${expectedAction.action_id} ${key} mismatch`);
      }
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
  const errors = validateReviewQueuesActions(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateReviewQueuesActions(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: review queues actions contract is valid`);
}
