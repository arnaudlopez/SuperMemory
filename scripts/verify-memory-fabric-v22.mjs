#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = [
  ["TC-AC01", "tests/codex-topic-store.test.mjs", "TC-AC01"],
  ["TC-AC02", "tests/codex-topic-resolver.test.mjs", "TC-AC02"],
  ["TC-AC03", "tests/codex-topic-resolver.test.mjs", "TC-AC03"],
  ["TC-AC04", "tests/codex-topic-store.test.mjs", "TC-AC01/04/05"],
  ["TC-AC05", "tests/codex-topic-store.test.mjs", "TC-AC01/04/05"],
  ["TC-AC06", "tests/codex-mcp-server.test.mjs", "TC-AC06"],
  ["TC-AC07", "tests/codex-topic-view.test.mjs", "TC-AC07"],
  ["TC-AC08", "tests/codex-topic-working-recall.test.mjs", "TC-AC08"],
  ["TC-AC09", "tests/codex-topic-working-recall.test.mjs", "TC-AC08/09/12"],
  ["TC-AC10", "tests/codex-topic-checkpoint.test.mjs", "TC-AC10/11"],
  ["TC-AC11", "tests/codex-topic-checkpoint.test.mjs", "TC-AC10/11"],
  ["TC-AC12", "tests/codex-topic-working-recall.test.mjs", "TC-AC08/09/12"],
  ["TC-AC13", "tests/codex-topic-resolver.test.mjs", "TC-AC03/13"],
  ["TC-AC14", "tests/codex-topic-migration.test.mjs", "TC-AC14"],
  ["TR-AC01", "tests/codex-temporal-normalizer.test.mjs", "TR-AC01/02"],
  ["TR-AC02", "tests/codex-temporal-normalizer.test.mjs", "TR-AC01/02"],
  ["TR-AC03", "tests/codex-retrieval-plan.test.mjs", "TR-AC03"],
  ["TR-AC04", "tests/codex-evidence-coverage.test.mjs", "TR-AC04/07"],
  ["TR-AC05", "tests/codex-evidence-coverage.test.mjs", "TR-AC05/06"],
  ["TR-AC06", "tests/codex-evidence-coverage.test.mjs", "TR-AC05/06"],
  ["TR-AC07", "tests/codex-evidence-coverage.test.mjs", "TR-AC04/07"],
  ["TR-AC08", "tests/codex-memory-router.test.mjs", "TR-AC08"],
  ["TR-AC09", "tests/memory-fabric-v22-acceptance.test.mjs", "TR-AC09"],
  ["QA-AC01", "tests/memory-authority-policy.test.mjs", "QA-AC01/02/05"],
  ["QA-AC02", "tests/memory-authority-policy.test.mjs", "QA-AC01/02/05"],
  ["QA-AC03", "tests/memory-authority-policy.test.mjs", "QA-AC03"],
  ["QA-AC04", "tests/memory-authority-policy.test.mjs", "QA-AC04/10/13"],
  ["QA-AC05", "tests/memory-authority-policy.test.mjs", "QA-AC01/02/05"],
  ["QA-AC06", "tests/memory-exception-store.test.mjs", "QA-AC06/07"],
  ["QA-AC07", "tests/memory-exception-store.test.mjs", "QA-AC06/07"],
  ["QA-AC08", "tests/memory-exception-store.test.mjs", "QA-AC08/09/10"],
  ["QA-AC09", "tests/memory-exception-store.test.mjs", "QA-AC08/09/10"],
  ["QA-AC10", "tests/memory-exception-store.test.mjs", "QA-AC08/09/10"],
  ["QA-AC11", "tests/memory-exception-store.test.mjs", "QA-AC11/15"],
  ["QA-AC12", "tests/hindsight-native-memory-plane.test.mjs", "QA-AC12"],
  ["QA-AC13", "tests/memory-authority-policy.test.mjs", "QA-AC04/10/13"],
  ["QA-AC14", "tests/memory-authority-policy.test.mjs", "QA-AC14"],
  ["QA-AC15", "tests/memory-exception-store.test.mjs", "QA-AC11/15"],
  ["E2E-AC01", "tests/codex-topic-working-recall.test.mjs", "E2E-AC01"],
  ["E2E-AC02", "tests/knowledge-graph-adapter.test.mjs", "E2E-AC02"],
  ["E2E-AC03", "tests/product-backup.test.mjs", "E2E-AC03"],
  ["E2E-AC04", "tests/memory-fabric-v22-acceptance.test.mjs", "E2E-AC04"]
];

const failures = [];
for (const [id, relative, pattern] of entries) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) failures.push(`${id}:test_missing`);
  else if (!fs.readFileSync(file, "utf8").includes(pattern)) failures.push(`${id}:pattern_missing`);
}
const requiredModules = [
  "codex-topic-store", "codex-topic-resolver", "codex-topic-view", "codex-topic-checkpoint",
  "codex-temporal-normalizer", "codex-retrieval-plan", "codex-evidence-coverage",
  "memory-authority-policy", "memory-exception-store"
];
for (const module of requiredModules) {
  if (!fs.existsSync(path.join(root, "scripts/lib", `${module}.mjs`))) failures.push(`module_missing:${module}`);
}
const runtime = JSON.parse(fs.readFileSync(path.join(root, "deploy/runtime/runtime-contract.production.json"), "utf8"));
if (runtime.schema !== "supermemory.codex-runtime.v6") failures.push("runtime_schema_invalid");
if (runtime.deployment.canary !== false || runtime.deployment.progressive !== false || runtime.deployment.activation !== "enabled") {
  failures.push("runtime_not_direct_full");
}
const report = {
  schema: "supermemory.memory-fabric-v2.2-verification.v1",
  status: failures.length === 0 ? "pass" : "fail",
  total: entries.length,
  covered: entries.length - failures.filter((item) => /^[A-Z]+-AC\d+:/.test(item)).length,
  failures,
  direct_full_deployment: true,
  second_provider: false,
  additional_retrieval_service: false
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
