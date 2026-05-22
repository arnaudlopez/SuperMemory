#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/enterprise-living-memory-complete");
const knownUsePatterns = new Set([
  "external_draft",
  "internal_draft",
  "decision_support",
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

function hasAny(values) {
  return Array.isArray(values) && values.length > 0;
}

function hasAll(values, requiredValues) {
  return Array.isArray(values) && requiredValues.every((value) => values.includes(value));
}

function mapBy(items, key) {
  return new Map(items.map((item) => [item[key], item]).filter(([value]) => Boolean(value)));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyMutation(valid, mutation) {
  const mutated = clone(valid);

  if (mutation.remove_answer) {
    mutated.answers = list(mutated, "answers").filter((answer) => answer.question_id !== mutation.remove_answer);
  }
  if (mutation.mark_unsourced) {
    const answer = list(mutated, "answers").find((item) => item.question_id === mutation.mark_unsourced);
    if (answer) {
      answer.source_backed = false;
      answer.evidence_refs = [];
    }
  }
  if (mutation.clear_relation_chain) {
    const answer = list(mutated, "answers").find((item) => item.question_id === mutation.clear_relation_chain);
    if (answer) answer.relation_chain = [];
  }
  if (mutation.agent_uses_blocked_memory) {
    const decision = list(mutated, "agent_scope_decisions").find((item) => item.agent === mutation.agent_uses_blocked_memory);
    if (decision) {
      decision.allowed_memory_ids ??= [];
      decision.allowed_memory_ids.push(decision.blocked_memory_ids?.[0] ?? "restricted_contract_text");
    }
  }
  if (mutation.remove_queue) {
    mutated.review_queues = list(mutated, "review_queues").filter((entry) => entry.queue !== mutation.remove_queue);
  }
  if (mutation.inject_secret) {
    const answer = list(mutated, "answers").find((item) => item.question_id === mutation.inject_secret);
    if (answer) answer.answer += " sk_live_orion_sample";
  }
  if (mutation.activate_engine_port) {
    const port = list(mutated, "engine_port_evals").find((item) => item.candidate === mutation.activate_engine_port);
    if (port) port.status = "activated";
  }
  if (mutation.set_bespoke_pattern) {
    const pattern = list(mutated, "use_patterns").find((item) => item.task === mutation.set_bespoke_pattern);
    if (pattern) pattern.pattern = "custom_orion_launch_workflow";
  }

  return mutated;
}

function validateComplete(input, assertions) {
  const errors = new Set();

  checkAnswers(input, assertions, errors);
  checkAgentScopes(input, assertions, errors);
  checkReviewQueues(input, assertions, errors);
  checkSecrets(input, errors);
  checkEnginePorts(input, assertions, errors);
  checkUsePatterns(input, assertions, errors);
  checkRelations(input, assertions, errors);
  checkHindsightDocumentId(input, assertions, errors);

  return [...errors];
}

function checkAnswers(input, assertions, errors) {
  const answerMap = mapBy(list(input, "answers"), "question_id");

  for (const questionId of assertions.required_question_ids ?? []) {
    if (!answerMap.has(questionId)) {
      errors.add("missing_golden_question");
      return;
    }
  }

  for (const answer of list(input, "answers")) {
    if (answer.source_backed !== true || !hasAny(answer.evidence_refs) || !hasAny(answer.supports_answer)) {
      errors.add("unsourced_answer");
      return;
    }
    if (!hasAny(answer.relation_chain) || !answer.relation_chain.includes("supports_answer")) {
      errors.add("missing_relation_chain");
      return;
    }
    if (answer.question_id !== "engine-port-decision" && !hasAny(answer.snapshot_ids)) {
      errors.add("missing_relation_chain");
      return;
    }
  }
}

function checkAgentScopes(input, assertions, errors) {
  const decisionMap = mapBy(list(input, "agent_scope_decisions"), "agent");

  for (const agent of assertions.required_agents ?? []) {
    const decision = decisionMap.get(agent);
    if (!decision || !decision.decision) {
      errors.add("agent_scope_violation");
      return;
    }
    const blocked = new Set(decision.blocked_memory_ids ?? []);
    if ((decision.allowed_memory_ids ?? []).some((memoryId) => blocked.has(memoryId))) {
      errors.add("agent_scope_violation");
      return;
    }
  }

  const marketing = decisionMap.get("marketing_agent");
  if (!marketing?.blocked_memory_ids?.includes("snap-orion-contract-t1-2026-05-27")) {
    errors.add("agent_scope_violation");
  }
}

function checkReviewQueues(input, assertions, errors) {
  const queueMap = mapBy(list(input, "review_queues"), "queue");

  for (const queueName of assertions.required_queue_names ?? []) {
    const entry = queueMap.get(queueName);
    if (!entry || !entry.owner || !hasAny(entry.related_snapshot_ids) || !entry.required_decision) {
      errors.add("missing_review_queue");
      return;
    }
  }
}

function checkSecrets(input, errors) {
  const corpus = [
    ...list(input, "answers").map((answer) => answer.answer),
    ...list(input, "recall_results").flatMap((recall) => recall.used_memory_ids ?? []),
    ...list(input, "agent_scope_decisions").flatMap((decision) => decision.allowed_memory_ids ?? [])
  ].join("\n").toLowerCase();

  for (const term of input.forbidden_terms ?? []) {
    if (corpus.includes(term.toLowerCase())) {
      errors.add("secret_leak");
      return;
    }
  }
}

function checkEnginePorts(input, assertions, errors) {
  const portMap = mapBy(list(input, "engine_port_evals"), "candidate");

  for (const [candidate, expectedStatus] of Object.entries(assertions.required_engine_ports ?? {})) {
    if (portMap.get(candidate)?.status !== expectedStatus) {
      errors.add("engine_port_overactivation");
      return;
    }
  }
}

function checkUsePatterns(input, assertions, errors) {
  const patterns = new Set(list(input, "use_patterns").map((item) => item.pattern));

  for (const pattern of patterns) {
    if (!knownUsePatterns.has(pattern)) {
      errors.add("bespoke_workflow");
      return;
    }
  }

  for (const pattern of assertions.required_use_patterns ?? []) {
    if (!patterns.has(pattern)) {
      errors.add("bespoke_workflow");
      return;
    }
  }
}

function checkRelations(input, assertions, errors) {
  if (!hasAll(input.relations, assertions.required_relation_verbs ?? [])) {
    errors.add("missing_relation_chain");
  }
}

function checkHindsightDocumentId(input, assertions, errors) {
  const prdPromotions = list(input, "hindsight_promotions").filter((item) => item.memory_id?.startsWith("mem-orion-prd"));
  if (!prdPromotions.every((item) => item.document_id === assertions.stable_prd_document_id)) {
    errors.add("missing_relation_chain");
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const expected = readJson("expected/answer-evidence.json");
  const answerMap = mapBy(list(fixture.valid, "answers"), "question_id");

  for (const expectedAnswer of expected.answers ?? []) {
    const actual = answerMap.get(expectedAnswer.question_id);
    if (!actual) {
      fail(`missing expected answer ${expectedAnswer.question_id}`);
      continue;
    }
    if (expectedAnswer.answer_state && actual.answer_state !== expectedAnswer.answer_state) {
      fail(`${expectedAnswer.question_id} answer_state mismatch`);
    }
    if (expectedAnswer.required_text && !actual.answer.includes(expectedAnswer.required_text)) {
      fail(`${expectedAnswer.question_id} missing required text ${expectedAnswer.required_text}`);
    }
    if (expectedAnswer.required_snapshot_ids && !hasAll(actual.snapshot_ids, expectedAnswer.required_snapshot_ids)) {
      fail(`${expectedAnswer.question_id} missing required snapshots`);
    }
    if (expectedAnswer.required_relation_chain && !hasAll(actual.relation_chain, expectedAnswer.required_relation_chain)) {
      fail(`${expectedAnswer.question_id} missing required relation chain`);
    }
    for (const forbidden of expectedAnswer.forbidden_text ?? []) {
      if (actual.answer.includes(forbidden)) fail(`${expectedAnswer.question_id} includes forbidden text ${forbidden}`);
    }
  }
}

const fixture = readJson("actual/fixture.json");
const assertions = readJson("expected/complete-assertions.json");

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
  const mutated = applyMutation(fixture.valid, invalidCase.mutation ?? {});
  const errors = validateComplete(mutated, assertions);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateComplete(fixture.valid, assertions);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: complete enterprise living memory contract is valid`);
}
