#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const assertionsPath = path.join(root, "identity-vault/90_evals/cases/acme-meeting-complete/expected/assertions.json");

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

for (const relPath of assertions.required_files) {
  if (!fs.existsSync(path.join(root, relPath))) {
    fail(`missing required file: ${relPath}`);
  }
}

for (const item of assertions.must_contain) {
  if (!fs.existsSync(path.join(root, item.file))) {
    fail(`cannot check missing file: ${item.file}`);
    continue;
  }
  const text = readText(item.file);
  if (!text.includes(item.text)) {
    fail(`${item.file} must contain ${JSON.stringify(item.text)}`);
  }
}

for (const item of assertions.forbidden_text) {
  if (!fs.existsSync(path.join(root, item.file))) {
    continue;
  }
  const text = readText(item.file);
  if (text.includes(item.text)) {
    fail(`${item.file} must not contain ${JSON.stringify(item.text)}`);
  }
}

for (const item of assertions.jsonl_assertions) {
  if (!fs.existsSync(path.join(root, item.file))) {
    fail(`missing jsonl file: ${item.file}`);
    continue;
  }
  const rows = readText(item.file)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`${item.file}:${index + 1} is not valid JSON: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);
  const row = rows.find((candidate) => candidate.id === item.id);
  if (!row) {
    fail(`${item.file} missing signal id ${item.id}`);
    continue;
  }
  for (const [key, expected] of Object.entries(item)) {
    if (key === "file" || key === "id") continue;
    if (row[key] !== expected) {
      fail(`${item.file} ${item.id} expected ${key}=${JSON.stringify(expected)} got ${JSON.stringify(row[key])}`);
    }
  }
}

if (!process.exitCode) {
  console.log(`PASS ${assertions.case_id}: ${assertions.description}`);
}
