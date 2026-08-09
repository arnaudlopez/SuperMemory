import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("E2E-AC04/TR-AC09: production v5 is direct, single-provider and adds no retrieval service", () => {
  const runtime = JSON.parse(fs.readFileSync(new URL("../deploy/runtime/runtime-contract.production.json", import.meta.url), "utf8"));
  const stack = fs.readFileSync(new URL("../deploy/portainer/supermemory-ai-stack.yml", import.meta.url), "utf8");
  assert.equal(runtime.schema, "supermemory.codex-runtime.v6");
  assert.deepEqual(runtime.deployment, { strategy: "full", canary: false, progressive: false, activation: "enabled" });
  assert.equal(runtime.migration.compatibility_flags_off, true);
  assert.equal(runtime.hindsight.minimum_version, "0.9.0");
  assert.equal(runtime.topic_continuity.enabled, true);
  assert.equal(runtime.temporal_retrieval.enabled, true);
  assert.equal(runtime.authority.enabled, true);
  assert.match(stack, /gpt-5\.6-luna/);
  assert.doesNotMatch(stack, /openrouter|ollama|qwen|chronos|vector-store|vector_store/i);
  const services = [...stack.matchAll(/^  ([a-z][a-z0-9-]+):$/gm)].map((match) => match[1]);
  assert.deepEqual(services.sort(), [
    "hindsight", "neo4j", "neo4j-migrate", "supermemory-daemon", "supermemory-graphd", "supermemory-web"
  ]);
});
