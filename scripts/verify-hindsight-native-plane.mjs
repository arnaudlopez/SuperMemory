#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(path.join(
  root, "tests/fixtures/hindsight-native-plane/acceptance.v1.json"
), "utf8"));

export const HINDSIGHT_NATIVE_ACCEPTANCE = Object.freeze(Object.fromEntries(
  fixture.criteria.map((entry) => [entry.id, Object.freeze({ ...entry })])
));

export function verifyHindsightNativePlane() {
  const expected = Array.from({ length: 24 }, (_, index) => `HN-AC${String(index + 1).padStart(2, "0")}`).sort();
  const actual = Object.keys(HINDSIGHT_NATIVE_ACCEPTANCE).sort();
  const failures = [];
  if (fixture.schema !== "supermemory.hindsight-native-acceptance.v1") failures.push("schema_invalid");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push("criteria_set_invalid");
  for (const entry of fixture.criteria) {
    const target = path.join(root, entry.test_file);
    if (!entry.proof || !fs.existsSync(target)) failures.push(`${entry.id}:evidence_missing`);
    else if (!fs.readFileSync(target, "utf8").includes(entry.test_pattern)) failures.push(`${entry.id}:pattern_missing`);
  }
  return {
    schema: fixture.schema,
    status: failures.length === 0 ? "pass" : "fail",
    total: expected.length,
    covered: expected.length - failures.length,
    failures,
    matrix: HINDSIGHT_NATIVE_ACCEPTANCE
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const report = verifyHindsightNativePlane();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}
