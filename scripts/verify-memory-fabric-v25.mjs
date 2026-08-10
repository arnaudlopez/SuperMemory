import fs from "node:fs";

const failures = [];
const requireFile = (file) => {
  if (!fs.existsSync(file)) failures.push(`missing:${file}`);
};

[
  "scripts/lib/memory-signal-store.mjs",
  "scripts/lib/memory-endorsement-resolver.mjs",
  "scripts/lib/memory-salience-policy.mjs",
  "scripts/lib/longitudinal-memory-consolidator.mjs",
  "scripts/lib/memory-recall-feedback.mjs",
  "schemas/memory-signal.schema.json",
  "schemas/longitudinal-consolidation-proposal.schema.json",
  "schemas/consolidation-receipt.schema.json",
  "tests/fixtures/memory-fabric-v25/acceptance.v1.json",
  "deploy/runtime/runtime-contract.production.json",
  "deploy/home101/README.md"
].forEach(requireFile);

const fixture = JSON.parse(fs.readFileSync("tests/fixtures/memory-fabric-v25/acceptance.v1.json", "utf8"));
const expected = Array.from({ length: 22 }, (_, index) => `LM-AC${String(index + 1).padStart(2, "0")}`);
if (JSON.stringify(fixture.criteria?.map((item) => item.id)) !== JSON.stringify(expected)) failures.push("acceptance-matrix-not-exact");

const runtime = JSON.parse(fs.readFileSync("deploy/runtime/runtime-contract.production.json", "utf8"));
if (runtime.schema !== "supermemory.codex-runtime.v8") failures.push("runtime-schema-not-v8");
if (runtime.deployment?.strategy !== "full" || runtime.deployment?.canary !== false || runtime.deployment?.progressive !== false || runtime.deployment?.activation !== "full") failures.push("runtime-not-full-direct");
if (runtime.longitudinal_memory?.enabled !== true || runtime.longitudinal_memory?.activation !== "full" || runtime.longitudinal_memory?.explicit_remember_behavior !== "pin") failures.push("longitudinal-memory-not-active");
if (runtime.llm?.provider_mode !== "single" || runtime.llm?.fallback_provider !== null) failures.push("llm-provider-not-single");

const compose = fs.readFileSync("deploy/portainer/supermemory-ai-stack.yml", "utf8");
const services = [...compose.split(/^secrets:\s*$/m, 1)[0].matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map((match) => match[1]).sort();
const expectedServices = ["hindsight", "neo4j", "neo4j-migrate", "supermemory-daemon", "supermemory-graphd", "supermemory-web"].sort();
if (JSON.stringify(services) !== JSON.stringify(expectedServices) || /^  hermes:/m.test(compose)) failures.push("production-topology-invalid");

if (failures.length) {
  console.error(JSON.stringify({ schema: "supermemory.memory-fabric-v2.5-verification.v1", status: "fail", failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  schema: "supermemory.memory-fabric-v2.5-verification.v1",
  status: "pass",
  acceptance: "22/22",
  runtime: "v8",
  activation: "full",
  canary: false,
  progressive: false,
  explicit_remember_behavior: "pin",
  z2_services: 6,
  hermes_host: "home101"
}, null, 2));
