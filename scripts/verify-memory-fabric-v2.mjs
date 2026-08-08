#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests/fixtures/memory-fabric-v2/acceptance.v1.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

export const MEMORY_FABRIC_V2_ACCEPTANCE = Object.freeze(Object.fromEntries(
  fixture.criteria.map((entry) => [entry.id, Object.freeze({ ...entry })])
));

function expectedIds() {
  return [
    ...Array.from({ length: 20 }, (_, index) => `WM-AC${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 12 }, (_, index) => `KG-AC${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 7 }, (_, index) => `AD-AC${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 3 }, (_, index) => `RT-AC${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 3 }, (_, index) => `IM-AC${String(index + 1).padStart(2, "0")}`)
  ].sort();
}

export function verifyMemoryFabricV2Matrix() {
  const failures = [];
  if (fixture.schema !== "supermemory.memory-fabric-v2-acceptance.v1") failures.push("schema_invalid");
  const actual = Object.keys(MEMORY_FABRIC_V2_ACCEPTANCE).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedIds())) failures.push("criteria_set_invalid");
  for (const entry of fixture.criteria) {
    if (!entry.proof || !entry.test_file || !entry.test_pattern) failures.push(`${entry.id}:evidence_invalid`);
    const testPath = path.join(root, entry.test_file);
    if (!fs.existsSync(testPath)) failures.push(`${entry.id}:test_missing`);
    else if (!fs.readFileSync(testPath, "utf8").includes(entry.test_pattern)) failures.push(`${entry.id}:pattern_missing`);
  }
  return {
    schema: fixture.schema,
    status: failures.length === 0 ? "pass" : "fail",
    total: expectedIds().length,
    covered: expectedIds().length - failures.length,
    failures,
    matrix: MEMORY_FABRIC_V2_ACCEPTANCE
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const report = verifyMemoryFabricV2Matrix();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}
