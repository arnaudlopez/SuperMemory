#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/adaptive-business-types");

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

function hasTag(values, tag) {
  return Array.isArray(values) && values.includes(tag);
}

function validateAdaptiveTypes(input) {
  const errors = new Set();
  const sources = mapBy(list(input, "captured_sources"), "source_id");

  const t0MarketingStrategy = list(input, "type_registry_t0").find((item) => item.type === "marketing_strategy");
  if (t0MarketingStrategy?.active || ["experimental", "stable"].includes(t0MarketingStrategy?.status)) {
    errors.add("marketing_strategy_active_at_t0");
  }

  for (const proposal of list(input, "type_queue")) {
    if (proposal.type !== "marketing_strategy") continue;
    const hasSource = proposal.trigger_source_id && sources.has(proposal.trigger_source_id);
    const hasDefinition =
      Array.isArray(proposal.minimal_fields) &&
      proposal.minimal_fields.length > 0 &&
      typeof proposal.why_existing_types_are_insufficient === "string" &&
      proposal.why_existing_types_are_insufficient.length > 0;
    if (!hasSource || !hasDefinition) {
      errors.add("type_proposal_without_source");
    }
  }

  for (const check of list(input, "promotion_checks")) {
    if (
      check.entity_type === "marketing_strategy" &&
      check.schema_status === "candidate" &&
      check.requested_status === "active" &&
      check.decision !== "rejected"
    ) {
      errors.add("candidate_type_not_promotable");
    }
  }

  for (const request of list(input, "recall_requests")) {
    if (request.entity_type !== "marketing_strategy" || request.schema_status !== "experimental") continue;
    if (!hasTag(request.filters, "entity_type:marketing_strategy") || !hasTag(request.filters, "schema_status:experimental")) {
      errors.add("experimental_recall_missing_schema_filter");
    }
  }

  for (const request of list(input, "stable_transition_requests")) {
    if (request.entity_type !== "marketing_strategy" || request.to_status !== "stable") continue;
    const hasSource = Array.isArray(request.source_ids) && request.source_ids.length > 0;
    const hasEval = Array.isArray(request.eval_ids) && request.eval_ids.length > 0;
    if ((!hasSource || !hasEval) && request.decision !== "rejected") {
      errors.add("stable_promotion_missing_evidence");
    }
  }

  return [...errors];
}

function verifyExpectedOutputs(fixture, assertions) {
  const expected = readJson("expected/answer-evidence.json");
  const valid = fixture.valid;
  const answers = mapBy(list(valid, "answer_evidence"), "answer_id");
  const t0Types = list(valid, "type_registry_t0");
  const t1Types = list(valid, "type_registry_t1");

  const t0MarketingStrategy = t0Types.find((item) => item.type === assertions.required_type);
  if (!t0MarketingStrategy || t0MarketingStrategy.active || t0MarketingStrategy.status !== "candidate") {
    fail("valid case must keep marketing_strategy inactive candidate/example at t0");
  }

  const t1MarketingStrategy = t1Types.find((item) => item.type === assertions.required_type);
  if (!t1MarketingStrategy || t1MarketingStrategy.status !== "experimental" || !t1MarketingStrategy.active) {
    fail("valid case must make marketing_strategy active experimental at t1");
  }

  if (!list(valid, "captured_sources").some((source) => source.source_id === assertions.required_source_id)) {
    fail(`missing required source: ${assertions.required_source_id}`);
  }

  const proposal = list(valid, "type_queue").find((item) => item.proposal_id === assertions.required_proposal_id);
  if (!proposal || proposal.trigger_source_id !== assertions.required_source_id) {
    fail(`missing source-backed proposal: ${assertions.required_proposal_id}`);
  }

  const candidateCheck = list(valid, "promotion_checks").find(
    (check) => check.schema_status === "candidate" && check.entity_type === assertions.required_type
  );
  if (!candidateCheck || candidateCheck.decision !== "rejected") {
    fail("valid case must reject candidate promotion");
  }

  const recall = list(valid, "recall_requests").find((item) => item.request_id === assertions.required_recall_request_id);
  if (!recall || !hasTag(recall.filters, "schema_status:experimental")) {
    fail(`missing bounded experimental recall: ${assertions.required_recall_request_id}`);
  }

  const stableRequest = list(valid, "stable_transition_requests").find(
    (item) => item.request_id === assertions.required_rejected_stable_request_id
  );
  if (!stableRequest || stableRequest.decision !== "rejected") {
    fail("valid case must reject stable transition without eval evidence");
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
  const errors = validateAdaptiveTypes(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateAdaptiveTypes(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: adaptive business types contract is valid`);
}
