import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeCodexRuntimeConfig } from "../scripts/lib/codex-runtime-config.mjs";

const production = JSON.parse(fs.readFileSync(new URL("../deploy/runtime/runtime-contract.production.json", import.meta.url), "utf8"));

test("runtime v8 fully activates bounded longitudinal memory with one provider", () => {
  assert.equal(production.schema, "supermemory.codex-runtime.v8");
  assert.deepEqual(production.deployment, { strategy: "full", canary: false, progressive: false, activation: "full" });
  assert.deepEqual(production.longitudinal_memory, {
    enabled: true,
    activation: "full",
    canary: false,
    progressive: false,
    worker_concurrency: 1,
    max_batch_episodes: 50,
    max_cluster_episodes: 24,
    max_cluster_tokens: 32000,
    daily_maintenance: true,
    session_close_consolidation: true,
    salience_policy: "salience-v1",
    endorsement_policy: "endorsement-v1",
    decay_policy: "class-aware-v1",
    explicit_remember_behavior: "pin",
    authority: "canonical-vault-first"
  });
  assert.equal(production.llm.provider, "openai-codex");
  assert.equal(production.llm.model, "gpt-5.6-luna");
  assert.equal(production.llm.fallback_provider, null);
  assert.equal(normalizeCodexRuntimeConfig(production).schema, "supermemory.codex-runtime.v8");
});

test("v7 migrates additively and invalid longitudinal topology fails closed", () => {
  const v7 = structuredClone(production);
  v7.schema = "supermemory.codex-runtime.v7";
  delete v7.longitudinal_memory;
  const migrated = normalizeCodexRuntimeConfig(v7);
  assert.equal(migrated.schema, "supermemory.codex-runtime.v8");
  assert.equal(migrated.longitudinal_memory.enabled, true);
  for (const patch of [
    { worker_concurrency: 2 },
    { max_cluster_episodes: 25 },
    { explicit_remember_behavior: "required_command" },
    { authority: "hindsight-first" },
    { canary: true }
  ]) {
    const invalid = structuredClone(production);
    Object.assign(invalid.longitudinal_memory, patch);
    assert.throws(() => normalizeCodexRuntimeConfig(invalid), /longitudinal|runtime/);
  }
});
