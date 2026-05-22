#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/agent-use-patterns");

const knownUsePatterns = new Set([
  "external_draft",
  "internal_draft",
  "decision_support",
  "interaction_brief",
  "strategic_analysis",
  "audit_and_proof",
  "external_system_update"
]);

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

function hasAny(values) {
  return Array.isArray(values) && values.length > 0;
}

function validateAgentUsePatterns(input) {
  const errors = new Set();

  for (const assignment of list(input, "use_pattern_assignments")) {
    if (!knownUsePatterns.has(assignment.use_pattern)) {
      errors.add("unknown_use_pattern");
      continue;
    }
    if (!hasAny(assignment.evidence_refs)) {
      errors.add("missing_evidence_refs");
      continue;
    }

    if (assignment.use_pattern === "external_draft") checkExternalDraft(assignment, errors);
    if (assignment.use_pattern === "internal_draft") checkInternalDraft(assignment, errors);
    if (assignment.use_pattern === "decision_support") checkDecisionSupport(assignment, errors);
    if (assignment.use_pattern === "strategic_analysis") checkStrategicAnalysis(assignment, errors);
    if (assignment.use_pattern === "audit_and_proof") checkAuditAndProof(assignment, errors);
    if (assignment.use_pattern === "external_system_update") checkExternalSystemUpdate(assignment, errors);
  }

  return [...errors];
}

function checkExternalDraft(assignment, errors) {
  if (
    !hasTag(assignment.allowed_filters, "consumer:email_agent") ||
    !hasTag(assignment.allowed_filters, "status:active") ||
    assignment.output_state !== "draft_only" ||
    assignment.external_action_executed !== false
  ) {
    errors.add("missing_pattern_filters");
  }
}

function checkInternalDraft(assignment, errors) {
  if (assignment.review_gate?.queue !== "staleness_queue" || !assignment.review_gate?.review_id) {
    errors.add("missing_review_gate");
  }
}

function checkDecisionSupport(assignment, errors) {
  if (!hasAny(assignment.snapshot_ids)) {
    errors.add("missing_snapshot_citation");
  }
}

function checkStrategicAnalysis(assignment, errors) {
  if (
    assignment.entity_type !== "marketing_strategy" ||
    assignment.schema_status !== "experimental" ||
    !hasTag(assignment.allowed_filters, "schema_status:experimental")
  ) {
    errors.add("missing_experimental_type_status");
  }
}

function checkAuditAndProof(assignment, errors) {
  if (!hasAny(assignment.snapshot_ids) || !hasAny(assignment.relation_chain)) {
    errors.add("missing_audit_relation_chain");
  }
}

function checkExternalSystemUpdate(assignment, errors) {
  if (
    assignment.confirmation_gate?.queue !== "action_confirmation_queue" ||
    !assignment.confirmation_gate?.review_id ||
    assignment.external_action?.execution_state !== "not_executed"
  ) {
    errors.add("missing_action_confirmation");
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const expected = readJson("expected/answer-evidence.json");
  const valid = fixture.valid;
  const assignments = mapBy(list(valid, "use_pattern_assignments"), "assignment_id");
  const patterns = new Set(list(valid, "use_pattern_assignments").map((item) => item.use_pattern));

  for (const pattern of assertions.required_patterns ?? []) {
    if (!patterns.has(pattern)) fail(`missing required use pattern: ${pattern}`);
  }

  for (const assignmentId of assertions.required_assignment_ids ?? []) {
    if (!assignments.has(assignmentId)) fail(`missing required assignment: ${assignmentId}`);
  }

  for (const expectedAssignment of expected.assignments ?? []) {
    const actual = assignments.get(expectedAssignment.assignment_id);
    if (!actual) {
      fail(`missing expected assignment: ${expectedAssignment.assignment_id}`);
      continue;
    }
    for (const [key, expectedValue] of Object.entries(expectedAssignment)) {
      if (key === "review_queue") {
        if (actual.review_gate?.queue !== expectedValue) fail(`${actual.assignment_id} review_queue mismatch`);
        continue;
      }
      if (key === "confirmation_queue") {
        if (actual.confirmation_gate?.queue !== expectedValue) fail(`${actual.assignment_id} confirmation_queue mismatch`);
        continue;
      }
      if (key === "execution_state") {
        if (actual.external_action?.execution_state !== expectedValue) fail(`${actual.assignment_id} execution_state mismatch`);
        continue;
      }
      if (JSON.stringify(actual[key]) !== JSON.stringify(expectedValue)) {
        fail(`${actual.assignment_id} ${key} mismatch`);
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
  const errors = validateAgentUsePatterns(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateAgentUsePatterns(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: agent use patterns contract is valid`);
}
