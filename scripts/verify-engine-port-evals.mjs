#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/engine-port-evals");
const logPath = path.join(root, "identity-vault/80_logs/engine_port_evals.jsonl");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(caseRoot, relativePath), "utf8"));
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`${filePath}:${index + 1} is not valid JSON: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);
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

function hasAll(values, requiredValues) {
  return Array.isArray(values) && requiredValues.every((value) => values.includes(value));
}

function validateEnginePortEvals(input) {
  const errors = new Set();

  for (const evalRecord of list(input, "engine_port_evals")) {
    if (!hasValue(evalRecord.eval_id) || !hasValue(evalRecord.eval_result) || !hasValue(evalRecord.decision_reason)) {
      errors.add("engine_port_eval_missing_evidence");
      continue;
    }

    if (evalRecord.owns_governance === true || evalRecord.preserves_supermemory_contract !== true) {
      if (evalRecord.status !== "rejected_port") {
        errors.add("port_owns_governance");
      }
      continue;
    }

    if (
      evalRecord.candidate === "Graphiti" &&
      evalRecord.port_type === "temporal_graph_port" &&
      evalRecord.eval_result === "pass"
    ) {
      if (evalRecord.status !== "not_activated" || evalRecord.default_engine !== "Hindsight") {
        errors.add("unjustified_graphiti_activation");
      }
      continue;
    }

    if (
      evalRecord.candidate === "Memoria" &&
      evalRecord.port_type === "memory_versioning_port" &&
      evalRecord.eval_result === "pass"
    ) {
      if (
        evalRecord.status !== "not_activated" ||
        !hasAll(evalRecord.covered_by, ["snapshot_registry", "source_changes.jsonl", "hindsight_promotions.jsonl"])
      ) {
        errors.add("unjustified_memoria_activation");
      }
      continue;
    }

    if (
      evalRecord.status === "activated" &&
      evalRecord.eval_result !== "fail" &&
      evalRecord.operational_burden_proven !== true
    ) {
      errors.add("port_activation_without_trigger");
      continue;
    }

    if (evalRecord.status === "candidate_port") {
      if (evalRecord.eval_result !== "fail" || !hasValue(evalRecord.justification)) {
        errors.add("candidate_port_missing_justification");
      }
    }
  }

  return [...errors];
}

function verifyExpectedOutputs(fixture, assertions) {
  const expected = readJson("expected/answer-evidence.json");
  const valid = fixture.valid;
  const fixtureRecords = mapBy(list(valid, "engine_port_evals"), "eval_id");
  if (assertions.required_log_file && path.join(root, assertions.required_log_file) !== logPath) {
    fail(`required_log_file mismatch: ${assertions.required_log_file}`);
  }
  if (!fs.existsSync(logPath)) {
    fail(`missing required JSONL log: ${path.relative(root, logPath)}`);
    return;
  }
  const logRecords = mapBy(readJsonl(logPath), "eval_id");

  for (const evalId of assertions.required_eval_ids ?? []) {
    if (!fixtureRecords.has(evalId)) fail(`missing required fixture eval: ${evalId}`);
    if (!logRecords.has(evalId)) fail(`missing required JSONL eval: ${evalId}`);
  }

  for (const expectedDecision of expected.engine_port_decisions ?? []) {
    const fixtureRecord = fixtureRecords.get(expectedDecision.eval_id);
    const logRecord = logRecords.get(expectedDecision.eval_id);
    for (const actual of [fixtureRecord, logRecord]) {
      if (!actual) continue;
      for (const [key, expectedValue] of Object.entries(expectedDecision)) {
        if (JSON.stringify(actual[key]) !== JSON.stringify(expectedValue)) {
          fail(`${expectedDecision.eval_id} ${key} mismatch`);
        }
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
  const errors = validateEnginePortEvals(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateEnginePortEvals(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: engine port evals contract is valid`);
}
