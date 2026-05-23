#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/hindsight-source-change-sync");
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

function verifyFixtureShape(fixture, assertions) {
  const valid = fixture.valid;
  const sources = mapBy(list(valid, "sources"), "source_id");
  const snapshots = mapBy(list(valid, "snapshots"), "snapshot_id");
  const memories = mapBy(list(valid, "validated_memories"), "memory_id");

  const source = sources.get(assertions.required_source_id);
  if (!source) fail(`missing source ${assertions.required_source_id}`);
  requireEqual(source?.status, "changed", "source status");
  requireEqual(source?.previous_snapshot_id, assertions.required_t0_snapshot_id, "source previous_snapshot_id");
  requireEqual(source?.active_snapshot_id, assertions.required_t1_snapshot_id, "source active_snapshot_id");

  const t0 = snapshots.get(assertions.required_t0_snapshot_id);
  const t1 = snapshots.get(assertions.required_t1_snapshot_id);
  if (!t0) fail(`missing t0 snapshot ${assertions.required_t0_snapshot_id}`);
  if (!t1) fail(`missing t1 snapshot ${assertions.required_t1_snapshot_id}`);
  requireEqual(t1?.previous_snapshot_id, assertions.required_t0_snapshot_id, "t1 previous_snapshot_id");

  const t0Memory = memories.get(assertions.required_t0_memory_id);
  const t1Memory = memories.get(assertions.required_t1_memory_id);
  if (!t0Memory) fail(`missing t0 memory ${assertions.required_t0_memory_id}`);
  if (!t1Memory) fail(`missing t1 memory ${assertions.required_t1_memory_id}`);
  requireEqual(t0Memory?.status, "needs_review", "t0 memory status");
  requireEqual(t1Memory?.status, "active", "t1 memory status");
  requireEqual(t1Memory?.review_status, "approved", "t1 memory review_status");
  requireEqual(t1Memory?.promote_to_hindsight, true, "t1 explicit Hindsight promotion flag");
  requireEqual(t1Memory?.document_id, assertions.required_document_id, "t1 stable document_id");
  requireEqual(t1Memory?.supersedes_memory_id, assertions.required_t0_memory_id, "t1 supersedes_memory_id");
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
  requireEqual(output.transport?.result?.status, "mocked", "transport status");
  requireEqual(output.transport?.result?.requests_sent, assertions.required_mock_request_count, "mock request count");

  const operation = output.operations.find((item) => item.memory_id === assertions.required_t1_memory_id);
  if (!operation) fail(`missing operation for ${assertions.required_t1_memory_id}`);
  requireEqual(operation?.operation, assertions.required_operation, "operation");
  requireEqual(operation?.document_id, assertions.required_document_id, "operation document_id");
  requireEqual(operation?.metadata?.snapshot_id, assertions.required_t1_snapshot_id, "operation snapshot_id");
  requireEqual(operation?.metadata?.previous_snapshot_id, assertions.required_t0_snapshot_id, "operation previous_snapshot_id");
  requireEqual(operation?.metadata?.replaces_memory_id, assertions.required_t0_memory_id, "operation replaces_memory_id");
  requireEqual(operation?.metadata?.source_version, assertions.required_t1_snapshot_id, "operation source_version");

  const retainRequest = output.transport.requests.find((request) => request.operation === assertions.required_operation);
  if (!retainRequest) fail(`missing mock ${assertions.required_operation} request`);
  requireEqual(retainRequest?.method, "POST", "retain/upsert method");
  requireEqual(retainRequest?.body?.items?.[0]?.document_id, assertions.required_document_id, "request document_id");
  requireEqual(retainRequest?.body?.items?.[0]?.metadata?.snapshot_id, assertions.required_t1_snapshot_id, "request snapshot_id");
  requireEqual(retainRequest?.body?.items?.[0]?.metadata?.replaces_memory_id, assertions.required_t0_memory_id, "request replaces_memory_id");

  const recallRequest = output.transport.requests.find((request) => request.operation === "recall");
  if (!recallRequest) fail("missing mock recall request");
  requireEqual(recallRequest?.policy_id, assertions.required_recall_policy_id, "recall policy_id");
}

const fixture = readJson(fixturePath);
const assertions = readJson(assertionsPath);
verifyFixtureShape(fixture, assertions);
verifyCliOutput(runCli(), assertions);

if (!process.exitCode) {
  console.log("PASS hindsight-source-change-sync: source-change sync fixture reaches mock Hindsight transport");
}
