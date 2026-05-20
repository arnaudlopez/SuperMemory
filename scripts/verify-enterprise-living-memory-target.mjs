#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const assertionsPath = path.join(
  root,
  "identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/assertions.json"
);

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

if (!fs.existsSync(assertionsPath)) {
  fail(`missing assertions fixture: ${assertionsPath}`);
  process.exit();
}

const assertions = JSON.parse(fs.readFileSync(assertionsPath, "utf8"));

if (assertions.target_status !== "spec_only") {
  fail(`expected target_status=spec_only got ${JSON.stringify(assertions.target_status)}`);
}

for (const relPath of assertions.target_required_files) {
  if (!fs.existsSync(path.join(root, relPath))) {
    fail(`missing target fixture file: ${relPath}`);
  }
}

for (const relPath of assertions.supporting_governance_files ?? []) {
  if (!fs.existsSync(path.join(root, relPath))) {
    fail(`missing supporting governance file: ${relPath}`);
  }
}

for (const item of assertions.target_must_contain) {
  if (!fs.existsSync(path.join(root, item.file))) {
    fail(`cannot check missing target file: ${item.file}`);
    continue;
  }
  const text = readText(item.file);
  if (!text.includes(item.text)) {
    fail(`${item.file} must contain ${JSON.stringify(item.text)}`);
  }
}

const targetCorpus = [
  "identity-vault/90_evals/cases/enterprise-living-memory-complete/input/scenario.md",
  "identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/final-state.md",
  "identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/target-structure.md"
]
  .filter((relPath) => fs.existsSync(path.join(root, relPath)))
  .map(readText)
  .join("\n");

for (const concept of assertions.required_concepts ?? []) {
  if (!targetCorpus.includes(concept)) {
    fail(`target fixture must cover concept ${JSON.stringify(concept)}`);
  }
}

if (!Array.isArray(assertions.future_required_files) || assertions.future_required_files.length < 5) {
  fail("future_required_files must list the implementation target files");
}

if (!Array.isArray(assertions.future_jsonl_assertions) || assertions.future_jsonl_assertions.length < 2) {
  fail("future_jsonl_assertions must include engine-port expectations");
}

if (!process.exitCode) {
  console.log(`PASS ${assertions.case_id}: target fixture is complete`);
}
