#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/source-snapshot-refresh-preflight");

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

function sourcePlans(input) {
  return mapBy(list(input, "refresh_plans"), "source_id");
}

function validateRefreshPreflight(input) {
  const errors = new Set();
  const sources = mapBy(list(input, "sources"), "source_id");
  const snapshots = mapBy(list(input, "snapshots"), "snapshot_id");
  const candidates = mapBy(list(input, "refresh_candidates"), "candidate_id");
  const plans = sourcePlans(input);

  checkUnchangedPlans(sources, snapshots, candidates, plans, errors);
  checkChangedPlans(sources, snapshots, plans, input, errors);
  checkUnavailablePlans(sources, candidates, plans, errors);
  checkDoNotUsePlans(sources, candidates, plans, input, errors);

  return [...errors];
}

function checkUnchangedPlans(sources, snapshots, candidates, plans, errors) {
  for (const plan of plans.values()) {
    if (plan.operation !== "unchanged") continue;
    const source = sources.get(plan.source_id);
    const candidate = candidates.get(plan.candidate_id);
    const activeSnapshot = snapshots.get(source?.active_snapshot_id);
    if (!source || !candidate || !activeSnapshot) continue;

    const unchanged = candidate.content_hash && candidate.content_hash === activeSnapshot.content_hash;
    if (unchanged && plan.created_snapshot_id) {
      errors.add("unchanged_source_created_snapshot");
    }
    if (unchanged && plan.freshness_after_check !== "fresh") {
      errors.add("unchanged_source_created_snapshot");
    }
  }
}

function checkChangedPlans(sources, snapshots, plans, input, errors) {
  const changedPreviousSnapshots = new Set();

  for (const source of sources.values()) {
    if (source.status !== "changed") continue;
    const plan = plans.get(source.source_id);
    if (plan?.operation !== "create_snapshot") {
      errors.add("changed_refresh_missing_previous_snapshot");
      continue;
    }
    const createdSnapshot = snapshots.get(plan.created_snapshot_id);
    const previousSnapshotId = plan.previous_snapshot_id ?? source.previous_snapshot_id;
    const previousSnapshot = snapshots.get(previousSnapshotId);
    if (
      !createdSnapshot ||
      !previousSnapshot ||
      !previousSnapshotId ||
      createdSnapshot.previous_snapshot_id !== previousSnapshotId ||
      plan.previous_snapshot_id !== previousSnapshotId
    ) {
      errors.add("changed_refresh_missing_previous_snapshot");
      continue;
    }
    if (createdSnapshot.content_hash && previousSnapshot.content_hash && createdSnapshot.content_hash === previousSnapshot.content_hash) {
      errors.add("changed_refresh_missing_previous_snapshot");
      continue;
    }
    changedPreviousSnapshots.add(previousSnapshotId);
  }

  for (const memory of list(input, "validated_memories")) {
    const derivedFrom = Array.isArray(memory.derived_from) ? memory.derived_from : [];
    const dependsOnChangedSnapshot = derivedFrom.some((snapshotId) => changedPreviousSnapshots.has(snapshotId));
    if (!dependsOnChangedSnapshot) continue;

    const routedToReview =
      memory.status === "needs_review" ||
      memory.freshness === "changed" ||
      memory.freshness === "stale";
    if (!routedToReview) {
      errors.add("changed_memory_not_routed_to_review");
    }
  }

  for (const plan of plans.values()) {
    if (plan.operation !== "create_snapshot" || !plan.review_id) continue;
    const review = list(input, "review_items").find((item) => item.review_id === plan.review_id);
    if (!review || review.old_snapshot_id !== plan.previous_snapshot_id || review.new_snapshot_id !== plan.created_snapshot_id) {
      errors.add("changed_memory_not_routed_to_review");
    }
  }
}

function checkUnavailablePlans(sources, candidates, plans, errors) {
  for (const source of sources.values()) {
    if (source.status === "unavailable" && source.freshness === "fresh") {
      errors.add("unavailable_refresh_marked_fresh");
    }
  }

  for (const candidate of candidates.values()) {
    if (candidate.result !== "unavailable") continue;
    const plan = plans.get(candidate.source_id);
    if (!plan || plan.operation !== "unavailable_last_known") {
      errors.add("unavailable_refresh_marked_fresh");
      continue;
    }
    if (plan.created_snapshot_id || plan.freshness_after_check === "fresh") {
      errors.add("unavailable_refresh_marked_fresh");
    }
  }
}

function checkDoNotUsePlans(sources, candidates, plans, input, errors) {
  const forbiddenSourceIds = new Set(
    [...sources.values()]
      .filter((source) => source.status === "do_not_use")
      .map((source) => source.source_id)
  );

  for (const candidate of candidates.values()) {
    if (!forbiddenSourceIds.has(candidate.source_id)) continue;
    const plan = plans.get(candidate.source_id);
    if (!plan || plan.operation !== "skip_do_not_use" || plan.created_snapshot_id || plan.freshness_after_check !== "do_not_use") {
      errors.add("do_not_use_source_refreshed");
    }
  }

  for (const payload of list(input, "promotion_payloads")) {
    const sourceId = payload.metadata?.source_id ?? payload.source_id;
    if (payload.status === "active" && forbiddenSourceIds.has(sourceId)) {
      errors.add("do_not_use_source_refreshed");
    }
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const valid = fixture.valid;
  const snapshots = mapBy(list(valid, "snapshots"), "snapshot_id");
  const plans = sourcePlans(valid);

  const unchangedPlan = plans.get(assertions.required_unchanged_source_id);
  if (!unchangedPlan || unchangedPlan.operation !== "unchanged" || unchangedPlan.created_snapshot_id) {
    fail("unchanged source plan mismatch");
  }

  const changedPlan = plans.get(assertions.required_changed_source_id);
  if (
    !changedPlan ||
    changedPlan.operation !== "create_snapshot" ||
    changedPlan.created_snapshot_id !== assertions.required_changed_snapshot_id ||
    changedPlan.previous_snapshot_id !== assertions.required_previous_snapshot_id
  ) {
    fail("changed source plan mismatch");
  }

  const changedSnapshot = snapshots.get(assertions.required_changed_snapshot_id);
  if (!changedSnapshot || changedSnapshot.previous_snapshot_id !== assertions.required_previous_snapshot_id || changedSnapshot.immutable !== true) {
    fail("changed snapshot lineage mismatch");
  }

  const review = list(valid, "review_items").find((item) => item.review_id === assertions.required_review_id);
  if (!review || review.old_snapshot_id !== assertions.required_previous_snapshot_id || review.new_snapshot_id !== assertions.required_changed_snapshot_id) {
    fail("refresh review lineage mismatch");
  }

  const unavailablePlan = plans.get(assertions.required_unavailable_source_id);
  if (!unavailablePlan || unavailablePlan.operation !== "unavailable_last_known" || unavailablePlan.freshness_after_check === "fresh") {
    fail("unavailable source plan mismatch");
  }

  const forbiddenPlan = plans.get(assertions.required_do_not_use_source_id);
  if (!forbiddenPlan || forbiddenPlan.operation !== "skip_do_not_use" || forbiddenPlan.created_snapshot_id) {
    fail("do_not_use source plan mismatch");
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
  const errors = validateRefreshPreflight(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateRefreshPreflight(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: source snapshot refresh preflight contract is valid`);
}
