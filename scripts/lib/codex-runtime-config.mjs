import path from "node:path";

const LEGACY_SCHEMA = /^supermemory\.(?:codex|hook|mcp|app-server)-runtime\.v[12]$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function defaults() {
  return {
    schema: "supermemory.codex-runtime.v3",
    deployment: {
      strategy: "full",
      canary: false,
      progressive: false,
      activation: "disabled"
    },
    working_memory: {
      enabled: false,
      capacity_tokens: 100_000,
      retention_after_session_days: 7,
      map_target_tokens: 4_000,
      map_max_tokens: 8_000,
      startup_context_max_tokens: 2_000,
      compact_context_max_tokens: 8_000,
      open_default_tokens: 8_000,
      open_max_tokens: 20_000,
      max_complete_event_bytes: 524_288,
      offload: {
        enabled: false,
        fail_open: true,
        threshold_tokens: 12_000,
        allowed_tools: ["Bash"],
        require_reopen_verification: true
      }
    },
    memory_router: {
      enabled: false,
      default_strategy: "auto",
      working_timeout_ms: 150,
      graph_timeout_ms: 500,
      durable_timeout_ms: 1_500,
      max_hops: 3,
      hard_max_hops: 5,
      max_results: 20
    },
    knowledge_graph: {
      enabled: false,
      driver: "graphiti-neo4j",
      endpoint: null,
      token_file: null,
      ontology_mode: "core_plus_learned",
      ontology_shadow_min_support: 3
    },
    continuous_improvement: {
      enabled: false,
      on_session_end: true,
      event_batch_size: 25,
      extractor_profile: "server-default",
      verifier_profile: "server-independent",
      community_refresh_threshold: 100
    },
    admission: {
      mode: "legacy_manual",
      policy_version: "admission-v1.0.0",
      human_review_default: true,
      quarantine_categories: [
        "active_conflict",
        "restricted_permission",
        "high_impact_fact",
        "destructive_ontology_change"
      ]
    },
    migration: {
      source_schema: null,
      compatibility_flags_off: true,
      immutable_vault_rewrite: false
    }
  };
}

function merge(base, input) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(input ?? {})) {
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      result[key] && typeof result[key] === "object" && !Array.isArray(result[key])
    ) result[key] = merge(result[key], value);
    else result[key] = structuredClone(value);
  }
  return result;
}

function safeGraphEndpoint(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (
      url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function validate(config) {
  if (config.schema !== "supermemory.codex-runtime.v3") fail("runtime_config_schema_invalid");
  if (
    config.deployment?.strategy !== "full" || config.deployment.canary !== false ||
    config.deployment.progressive !== false
  ) fail("runtime_deployment_strategy_invalid");
  if (config.working_memory?.offload?.fail_open !== true) fail("runtime_offload_fail_open_required");
  if (
    !Number.isSafeInteger(config.working_memory?.capacity_tokens) ||
    config.working_memory.capacity_tokens < 8_000 || config.working_memory.capacity_tokens > 100_000 ||
    !Number.isSafeInteger(config.working_memory?.map_max_tokens) ||
    config.working_memory.map_max_tokens > 8_000
  ) fail("runtime_working_budget_invalid");
  if (
    !Number.isSafeInteger(config.memory_router?.max_hops) ||
    !Number.isSafeInteger(config.memory_router?.hard_max_hops) ||
    config.memory_router.max_hops < 1 || config.memory_router.hard_max_hops > 5 ||
    config.memory_router.max_hops > config.memory_router.hard_max_hops
  ) fail("runtime_graph_hops_invalid");
  if (config.knowledge_graph?.enabled) {
    if (
      !safeGraphEndpoint(config.knowledge_graph.endpoint) ||
      typeof config.knowledge_graph.token_file !== "string" ||
      !path.isAbsolute(config.knowledge_graph.token_file)
    ) fail("runtime_graph_binding_invalid");
  }
  if (config.deployment.activation === "full") {
    if (
      !config.working_memory.enabled || !config.memory_router.enabled ||
      !config.knowledge_graph.enabled || !config.continuous_improvement.enabled ||
      config.admission.mode !== "automatic" || config.admission.human_review_default !== false
    ) fail("runtime_full_activation_incomplete");
  }
  return Object.freeze(config);
}

export function normalizeCodexRuntimeConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("runtime_config_invalid");
  if (LEGACY_SCHEMA.test(input.schema ?? "")) {
    const compatible = defaults();
    compatible.migration.source_schema = input.schema;
    return validate(compatible);
  }
  if (input.schema !== "supermemory.codex-runtime.v3") fail("runtime_config_schema_invalid");
  return validate(merge(defaults(), input));
}

export function createDisabledCodexRuntimeV3() {
  return validate(defaults());
}

export function createFullDeploymentRuntimeV3({ graphEndpoint, graphTokenFile } = {}) {
  return normalizeCodexRuntimeConfig({
    schema: "supermemory.codex-runtime.v3",
    deployment: { activation: "full" },
    working_memory: { enabled: true, offload: { enabled: true } },
    memory_router: { enabled: true },
    knowledge_graph: {
      enabled: true,
      endpoint: graphEndpoint,
      token_file: graphTokenFile
    },
    continuous_improvement: { enabled: true },
    admission: { mode: "automatic", human_review_default: false },
    migration: {
      source_schema: "explicit_owner_migration",
      compatibility_flags_off: false,
      immutable_vault_rewrite: false
    }
  });
}
