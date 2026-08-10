import assert from "node:assert/strict";
import test from "node:test";
import {
  createFullDeploymentRuntimeV6,
  createFullDeploymentRuntimeV7,
  migrateCodexRuntimeV6ToV7,
  normalizeCodexRuntimeConfig
} from "../scripts/lib/codex-runtime-config.mjs";

const GRAPH = { graphEndpoint: "http://127.0.0.1:8787", graphTokenFile: "/run/supermemory/graphd.token" };

test("runtime v7 activates one governed Hermes memory provider and native action connectors", () => {
  const runtime = createFullDeploymentRuntimeV7(GRAPH);
  assert.equal(runtime.schema, "supermemory.codex-runtime.v7");
  assert.deepEqual(runtime.deployment, { strategy: "full", canary: false, progressive: false, activation: "enabled" });
  assert.equal(runtime.personal_manager.enabled, true);
  assert.equal(runtime.personal_manager.memory_provider, "supermemory-fabric");
  assert.equal(runtime.personal_manager.direct_hindsight_provider, false);
  assert.equal(runtime.personal_manager.runtime_host, "home101");
  assert.equal(runtime.personal_manager.device_id, "device_home101");
  assert.equal(runtime.personal_manager.transport, "ssh_local_forward");
  assert.equal(runtime.personal_manager.endpoint, "http://127.0.0.1:18765");
  assert.equal(runtime.personal_manager.context_budget_tokens, 8_000);
  assert.equal(runtime.action_connectors.mode, "hermes_native");
  assert.equal(runtime.action_connectors.supermemory_reimplements_connectors, false);
  assert.equal(runtime.llm.provider_mode, "single");
  assert.equal(runtime.llm.provider, "openai-codex");
  assert.equal(runtime.llm.model, "gpt-5.6-luna");
  assert.equal(runtime.llm.fallback_provider, null);
  const openrouter = normalizeCodexRuntimeConfig({
    ...runtime,
    llm: { ...runtime.llm, provider: "openrouter", model: "openai/gpt-5.4" }
  });
  assert.equal(openrouter.llm.provider, "openrouter");
});

test("runtime v6 migrates additively and invalid provider combinations fail", () => {
  const migrated = migrateCodexRuntimeV6ToV7(createFullDeploymentRuntimeV6(GRAPH));
  assert.equal(migrated.migration.source_schema, "supermemory.codex-runtime.v6");
  assert.equal(migrated.migration.immutable_vault_rewrite, false);
  assert.throws(() => normalizeCodexRuntimeConfig({
    ...migrated,
    personal_manager: { ...migrated.personal_manager, direct_hindsight_provider: true }
  }), { message: "runtime_personal_manager_provider_invalid" });
  assert.throws(() => normalizeCodexRuntimeConfig({
    ...migrated,
    personal_manager: { ...migrated.personal_manager, runtime_host: "z2" }
  }), { message: "runtime_personal_manager_provider_invalid" });
  assert.throws(() => normalizeCodexRuntimeConfig({
    ...migrated,
    llm: { provider_mode: "multiple", fallback_provider: "other" }
  }), { message: "runtime_llm_provider_invalid" });
  assert.throws(() => normalizeCodexRuntimeConfig({
    ...migrated,
    llm: { ...migrated.llm, provider: "operator_selected" }
  }), { message: "runtime_llm_provider_invalid" });
});
