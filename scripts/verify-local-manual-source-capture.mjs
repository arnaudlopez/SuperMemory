#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/local-manual-source-capture");

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

function refWithinScope(ref, scope) {
  return typeof ref === "string" && typeof scope === "string" && ref.startsWith(scope);
}

function hasValue(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function validateLocalManualCapture(input) {
  const errors = new Set();
  const captures = list(input, "manual_captures");
  const registryEntries = mapBy(list(input, "source_registry_entries"), "source_id");
  const snapshots = mapBy(list(input, "snapshots"), "snapshot_id");

  checkOwnerIntent(captures, errors);
  checkScope(captures, registryEntries, snapshots, errors);
  checkSnapshotProof(captures, registryEntries, snapshots, errors);
  checkSourceInstructions(input, errors);
  checkSecretLeak(input, errors);
  checkDoNotUse(input, registryEntries, snapshots, errors);

  return [...errors];
}

function checkOwnerIntent(captures, errors) {
  for (const capture of captures) {
    if (!hasValue(capture.requested_by) || !hasValue(capture.capture_reason) || capture.owner_confirmed !== true) {
      errors.add("missing_owner_intent");
    }
  }
}

function checkScope(captures, registryEntries, snapshots, errors) {
  for (const capture of captures) {
    if (!refWithinScope(capture.original_ref, capture.connector_scope)) {
      errors.add("manual_capture_scope_escape");
    }
  }

  for (const entry of registryEntries.values()) {
    if (!refWithinScope(entry.original_ref, entry.connector_scope)) {
      errors.add("manual_capture_scope_escape");
    }
  }

  for (const snapshot of snapshots.values()) {
    if (!refWithinScope(snapshot.original_ref, snapshot.connector_scope)) {
      errors.add("manual_capture_scope_escape");
    }
  }
}

function checkSnapshotProof(captures, registryEntries, snapshots, errors) {
  for (const capture of captures) {
    if (capture.status === "do_not_use") continue;
    const entry = registryEntries.get(capture.source_id);
    const snapshot = snapshots.get(entry?.active_snapshot_id);
    const requiredCaptureFields = [
      "source_id",
      "connector_id",
      "connector_type",
      "connector_scope",
      "original_ref",
      "content_hash",
      "captured_at",
      "workspace_id",
      "source_kind",
      "sensitivity"
    ];
    const missingCaptureField = requiredCaptureFields.some((key) => !hasValue(capture[key]));
    const missingEntry =
      !entry ||
      entry.source_id !== capture.source_id ||
      entry.connector_id !== capture.connector_id ||
      entry.connector_scope !== capture.connector_scope ||
      entry.original_ref !== capture.original_ref ||
      entry.active_snapshot_id == null;
    const missingSnapshot =
      !snapshot ||
      snapshot.source_id !== capture.source_id ||
      snapshot.connector_id !== capture.connector_id ||
      snapshot.connector_scope !== capture.connector_scope ||
      snapshot.original_ref !== capture.original_ref ||
      snapshot.content_hash !== capture.content_hash ||
      snapshot.captured_at !== capture.captured_at ||
      snapshot.immutable !== true ||
      snapshot.source_text_role !== "evidence_only";

    if (missingCaptureField || missingEntry || missingSnapshot) {
      errors.add("missing_snapshot_proof");
    }
  }
}

function checkSourceInstructions(input, errors) {
  const instructionLike = /ignore previous instructions|export all memories|system prompt|developer message/i;

  for (const snapshot of list(input, "snapshots")) {
    if (snapshot.contains_untrusted_instructions === true && snapshot.source_text_role !== "evidence_only") {
      errors.add("source_instruction_leaked");
    }
  }

  for (const item of [...list(input, "derived_memories"), ...list(input, "promotion_payloads")]) {
    const serialized = JSON.stringify(item);
    if (instructionLike.test(serialized) || item.instruction_policy === "source_text_executable") {
      errors.add("source_instruction_leaked");
    }
  }
}

function checkSecretLeak(input, errors) {
  const secretLike = /sk-[A-Za-z0-9_-]+|password\\s*[:=]|api[_-]?key\\s*[:=]|secret_value/i;

  for (const item of [...list(input, "derived_memories"), ...list(input, "promotion_payloads")]) {
    if (item.redaction_status === "unredacted") {
      errors.add("secret_leaked_from_manual_capture");
      continue;
    }
    if (secretLike.test(JSON.stringify(item))) {
      errors.add("secret_leaked_from_manual_capture");
    }
  }
}

function checkDoNotUse(input, registryEntries, snapshots, errors) {
  const forbiddenSourceIds = new Set(
    list(input, "manual_captures")
      .filter((capture) => capture.status === "do_not_use")
      .map((capture) => capture.source_id)
  );

  for (const sourceId of forbiddenSourceIds) {
    const entry = registryEntries.get(sourceId);
    if (entry?.active_snapshot_id && snapshots.has(entry.active_snapshot_id)) {
      errors.add("do_not_use_manual_source_captured");
    }
  }

  for (const payload of list(input, "promotion_payloads")) {
    const sourceId = payload.metadata?.source_id ?? payload.source_id;
    if (payload.status === "active" && forbiddenSourceIds.has(sourceId)) {
      errors.add("do_not_use_manual_source_captured");
    }
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const valid = fixture.valid;
  const captures = mapBy(list(valid, "manual_captures"), "capture_id");
  const entries = mapBy(list(valid, "source_registry_entries"), "source_id");
  const snapshots = mapBy(list(valid, "snapshots"), "snapshot_id");

  if (list(valid, "manual_captures").length !== 1) {
    fail("valid case should contain exactly one manual capture");
  }
  if (list(valid, "source_registry_entries").length !== 1) {
    fail("valid case should contain exactly one source registry entry");
  }
  if (list(valid, "snapshots").length !== 1) {
    fail("valid case should contain exactly one snapshot");
  }

  const capture = captures.get(assertions.required_capture_id);
  const entry = entries.get(assertions.required_source_id);
  const snapshot = snapshots.get(assertions.required_snapshot_id);

  if (!capture || capture.connector_id !== assertions.required_connector_id || capture.connector_type !== assertions.required_connector_type) {
    fail("manual capture metadata mismatch");
  }
  if (!capture || capture.connector_scope !== assertions.required_connector_scope || capture.original_ref !== assertions.required_original_ref) {
    fail("manual capture scope mismatch");
  }
  if (!entry || entry.active_snapshot_id !== assertions.required_snapshot_id || entry.owner_confirmed !== true) {
    fail("source registry entry mismatch");
  }
  if (!snapshot || snapshot.immutable !== true || snapshot.source_text_role !== "evidence_only") {
    fail("snapshot proof mismatch");
  }
  if (list(valid, "promotion_payloads").length !== 0) {
    fail("manual capture should not promote directly");
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
  const errors = validateLocalManualCapture(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateLocalManualCapture(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: local manual source capture contract is valid`);
}
