#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(
  root,
  "identity-vault/90_evals/cases/memory-contracts/input/contracts.fixture.json"
);
const assertionsPath = path.join(
  root,
  "identity-vault/90_evals/cases/memory-contracts/expected/assertions.json"
);

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateContracts(input) {
  const errors = new Set();

  checkSnapshotIdentity(input, errors);
  checkMemoryCandidates(input, errors);
  checkValidatedMemories(input, errors);
  checkPromotionPayloads(input, errors);
  checkRecallPolicies(input, errors);
  checkAnswerEvidence(input, errors);
  checkRelations(input, errors);

  return [...errors];
}

function list(input, key) {
  return Array.isArray(input?.[key]) ? input[key] : [];
}

function checkSnapshotIdentity(input, errors) {
  const seen = new Map();

  for (const snapshot of list(input, "snapshots")) {
    if (!snapshot?.snapshot_id) continue;
    const previous = seen.get(snapshot.snapshot_id);
    if (previous && previous.content_hash !== snapshot.content_hash) {
      errors.add("snapshot_id_collision");
      continue;
    }
    seen.set(snapshot.snapshot_id, snapshot);
  }
}

function checkMemoryCandidates(input, errors) {
  for (const candidate of list(input, "memory_candidates")) {
    const wantsActive = candidate.proposed_status === "active" || candidate.status === "active";
    if (wantsActive && candidate.review_status !== "approved") {
      errors.add("candidate_not_validated");
    }
    if (wantsActive && candidate.schema_status === "candidate") {
      errors.add("candidate_type_not_promotable");
    }
  }
}

function checkValidatedMemories(input, errors) {
  for (const memory of list(input, "validated_memories")) {
    const derivedFrom = Array.isArray(memory.derived_from) ? memory.derived_from : [];
    if (memory.status === "active" && !memory.snapshot_id && derivedFrom.length === 0) {
      errors.add("missing_snapshot_proof");
    }
  }
}

function checkPromotionPayloads(input, errors) {
  const activePayloadDocumentIds = new Set(
    list(input, "promotion_payloads")
      .filter((payload) => payload?.status === "active")
      .map((payload) => payload.document_id)
      .filter(Boolean)
  );

  for (const memory of list(input, "validated_memories")) {
    if (memory.status === "do_not_use" && activePayloadDocumentIds.has(memory.document_id)) {
      errors.add("do_not_use_not_promotable");
    }
  }
}

function checkRecallPolicies(input, errors) {
  for (const policy of list(input, "recall_policies")) {
    const requiredTags = Array.isArray(policy.required_tags) ? policy.required_tags : [];
    const hasWorkspace = Boolean(policy.workspace_id) || requiredTags.some((tag) => tag.startsWith("workspace:"));
    const hasAccessPolicy =
      Boolean(policy.access_policy) || requiredTags.some((tag) => tag.startsWith("access_policy:"));
    const hasActiveStatus = requiredTags.includes("status:active");
    if (!policy.fail_closed || !hasWorkspace || !hasAccessPolicy || !hasActiveStatus) {
      errors.add("unsafe_recall_policy");
    }
  }
}

function checkAnswerEvidence(input, errors) {
  for (const evidence of list(input, "answer_evidence")) {
    const usedMemoryIds = Array.isArray(evidence.used_memory_ids) ? evidence.used_memory_ids : [];
    const citedSnapshotIds = Array.isArray(evidence.cited_snapshot_ids) ? evidence.cited_snapshot_ids : [];
    if (evidence.answer_state === "current" && (usedMemoryIds.length === 0 || citedSnapshotIds.length === 0)) {
      errors.add("missing_answer_evidence");
    }
  }
}

function checkRelations(input, errors) {
  const memoryIds = new Set(list(input, "validated_memories").map((memory) => memory.memory_id).filter(Boolean));
  const answerIds = new Set(list(input, "answer_evidence").map((evidence) => evidence.answer_id).filter(Boolean));

  for (const relation of list(input, "relations")) {
    if (relation.relation_type !== "supports_answer") continue;
    if (!memoryIds.has(relation.from) || !answerIds.has(relation.to)) {
      errors.add("invalid_relation_endpoints");
    }
  }
}

if (!fs.existsSync(fixturePath)) {
  fail(`missing fixture: ${fixturePath}`);
  process.exit();
}

if (!fs.existsSync(assertionsPath)) {
  fail(`missing assertions: ${assertionsPath}`);
  process.exit();
}

const fixture = readJson(fixturePath);
const assertions = readJson(assertionsPath);

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
  const errors = validateContracts(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateContracts(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: memory contracts are valid`);
}
