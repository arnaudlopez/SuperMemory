#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/ci-regression-suite");
const completeCaseRoot = path.join(root, "identity-vault/90_evals/cases/enterprise-living-memory-complete");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(caseRoot, relativePath), "utf8"));
}

function readCompleteJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(completeCaseRoot, relativePath), "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? "inherit"
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function mustContain(file, text) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    fail(`missing file: ${file}`);
    return;
  }
  const content = fs.readFileSync(fullPath, "utf8");
  if (!content.includes(text)) fail(`${file} must contain ${JSON.stringify(text)}`);
}

function verifyWorkflow(fixture, assertions) {
  const workflow = fixture.workflow;
  if (workflow.file !== assertions.required_workflow_file) {
    fail("workflow file mismatch");
    return;
  }
  mustContain(workflow.file, "push:");
  mustContain(workflow.file, "pull_request:");
  mustContain(workflow.file, assertions.required_workflow_command);
}

function verifyInvalidCaseCoverage(assertions) {
  const completeFixture = readCompleteJson("actual/fixture.json");
  const completeAssertions = readCompleteJson("expected/complete-assertions.json");
  const expectedErrors = new Set([
    ...Object.values(completeAssertions.expected_errors ?? {}),
    ...(completeFixture.invalid_cases ?? []).map((item) => item.expected_error)
  ]);
  const localRegressionErrors = new Set([
    detectForbiddenActiveRecallRegression(completeFixture.valid)
  ].filter(Boolean));

  for (const expectedError of assertions.required_complete_case_errors ?? []) {
    if (!expectedErrors.has(expectedError) && !localRegressionErrors.has(expectedError)) {
      fail(`complete Golden Case must include invalid regression ${expectedError}`);
    }
  }
}

function detectForbiddenActiveRecallRegression(validFixture) {
  const forbidden = new Set(
    (validFixture.validated_memories ?? [])
      .filter((memory) => memory.status === "do_not_use" || memory.active_recall_allowed === false)
      .map((memory) => memory.memory_id)
  );
  const recall = (validFixture.recall_results ?? []).find((item) => item.status === "active");
  const forbiddenId = [...forbidden][0];
  if (!recall || !forbiddenId) return null;

  const mutatedRecall = {
    ...recall,
    used_memory_ids: [...(recall.used_memory_ids ?? []), forbiddenId]
  };
  if ((mutatedRecall.used_memory_ids ?? []).some((memoryId) => forbidden.has(memoryId))) {
    return "forbidden_active_recall";
  }
  return null;
}

function verifyPromptfooOptional(fixture, assertions) {
  if (fixture.promptfoo?.status !== assertions.promptfoo_status) {
    fail("promptfoo status mismatch");
  }
  if (fixture.promptfoo?.required_dependency !== false || fixture.promptfoo?.required_ci_command !== false) {
    fail("promptfoo must remain optional");
  }
  if (fs.existsSync(path.join(root, "package.json"))) {
    const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
    if (packageJson.includes("promptfoo")) fail("promptfoo must not be a required package dependency");
  }
}

const fixture = readJson("input/fixture.json");
const assertions = readJson("expected/assertions.json");

for (const command of assertions.required_commands ?? []) {
  if (!fixture.critical_commands?.includes(command)) {
    fail(`missing critical command in fixture: ${command}`);
  }
}

run("node", ["scripts/verify-supermemory-specs.mjs"], {
  env: { SUPERMEMORY_SKIP_CI_REGRESSION_SUITE: "1" }
});
run("git", ["diff", "--check"]);

verifyWorkflow(fixture, assertions);
verifyInvalidCaseCoverage(assertions);
verifyPromptfooOptional(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: CI regression suite is valid`);
}
