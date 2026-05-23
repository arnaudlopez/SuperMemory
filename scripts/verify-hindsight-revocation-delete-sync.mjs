#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/hindsight-revocation-delete-sync");
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
  const sources = mapBy(list(valid, "captured_sources"), "source_id");
  const snapshots = mapBy(list(valid, "snapshots"), "snapshot_id");
  const memories = mapBy(list(valid, "validated_memories"), "memory_id");

  const source = sources.get(assertions.required_source_id);
  if (!source) fail(`missing captured source ${assertions.required_source_id}`);
  requireEqual(source?.status, "do_not_use", "captured source status");
  requireEqual(source?.revocation_reason, assertions.required_reason, "captured source revocation_reason");

  const snapshot = snapshots.get(assertions.required_snapshot_id);
  if (!snapshot) fail(`missing snapshot ${assertions.required_snapshot_id}`);
  requireEqual(snapshot?.source_id, assertions.required_source_id, "snapshot source_id");
  requireEqual(snapshot?.change_status, "revoked", "snapshot change_status");

  const memory = memories.get(assertions.required_memory_id);
  if (!memory) fail(`missing memory ${assertions.required_memory_id}`);
  requireEqual(memory?.status, "do_not_use", "memory status");
  requireEqual(memory?.review_status, "revoked", "memory review_status");
  requireEqual(memory?.revoke_from_hindsight, true, "explicit Hindsight revocation flag");
  requireEqual(memory?.document_id, assertions.required_document_id, "memory document_id");
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
  requireEqual(operation?.reason, assertions.required_reason, "operation reason");
  requireEqual(operation?.metadata?.source_id, assertions.required_source_id, "operation source_id");
  requireEqual(operation?.metadata?.snapshot_id, assertions.required_snapshot_id, "operation snapshot_id");
  requireEqual(operation?.metadata?.revocation_reason, assertions.required_reason, "operation revocation_reason");

  const deleteRequest = output.transport.requests.find((request) => request.operation === "delete");
  if (!deleteRequest) fail("missing mock delete request");
  requireEqual(deleteRequest?.method, "DELETE", "delete method");
  requireEqual(deleteRequest?.document_id, assertions.required_document_id, "delete document_id");
  requireEqual(deleteRequest?.path, assertions.required_delete_path, "delete path");
}

const fixture = readJson(fixturePath);
const assertions = readJson(assertionsPath);
verifyFixtureShape(fixture, assertions);
verifyCliOutput(runCli(), assertions);

if (!process.exitCode) {
  console.log("PASS hindsight-revocation-delete-sync: do_not_use revocation reaches mock Hindsight DELETE");
}
