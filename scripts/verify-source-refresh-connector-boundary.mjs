#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/source-refresh-connector-boundary");

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

function plansBySource(input) {
  return mapBy(list(input, "refresh_plans"), "source_id");
}

function candidatesByResult(input) {
  return mapBy(list(input, "refresh_candidates"), "connector_result_id");
}

function validateConnectorBoundary(input) {
  const errors = new Set();
  const connectors = mapBy(list(input, "connector_registry"), "connector_id");
  const sources = mapBy(list(input, "sources"), "source_id");
  const snapshots = mapBy(list(input, "snapshots"), "snapshot_id");
  const candidates = candidatesByResult(input);
  const plans = plansBySource(input);

  checkNoSecretLeak(input, errors);
  checkConnectorAuthorization(connectors, sources, input, errors);
  checkConnectorScopes(connectors, sources, input, errors);
  checkCandidateProjection(input, candidates, errors);
  checkChangedLineage(sources, snapshots, input, candidates, plans, errors);
  checkUnavailableHandling(sources, input, candidates, plans, errors);
  checkDoNotUseHandling(sources, input, candidates, plans, errors);

  return [...errors];
}

function isAuthorizedConnector(connector) {
  return connector?.status === "enabled" && connector?.auth_status === "configured";
}

function sourceConnector(source, connectors) {
  return connectors.get(source?.connector_id);
}

function sourceWithinConnectorScope(source, connector) {
  if (!source || !connector) return false;
  const allowedScopes = Array.isArray(connector.allowed_scopes) ? connector.allowed_scopes : [];
  return allowedScopes.includes(source.connector_scope) && String(source.original_ref ?? "").startsWith(source.connector_scope);
}

function refWithinScope(ref, scope) {
  return typeof ref === "string" && typeof scope === "string" && ref.startsWith(scope);
}

function checkConnectorAuthorization(connectors, sources, input, errors) {
  for (const source of sources.values()) {
    const connector = sourceConnector(source, connectors);
    if (!isAuthorizedConnector(connector)) {
      errors.add("unauthorized_connector_used");
      continue;
    }
    if (connector.workspace_id && source.workspace_id && connector.workspace_id !== source.workspace_id) {
      errors.add("unauthorized_connector_used");
    }
    if (
      Array.isArray(connector.allowed_source_kinds) &&
      source.source_kind &&
      !connector.allowed_source_kinds.includes(source.source_kind)
    ) {
      errors.add("unauthorized_connector_used");
    }
  }

  for (const item of [...list(input, "connector_results"), ...list(input, "refresh_candidates")]) {
    const source = sources.get(item.source_id);
    const connector = connectors.get(item.connector_id);
    if (!source || !connector || !isAuthorizedConnector(connector) || item.connector_id !== source.connector_id) {
      errors.add("unauthorized_connector_used");
    }
  }
}

function checkConnectorScopes(connectors, sources, input, errors) {
  for (const source of sources.values()) {
    const connector = sourceConnector(source, connectors);
    if (!sourceWithinConnectorScope(source, connector)) {
      errors.add("connector_scope_escape");
    }
  }

  for (const item of [...list(input, "connector_results"), ...list(input, "refresh_candidates")]) {
    const source = sources.get(item.source_id);
    if (!source) continue;
    if (!refWithinScope(item.source_ref, source.connector_scope)) {
      errors.add("connector_scope_escape");
    }
  }
}

function checkNoSecretLeak(input, errors) {
  const secretLike = /sk-[A-Za-z0-9_-]+|token|secret_value/i;
  for (const section of ["connector_runs", "connector_results", "refresh_candidates"]) {
    for (const item of list(input, section)) {
      if (Object.hasOwn(item, "secret_value") || item.secrets_redacted === false) {
        errors.add("connector_secret_leaked");
      }
      const serialized = JSON.stringify(item);
      if (secretLike.test(serialized) && !serialized.includes("secret_ref")) {
        errors.add("connector_secret_leaked");
      }
    }
  }
}

function checkCandidateProjection(input, candidates, errors) {
  for (const result of list(input, "connector_results")) {
    const candidate = candidates.get(result.result_id);
    if (result.result === "blocked") {
      if (candidate && candidate.result !== "blocked") {
        errors.add("do_not_use_connector_refreshed");
      }
      continue;
    }
    if (!candidate) {
      if (result.result === "unavailable") errors.add("connector_unavailable_marked_fresh");
      if (result.result === "available") errors.add("changed_connector_result_missing_lineage");
      continue;
    }
    for (const key of ["source_id", "connector_id", "source_ref", "result"]) {
      if (candidate[key] !== result[key]) {
        errors.add("changed_connector_result_missing_lineage");
      }
    }
    if (result.result === "available" && candidate.content_hash !== result.content_hash) {
      errors.add("changed_connector_result_missing_lineage");
    }
  }
}

function checkChangedLineage(sources, snapshots, input, candidates, plans, errors) {
  for (const result of list(input, "connector_results")) {
    if (result.result !== "available" || !result.content_hash) continue;
    const source = sources.get(result.source_id);
    if (!source || source.status === "do_not_use") continue;
    const activeSnapshot = snapshots.get(source.active_snapshot_id);
    if (!activeSnapshot || activeSnapshot.content_hash === result.content_hash) continue;

    const candidate = candidates.get(result.result_id);
    const plan = plans.get(result.source_id);
    const plannedSnapshot = snapshots.get(candidate?.planned_snapshot_id ?? result.planned_snapshot_id);
    const previousSnapshotId = candidate?.previous_snapshot_id ?? result.previous_snapshot_id;

    if (
      !candidate ||
      !plan ||
      plan.operation !== "create_snapshot" ||
      !plannedSnapshot ||
      !previousSnapshotId ||
      previousSnapshotId !== source.active_snapshot_id ||
      candidate.previous_snapshot_id !== source.active_snapshot_id ||
      plan.previous_snapshot_id !== source.active_snapshot_id ||
      plannedSnapshot.previous_snapshot_id !== source.active_snapshot_id ||
      plannedSnapshot.connector_result_id !== result.result_id ||
      plannedSnapshot.immutable !== true
    ) {
      errors.add("changed_connector_result_missing_lineage");
      continue;
    }

    for (const memory of list(input, "validated_memories")) {
      const derivedFrom = Array.isArray(memory.derived_from) ? memory.derived_from : [];
      if (!derivedFrom.includes(source.active_snapshot_id)) continue;
      if (memory.status !== "needs_review" && memory.freshness !== "changed" && memory.freshness !== "stale") {
        errors.add("changed_connector_result_missing_lineage");
      }
    }

    if (plan.review_id) {
      const review = list(input, "review_items").find((item) => item.review_id === plan.review_id);
      if (!review || review.old_snapshot_id !== source.active_snapshot_id || review.new_snapshot_id !== plan.created_snapshot_id) {
        errors.add("changed_connector_result_missing_lineage");
      }
    }
  }
}

function checkUnavailableHandling(sources, input, candidates, plans, errors) {
  for (const result of list(input, "connector_results")) {
    if (result.result !== "unavailable") continue;
    const source = sources.get(result.source_id);
    const candidate = candidates.get(result.result_id);
    const plan = plans.get(result.source_id);
    if (!candidate || candidate.result !== "unavailable" || candidate.content_hash || candidate.planned_snapshot_id) {
      errors.add("connector_unavailable_marked_fresh");
    }
    if (!plan || plan.operation !== "unavailable_last_known" || plan.created_snapshot_id || plan.freshness_after_check === "fresh") {
      errors.add("connector_unavailable_marked_fresh");
    }
    if (source?.freshness === "fresh" && plan?.freshness_after_check === "fresh") {
      errors.add("connector_unavailable_marked_fresh");
    }
  }
}

function checkDoNotUseHandling(sources, input, candidates, plans, errors) {
  const forbiddenSourceIds = new Set(
    [...sources.values()]
      .filter((source) => source.status === "do_not_use")
      .map((source) => source.source_id)
  );

  for (const result of list(input, "connector_results")) {
    if (!forbiddenSourceIds.has(result.source_id)) continue;
    const candidate = candidates.get(result.result_id);
    const plan = plans.get(result.source_id);
    if (result.result !== "blocked" || result.blocked_reason !== "do_not_use") {
      errors.add("do_not_use_connector_refreshed");
    }
    if (!candidate || candidate.result !== "blocked" || candidate.blocked_reason !== "do_not_use") {
      errors.add("do_not_use_connector_refreshed");
    }
    if (!plan || plan.operation !== "skip_do_not_use" || plan.created_snapshot_id || plan.freshness_after_check !== "do_not_use") {
      errors.add("do_not_use_connector_refreshed");
    }
  }

  for (const payload of list(input, "promotion_payloads")) {
    const sourceId = payload.metadata?.source_id ?? payload.source_id;
    if (payload.status === "active" && forbiddenSourceIds.has(sourceId)) {
      errors.add("do_not_use_connector_refreshed");
    }
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const valid = fixture.valid;
  const connectors = mapBy(list(valid, "connector_registry"), "connector_id");
  const snapshots = mapBy(list(valid, "snapshots"), "snapshot_id");
  const results = mapBy(list(valid, "connector_results"), "result_id");
  const candidates = mapBy(list(valid, "refresh_candidates"), "candidate_id");
  const plans = plansBySource(valid);

  const connector = connectors.get(assertions.required_connector_id);
  if (!connector || connector.connector_type !== assertions.required_connector_type) {
    fail("connector registry mismatch");
  }
  if (!connector.allowed_scopes?.includes(assertions.required_connector_scope)) {
    fail("connector scope mismatch");
  }

  const result = results.get(assertions.required_changed_result_id);
  const candidate = candidates.get(assertions.required_changed_candidate_id);
  const snapshot = snapshots.get(assertions.required_changed_snapshot_id);
  const plan = plans.get(assertions.required_changed_source_id);
  if (!result || result.planned_snapshot_id !== assertions.required_changed_snapshot_id) {
    fail("changed connector result mismatch");
  }
  if (!candidate || candidate.previous_snapshot_id !== assertions.required_previous_snapshot_id) {
    fail("changed candidate lineage mismatch");
  }
  if (!snapshot || snapshot.previous_snapshot_id !== assertions.required_previous_snapshot_id || snapshot.connector_result_id !== result.result_id) {
    fail("changed snapshot lineage mismatch");
  }
  if (!plan || plan.operation !== "create_snapshot" || plan.review_id !== assertions.required_review_id) {
    fail("changed refresh plan mismatch");
  }

  const unavailablePlan = plans.get(assertions.required_unavailable_source_id);
  if (!unavailablePlan || unavailablePlan.operation !== "unavailable_last_known" || unavailablePlan.freshness_after_check === "fresh") {
    fail("unavailable connector plan mismatch");
  }

  const forbiddenPlan = plans.get(assertions.required_do_not_use_source_id);
  if (!forbiddenPlan || forbiddenPlan.operation !== "skip_do_not_use" || forbiddenPlan.created_snapshot_id) {
    fail("do_not_use connector plan mismatch");
  }

  if (list(valid, "promotion_payloads").length !== 0) {
    fail("connector boundary should not promote directly");
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
  const errors = validateConnectorBoundary(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateConnectorBoundary(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: source refresh connector boundary contract is valid`);
}
