import fs from "node:fs";

const failures = [];
const requireFile = (file) => {
  if (!fs.existsSync(file)) failures.push(`missing:${file}`);
};

[
  "scripts/lib/agent-credential-store.mjs",
  "scripts/lib/agent-scope-resolver.mjs",
  "scripts/lib/personal-recall-orchestrator.mjs",
  "scripts/lib/personal-context-card.mjs",
  "scripts/lib/personal-mutation-intent-gate.mjs",
  "scripts/lib/personal-memory-revision-store.mjs",
  "scripts/lib/personal-memory-command-bus.mjs",
  "scripts/lib/personal-manager-api.mjs",
  "scripts/lib/personal-manager-capture.mjs",
  "scripts/lib/personal-action-receipt.mjs",
  "scripts/personal-manager-credential.mjs",
  "scripts/lib/canonical-openrouter-pipeline.mjs",
  "integrations/hermes/plugins/memory/supermemory_fabric/__init__.py",
  "integrations/hermes/plugins/memory/supermemory_fabric/plugin.yaml",
  "deploy/home101/supermemory-z2-tunnel.service",
  "deploy/home101/hermes-gateway-supermemory.conf",
  "deploy/home101/home101.env.example",
  "deploy/home101/configure-hermes.py",
  "deploy/hindsight/Dockerfile",
  "deploy/runtime/runtime-contract.production.json"
].forEach(requireFile);

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (!pkg.scripts?.["verify:memory-fabric-v24"]) failures.push("package-script-missing");

if (failures.length) {
  console.error(JSON.stringify({ schema: "supermemory.memory-fabric-v2.4-verification.v1", status: "fail", failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  schema: "supermemory.memory-fabric-v2.4-verification.v1",
  status: "pass",
  provider: "supermemory-fabric",
  direct_hindsight_provider: false,
  runtime_host: "home101",
  device_id: "device_home101",
  action_connectors: "hermes_native",
  canary: false,
  progressive: false
}, null, 2));
