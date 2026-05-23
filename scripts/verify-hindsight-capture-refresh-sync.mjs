#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/hindsight-capture-refresh-sync");
const fixturePath = path.join(caseRoot, "input/fixture.json");
const assertionsPath = path.join(caseRoot, "expected/assertions.json");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function list(input, key) {
  return Array.isArray(input?.[key]) ? input[key] : [];
}

function mapBy(items, key) {
  return new Map(items.map((item) => [item[key], item]).filter(([value]) => Boolean(value)));
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: expected ${expected}, got ${actual}`);
  }
}

function requireIncludes(items, expected, message) {
  if (!Array.isArray(items) || !items.includes(expected)) {
    fail(`${message}: expected ${expected}`);
  }
}

function verifyFixtureShape(fixture, assertions) {
  const valid = fixture.valid;
  const sources = mapBy(list(valid, "captured_sources"), "source_id");
  const snapshots = mapBy(list(valid, "snapshots"), "snapshot_id");
  const memories = mapBy(list(valid, "validated_memories"), "memory_id");

  const source = sources.get(assertions.required_source_id);
  if (!source) fail(`missing captured source ${assertions.required_source_id}`);
  requireEqual(source?.status, "raw_captured", "captured source status");
  requireEqual(source?.connector_id, assertions.required_connector_id, "connector_id");
  requireEqual(source?.connector_scope, assertions.required_connector_scope, "connector_scope");
  requireEqual(source?.source_path, assertions.required_source_path, "source_path");
  requireEqual(source?.source_kind, assertions.required_source_kind, "source_kind");
  requireEqual(source?.capture_method, assertions.required_capture_method, "capture_method");
  requireEqual(source?.active_snapshot_id, assertions.required_snapshot_id, "active_snapshot_id");

  const snapshot = snapshots.get(assertions.required_snapshot_id);
  if (!snapshot) fail(`missing snapshot ${assertions.required_snapshot_id}`);
  requireEqual(snapshot?.source_id, assertions.required_source_id, "snapshot source_id");
  requireEqual(snapshot?.immutable, true, "snapshot immutable");
  requireEqual(snapshot?.freshness, "fresh", "snapshot freshness");

  const memory = memories.get(assertions.required_memory_id);
  if (!memory) fail(`missing memory ${assertions.required_memory_id}`);
  requireEqual(memory?.status, "active", "memory status");
  requireEqual(memory?.review_status, "approved", "memory review_status");
  requireEqual(memory?.promote_to_hindsight, true, "explicit promotion flag");
  requireEqual(memory?.source_id, assertions.required_source_id, "memory source_id");
  requireEqual(memory?.snapshot_id, assertions.required_snapshot_id, "memory snapshot_id");
}

function runCli() {
  return spawnSync("node", [
    "scripts/hindsight-promote.mjs",
    "--input",
    fixturePath,
    "--live",
    "--mock-transport",
    "--json"
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "sk-test-secret",
      HINDSIGHT_BANK_ID: "bank-test",
      HINDSIGHT_BASE_URL: "https://example.invalid"
    }
  });
}

function verifyCliOutput(result, assertions) {
  if (result.status !== 0) {
    fail(`CLI failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    return;
  }
  if (result.stdout.includes("sk-test-secret") || result.stderr.includes("sk-test-secret")) {
    fail("CLI leaked Hindsight API key");
  }

  const output = JSON.parse(result.stdout);
  requireEqual(output.generated_from, assertions.required_generated_from, "generated_from");
  requireEqual(output.network_writes, false, "network_writes");
  requireEqual(output.transport?.mode, "mock", "transport mode");
  requireEqual(output.transport?.result?.requests_sent, assertions.required_mock_request_count, "mock request count");

  const operation = output.operations.find((item) => item.memory_id === assertions.required_memory_id);
  if (!operation) fail(`missing operation for ${assertions.required_memory_id}`);
  requireEqual(operation?.operation, assertions.required_operation, "operation");
  requireEqual(operation?.document_id, assertions.required_document_id, "operation document_id");
  requireEqual(operation?.metadata?.source_id, assertions.required_source_id, "operation source_id");
  requireEqual(operation?.metadata?.snapshot_id, assertions.required_snapshot_id, "operation snapshot_id");
  requireEqual(operation?.metadata?.connector_id, assertions.required_connector_id, "operation connector_id");
  requireEqual(operation?.metadata?.connector_scope, assertions.required_connector_scope, "operation connector_scope");
  requireEqual(operation?.metadata?.source_path, assertions.required_source_path, "operation source_path");
  requireEqual(operation?.metadata?.source_kind, assertions.required_source_kind, "operation source_kind");
  requireEqual(operation?.metadata?.capture_method, assertions.required_capture_method, "operation capture_method");
  requireIncludes(operation?.tags, `source_kind:${assertions.required_source_kind}`, "operation source_kind tag");

  const retainRequest = output.transport.requests.find((request) => request.operation === assertions.required_operation);
  if (!retainRequest) fail(`missing mock ${assertions.required_operation} request`);
  const item = retainRequest?.body?.items?.[0];
  requireEqual(item?.document_id, assertions.required_document_id, "request document_id");
  requireEqual(item?.metadata?.connector_id, assertions.required_connector_id, "request connector_id");
  requireEqual(item?.metadata?.connector_scope, assertions.required_connector_scope, "request connector_scope");
  requireEqual(item?.metadata?.source_path, assertions.required_source_path, "request source_path");
  requireEqual(item?.metadata?.source_kind, assertions.required_source_kind, "request source_kind");
  requireIncludes(item?.tags, `source_kind:${assertions.required_source_kind}`, "request source_kind tag");

  const recallRequest = output.transport.requests.find((request) => request.operation === "recall");
  if (!recallRequest) fail("missing mock recall request");
  requireEqual(recallRequest?.policy_id, assertions.required_recall_policy_id, "recall policy_id");
}

const fixture = readJson(fixturePath);
const assertions = readJson(assertionsPath);
verifyFixtureShape(fixture, assertions);
verifyCliOutput(runCli(), assertions);

if (!process.exitCode) {
  console.log("PASS hindsight-capture-refresh-sync: captured source metadata reaches mock Hindsight transport");
}
