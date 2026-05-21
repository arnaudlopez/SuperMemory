#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/source-change-t0-t1");

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

function validateSourceChange(input) {
  const errors = new Set();

  checkChangedSourceSnapshots(input, errors);
  checkChangedSourceMemoryReview(input, errors);
  checkReviewedMemoryDerivesFromT1(input, errors);
  checkStableRepromotionDocumentId(input, errors);
  checkUnavailableSource(input, errors);

  return [...errors];
}

function checkChangedSourceSnapshots(input, errors) {
  const snapshots = mapBy(list(input, "snapshots"), "snapshot_id");

  for (const source of list(input, "sources")) {
    if (source.status !== "changed") continue;
    const activeSnapshot = snapshots.get(source.active_snapshot_id);
    if (!activeSnapshot || activeSnapshot.previous_snapshot_id !== source.previous_snapshot_id) {
      errors.add("changed_source_missing_new_snapshot");
      continue;
    }
    const previousSnapshot = snapshots.get(source.previous_snapshot_id);
    if (!previousSnapshot) {
      errors.add("previous_snapshot_missing");
      continue;
    }
    if (activeSnapshot.content_hash && previousSnapshot.content_hash && activeSnapshot.content_hash === previousSnapshot.content_hash) {
      errors.add("changed_source_missing_new_snapshot");
    }
  }
}

function checkChangedSourceMemoryReview(input, errors) {
  const changedSources = list(input, "sources").filter((source) => source.status === "changed");
  if (changedSources.length === 0) return;

  const changedPreviousSnapshots = new Set(
    changedSources.map((source) => source.previous_snapshot_id).filter(Boolean)
  );

  for (const memory of list(input, "validated_memories")) {
    const derivedFrom = Array.isArray(memory.derived_from) ? memory.derived_from : [];
    const dependsOnChangedPreviousSnapshot = derivedFrom.some((snapshotId) => changedPreviousSnapshots.has(snapshotId));
    if (!dependsOnChangedPreviousSnapshot) continue;

    const safelyQuarantined =
      memory.status === "needs_review" ||
      memory.freshness === "changed" ||
      memory.freshness === "stale";
    if (!safelyQuarantined) {
      errors.add("changed_source_memory_not_reviewed");
    }
  }
}

function checkReviewedMemoryDerivesFromT1(input, errors) {
  const snapshots = mapBy(list(input, "snapshots"), "snapshot_id");

  for (const memory of list(input, "validated_memories")) {
    if (memory.status !== "active" || memory.review_status !== "approved") continue;
    const snapshot = snapshots.get(memory.snapshot_id);
    if (!snapshot?.previous_snapshot_id) continue;

    const derivedFrom = Array.isArray(memory.derived_from) ? memory.derived_from : [];
    if (!derivedFrom.includes(memory.snapshot_id)) {
      errors.add("reviewed_memory_not_derived_from_t1");
    }
  }
}

function checkStableRepromotionDocumentId(input, errors) {
  const memories = mapBy(list(input, "validated_memories"), "memory_id");

  for (const memory of list(input, "validated_memories")) {
    if (memory.status !== "active" || !memory.supersedes_memory_id) continue;
    const previous = memories.get(memory.supersedes_memory_id);
    if (previous?.document_id && memory.document_id !== previous.document_id) {
      errors.add("repromotion_document_id_changed");
    }
  }

  for (const payload of list(input, "promotion_payloads")) {
    if (payload.status !== "active") continue;
    const memory = memories.get(payload.memory_id);
    const previous = memories.get(payload.metadata?.replaces_memory_id);
    if (memory?.document_id && payload.document_id !== memory.document_id) {
      errors.add("repromotion_document_id_changed");
    }
    if (previous?.document_id && payload.document_id !== previous.document_id) {
      errors.add("repromotion_document_id_changed");
    }
  }
}

function checkUnavailableSource(input, errors) {
  for (const source of list(input, "sources")) {
    if (source.status !== "unavailable") continue;
    if (source.freshness === "fresh") {
      errors.add("unavailable_source_marked_fresh");
    }
  }

  for (const check of list(input, "source_checks")) {
    if (check.result !== "unavailable") continue;
    if (check.freshness_after_check === "fresh" || check.created_snapshot_id) {
      errors.add("unavailable_source_marked_fresh");
    }
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const finalState = readJson("expected/final-state.json");
  const valid = fixture.valid;
  const sources = mapBy(list(valid, "sources"), "source_id");
  const snapshots = mapBy(list(valid, "snapshots"), "snapshot_id");
  const memories = mapBy(list(valid, "validated_memories"), "memory_id");

  const source = sources.get(assertions.required_source_id);
  if (!source) fail(`missing source ${assertions.required_source_id}`);

  const t0 = snapshots.get(assertions.required_t0_snapshot_id);
  const t1 = snapshots.get(assertions.required_t1_snapshot_id);
  if (!t0) fail(`missing t0 snapshot ${assertions.required_t0_snapshot_id}`);
  if (!t1) fail(`missing t1 snapshot ${assertions.required_t1_snapshot_id}`);
  if (t1?.previous_snapshot_id !== assertions.required_t0_snapshot_id) {
    fail("t1 previous_snapshot_id mismatch");
  }

  const t0Memory = memories.get(assertions.required_t0_memory_id);
  const t1Memory = memories.get(assertions.required_t1_memory_id);
  if (!t0Memory) fail(`missing t0 memory ${assertions.required_t0_memory_id}`);
  if (!t1Memory) fail(`missing t1 memory ${assertions.required_t1_memory_id}`);
  if (t0Memory?.status !== finalState.t0_memory_status) fail("t0 memory status mismatch");
  if (t1Memory?.status !== finalState.t1_memory_status) fail("t1 memory status mismatch");
  if (t0Memory?.document_id !== t1Memory?.document_id || t1Memory?.document_id !== assertions.required_document_id) {
    fail("stable document_id mismatch");
  }
  if (!(t1Memory?.derived_from ?? []).includes(assertions.required_t1_snapshot_id)) {
    fail("t1 memory missing t1 derived_from");
  }

  const promotion = list(valid, "promotion_payloads").find((payload) => payload.memory_id === assertions.required_t1_memory_id);
  if (!promotion) {
    fail("missing t1 promotion payload");
  } else {
    if (promotion.document_id !== assertions.required_document_id) fail("promotion document_id mismatch");
    if (promotion.metadata?.snapshot_id !== assertions.required_t1_snapshot_id) fail("promotion snapshot_id mismatch");
    if (promotion.metadata?.previous_snapshot_id !== assertions.required_t0_snapshot_id) {
      fail("promotion previous_snapshot_id mismatch");
    }
  }

  const review = list(valid, "review_items").find((item) => item.review_id === assertions.required_review_id);
  if (!review) {
    fail(`missing review item ${assertions.required_review_id}`);
  } else if (review.old_snapshot_id !== assertions.required_t0_snapshot_id || review.new_snapshot_id !== assertions.required_t1_snapshot_id) {
    fail("review snapshot lineage mismatch");
  }

  const unavailable = sources.get(assertions.required_unavailable_source_id);
  if (!unavailable || unavailable.freshness !== finalState.unavailable_freshness) {
    fail("unavailable source freshness mismatch");
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
  const errors = validateSourceChange(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateSourceChange(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: source change t0/t1 contract is valid`);
}
