#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/enterprise-living-memory-partial");

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

function mapBy(items, key) {
  return new Map(items.map((item) => [item[key], item]).filter(([value]) => Boolean(value)));
}

function hasAll(values, requiredValues) {
  return Array.isArray(values) && requiredValues.every((value) => values.includes(value));
}

function validateEnterprisePartial(input, options = {}) {
  const errors = new Set();
  const strict = options.strict === true;

  const snapshots = list(input, "source_snapshots");
  const memories = list(input, "derived_memories");
  const promotions = list(input, "hindsight_promotions");
  const recalls = list(input, "recall_results");
  const answers = list(input, "answers");
  const pendingDimensions = list(input, "pending_dimensions");

  if (strict || snapshots.some((item) => item.source_kind === "api_docs")) {
    checkApiSnapshots(snapshots, errors);
  }
  if (strict || snapshots.some((item) => item.source_kind === "contract")) {
    checkContractSnapshots(snapshots, errors);
  }
  if (strict || memories.some((item) => item.entity_type === "prd")) {
    checkPrdReviewPath(memories, errors);
  }
  if (strict || promotions.length > 0) {
    checkHindsightRepromotion(promotions, errors);
  }
  if (strict || snapshots.some((item) => item.status === "do_not_use") || recalls.length > 0) {
    checkDoNotUseRecall(snapshots, recalls, errors);
  }
  if (strict || answers.length > 0) {
    checkCoreAnswers(answers, errors);
  }
  if (strict || pendingDimensions.length > 0) {
    checkPendingDimensions(pendingDimensions, errors);
  }

  return [...errors];
}

function checkApiSnapshots(snapshots, errors) {
  const apiSnapshots = snapshots.filter((item) => item.source_kind === "api_docs");
  const t0 = apiSnapshots.find((item) => item.field === "risk_score");
  const t1 = apiSnapshots.find((item) => item.field === "trust_score");

  if (
    !t0 ||
    !t1 ||
    t0.status !== "historical_only" ||
    t1.status !== "active" ||
    t1.previous_snapshot_id !== t0.snapshot_id
  ) {
    errors.add("missing_api_t1_active");
  }
}

function checkContractSnapshots(snapshots, errors) {
  const contractSnapshots = snapshots.filter((item) => item.source_kind === "contract");
  const t0 = contractSnapshots.find((item) => item.retention_days === 30);
  const t1 = contractSnapshots.find((item) => item.retention_days === 90);

  if (
    !t0 ||
    !t1 ||
    t0.status !== "historical_only" ||
    t1.status !== "active" ||
    t1.previous_snapshot_id !== t0.snapshot_id ||
    !t1.legal_metadata?.retention_policy ||
    !t1.legal_metadata?.retention_until ||
    !t1.legal_metadata?.legal_hold_status
  ) {
    errors.add("missing_contract_legal_metadata");
  }
}

function checkPrdReviewPath(memories, errors) {
  const prdMemories = memories.filter((item) => item.entity_type === "prd");
  const stale = prdMemories.find((item) => item.status === "needs_review" && item.opens_review);
  const reviewed = prdMemories.find((item) => item.status === "active" && item.review_state === "reviewed");

  if (
    !stale ||
    !reviewed ||
    stale.document_id !== reviewed.document_id ||
    reviewed.supersedes_memory !== stale.memory_id ||
    !hasAny(stale.derived_from) ||
    !hasAny(reviewed.derived_from)
  ) {
    errors.add("missing_prd_review_path");
  }
}

function checkHindsightRepromotion(promotions, errors) {
  const historical = promotions.find((item) => item.status === "historical_only");
  const active = promotions.find((item) => item.status === "active" && item.re_promotion === true);

  if (!historical || !active || historical.document_id !== active.document_id) {
    errors.add("duplicate_hindsight_document_id");
  }
}

function checkDoNotUseRecall(snapshots, recalls, errors) {
  const forbiddenIds = snapshots
    .filter((item) => item.status === "do_not_use" || item.active_recall_allowed === false)
    .map((item) => item.snapshot_id);

  for (const recall of recalls) {
    if (recall.status !== "active") continue;
    const used = recall.used_memory_ids ?? [];
    if (forbiddenIds.some((id) => used.includes(id))) {
      errors.add("do_not_use_in_active_recall");
      return;
    }
  }
}

function checkCoreAnswers(answers, errors) {
  for (const answer of answers) {
    if (
      answer.source_backed !== true ||
      !hasAny(answer.evidence_refs) ||
      !hasAny(answer.supports_answer) ||
      (answer.answer_state !== "forbidden" && !hasAny(answer.snapshot_ids))
    ) {
      errors.add("unsourced_core_answer");
      return;
    }
  }
}

function checkPendingDimensions(pendingDimensions, errors) {
  const required = ["marketing_strategy", "legal_hold", "secrets", "engine_port_evals", "specialized_agents_complete"];
  const pending = new Set(
    pendingDimensions
      .filter((item) => item.status === "pending")
      .map((item) => item.dimension)
  );

  if (!required.every((dimension) => pending.has(dimension))) {
    errors.add("missing_pending_dimension");
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const expected = readJson("expected/answer-evidence.json");
  const valid = fixture.valid;
  const snapshots = mapBy(list(valid, "source_snapshots"), "snapshot_id");
  const answers = mapBy(list(valid, "answers"), "question_id");

  for (const snapshotId of assertions.required_active_snapshot_ids ?? []) {
    if (snapshots.get(snapshotId)?.status !== "active") fail(`${snapshotId} must be active`);
  }

  for (const snapshotId of assertions.required_historical_snapshot_ids ?? []) {
    if (snapshots.get(snapshotId)?.status !== "historical_only") fail(`${snapshotId} must be historical_only`);
  }

  for (const questionId of assertions.required_core_question_ids ?? []) {
    if (!answers.has(questionId)) fail(`missing core answer ${questionId}`);
  }

  for (const expectedAnswer of expected.answers ?? []) {
    const actual = answers.get(expectedAnswer.question_id);
    if (!actual) {
      fail(`missing expected answer ${expectedAnswer.question_id}`);
      continue;
    }
    if (actual.answer_state !== expectedAnswer.answer_state) {
      fail(`${expectedAnswer.question_id} answer_state mismatch`);
    }
    if (expectedAnswer.required_text && !actual.answer.includes(expectedAnswer.required_text)) {
      fail(`${expectedAnswer.question_id} missing required text ${expectedAnswer.required_text}`);
    }
    if (expectedAnswer.required_snapshot_ids && !hasAll(actual.snapshot_ids, expectedAnswer.required_snapshot_ids)) {
      fail(`${expectedAnswer.question_id} missing required snapshots`);
    }
    if (
      expectedAnswer.forbidden_used_memory_ids &&
      expectedAnswer.forbidden_used_memory_ids.some((id) => actual.used_memory_ids?.includes(id))
    ) {
      fail(`${expectedAnswer.question_id} uses forbidden memory`);
    }
  }

  const promotions = list(valid, "hindsight_promotions");
  const documentIds = new Set(promotions.map((item) => item.document_id));
  if (!documentIds.has(assertions.stable_prd_document_id) || documentIds.size !== 1) {
    fail("PRD Hindsight re-promotion must use the stable document_id");
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
  const errors = validateEnterprisePartial(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateEnterprisePartial(fixture.valid, { strict: true });
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: partial enterprise living memory contract is valid`);
}
