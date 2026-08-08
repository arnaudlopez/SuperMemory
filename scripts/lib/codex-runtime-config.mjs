import path from "node:path";

const LEGACY_SCHEMA = /^supermemory\.(?:codex|hook|mcp|app-server)-runtime\.v[123]$/;
const RUNTIME_V4 = "supermemory.codex-runtime.v4";
const RUNTIME_V5 = "supermemory.codex-runtime.v5";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function defaults(schema = RUNTIME_V5) {
  const config = {
    schema,
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
    topic_continuity: {
      enabled: false,
      working_view_capacity_tokens: 100_000,
      auto_bind_threshold: 0.90,
      auto_bind_margin: 0.25,
      semantic_link_mode: "suggest_only",
      checkpoint_on_compaction: true,
      checkpoint_on_session_end: true,
      reflect_enrichment: true
    },
    temporal_retrieval: {
      enabled: false,
      plan_schema: "supermemory.retrieval-plan.v1",
      max_rounds: 3,
      repair_intents: ["current_state", "temporal_range", "aggregation", "preference", "multi_hop"],
      max_ms: 5_000,
      max_results: 1_000,
      max_tokens: 12_000,
      abstain_on_incomplete_coverage: true
    },
    authority: {
      enabled: false,
      mode: "quiet",
      policy_version: "quiet-authority-v1.0.0",
      routine_user_prompts: false,
      interrupt_only_at_action_boundary: true,
      proactive_notifications: false,
      visible_exception_min_age_ms: 86_400_000
    },
    knowledge_graph: {
      enabled: false,
      driver: "graphd-neo4j",
      endpoint: null,
      token_file: null,
      ontology_mode: "core_plus_learned",
      ontology_shadow_min_support: 3
    },
    hindsight: {
      enabled: false,
      minimum_version: "0.9.0",
      bank_strategy: "workspace",
      async_retain: true,
      observations: {
        enabled: true,
        auto_consolidation: false,
        require_source_facts: true
      },
      recall: {
        temporal: true,
        graph: true,
        reranking: true
      },
      reflect: {
        enabled: false,
        exclude_mental_models: true,
        fail_on_unvalidated_fact: true
      },
      operations: {
        poll_interval_ms: 500,
        timeout_ms: 120_000,
        max_retries: 3
      }
    },
    continuous_improvement: {
      enabled: false,
      canonical_worker: "local",
      learned_plane: "hindsight-native",
      on_session_end: true,
      extractor_profile: "server-default",
      verifier_profile: "server-independent"
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
  if (schema === RUNTIME_V4) {
    delete config.topic_continuity;
    delete config.temporal_retrieval;
    delete config.authority;
  }
  return config;
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
  if (![RUNTIME_V4, RUNTIME_V5].includes(config.schema)) fail("runtime_config_schema_invalid");
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
      config.knowledge_graph.driver !== "graphd-neo4j" ||
      !safeGraphEndpoint(config.knowledge_graph.endpoint) ||
      typeof config.knowledge_graph.token_file !== "string" ||
      !path.isAbsolute(config.knowledge_graph.token_file)
    ) fail("runtime_graph_binding_invalid");
  }
  if (
    config.hindsight?.minimum_version !== "0.9.0" ||
    config.hindsight?.bank_strategy !== "workspace" ||
    config.hindsight?.async_retain !== true ||
    config.hindsight?.observations?.enabled !== true ||
    config.hindsight?.observations?.auto_consolidation !== false ||
    config.hindsight?.observations?.require_source_facts !== true ||
    config.hindsight?.recall?.temporal !== true ||
    config.hindsight?.recall?.graph !== true ||
    config.hindsight?.recall?.reranking !== true ||
    config.hindsight?.reflect?.exclude_mental_models !== true ||
    config.hindsight?.reflect?.fail_on_unvalidated_fact !== true
  ) fail("runtime_hindsight_contract_invalid");
  if (config.schema === RUNTIME_V5) {
    if (
      config.topic_continuity?.working_view_capacity_tokens !== 100_000 ||
      config.topic_continuity?.semantic_link_mode !== "suggest_only" ||
      config.topic_continuity?.auto_bind_threshold < 0.5 || config.topic_continuity.auto_bind_threshold > 1 ||
      config.topic_continuity?.auto_bind_margin < 0 || config.topic_continuity.auto_bind_margin > 1
    ) fail("runtime_topic_contract_invalid");
    if (
      config.temporal_retrieval?.plan_schema !== "supermemory.retrieval-plan.v1" ||
      !Number.isSafeInteger(config.temporal_retrieval?.max_rounds) || config.temporal_retrieval.max_rounds < 1 ||
      config.temporal_retrieval.max_rounds > 3 || config.temporal_retrieval.abstain_on_incomplete_coverage !== true ||
      !Number.isSafeInteger(config.temporal_retrieval.max_ms) || config.temporal_retrieval.max_ms < 100 || config.temporal_retrieval.max_ms > 30_000 ||
      !Number.isSafeInteger(config.temporal_retrieval.max_results) || config.temporal_retrieval.max_results < 1 || config.temporal_retrieval.max_results > 10_000 ||
      !Number.isSafeInteger(config.temporal_retrieval.max_tokens) || config.temporal_retrieval.max_tokens < 256 || config.temporal_retrieval.max_tokens > 50_000
    ) fail("runtime_temporal_retrieval_invalid");
    if (
      config.authority?.mode !== "quiet" || config.authority?.routine_user_prompts !== false ||
      config.authority?.interrupt_only_at_action_boundary !== true || config.authority?.proactive_notifications !== false ||
      !Number.isSafeInteger(config.authority.visible_exception_min_age_ms) || config.authority.visible_exception_min_age_ms < 0
    ) fail("runtime_authority_contract_invalid");
  }
  if (config.deployment.activation === "full") {
    if (
      !config.working_memory.enabled || !config.memory_router.enabled ||
      !config.knowledge_graph.enabled || !config.hindsight.enabled ||
      !config.hindsight.reflect.enabled || !config.continuous_improvement.enabled ||
      config.admission.mode !== "automatic" || config.admission.human_review_default !== false
    ) fail("runtime_full_activation_incomplete");
    if (config.schema === RUNTIME_V5 && (
      !config.topic_continuity.enabled || !config.temporal_retrieval.enabled || !config.authority.enabled
    )) fail("runtime_full_activation_incomplete");
  }
  if (
    config.continuous_improvement?.canonical_worker !== "local" ||
    config.continuous_improvement?.learned_plane !== "hindsight-native" ||
    config.continuous_improvement?.on_session_end !== true
  ) fail("runtime_continuous_improvement_invalid");
  return Object.freeze(config);
}

export function normalizeCodexRuntimeConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("runtime_config_invalid");
  if (LEGACY_SCHEMA.test(input.schema ?? "") || input.schema === RUNTIME_V4) {
    const compatible = defaults(RUNTIME_V5);
    compatible.migration.source_schema = input.schema;
    const merged = input.schema === RUNTIME_V4 ? merge(compatible, {
      ...input,
      schema: RUNTIME_V5,
      ...(input.deployment?.activation === "full" ? {
        topic_continuity: { enabled: true },
        temporal_retrieval: { enabled: true },
        authority: { enabled: true }
      } : {})
    }) : compatible;
    merged.migration.source_schema = input.schema;
    return validate(merged);
  }
  if (input.schema !== RUNTIME_V5) fail("runtime_config_schema_invalid");
  return validate(merge(defaults(RUNTIME_V5), input));
}

export function createDisabledCodexRuntimeV4() {
  return validate(defaults(RUNTIME_V4));
}

export function createFullDeploymentRuntimeV4({ graphEndpoint, graphTokenFile } = {}) {
  return validate(merge(defaults(RUNTIME_V4), {
    schema: RUNTIME_V4,
    deployment: { activation: "full" },
    working_memory: { enabled: true, offload: { enabled: true } },
    memory_router: { enabled: true },
    knowledge_graph: {
      enabled: true,
      endpoint: graphEndpoint,
      token_file: graphTokenFile
    },
    hindsight: { enabled: true, reflect: { enabled: true } },
    continuous_improvement: { enabled: true },
    admission: { mode: "automatic", human_review_default: false },
    migration: {
      source_schema: "explicit_owner_migration",
      compatibility_flags_off: false,
      immutable_vault_rewrite: false
    }
  }));
}

export function createDisabledCodexRuntimeV5() {
  return validate(defaults(RUNTIME_V5));
}

export function createFullDeploymentRuntimeV5({ graphEndpoint, graphTokenFile } = {}) {
  return normalizeCodexRuntimeConfig({
    schema: RUNTIME_V5,
    deployment: { activation: "full" },
    working_memory: { enabled: true, offload: { enabled: true } },
    memory_router: { enabled: true },
    topic_continuity: { enabled: true },
    temporal_retrieval: { enabled: true },
    authority: { enabled: true },
    knowledge_graph: {
      enabled: true,
      endpoint: graphEndpoint,
      token_file: graphTokenFile
    },
    hindsight: { enabled: true, reflect: { enabled: true } },
    continuous_improvement: { enabled: true },
    admission: { mode: "automatic", human_review_default: false },
    migration: {
      source_schema: RUNTIME_V4,
      compatibility_flags_off: true,
      immutable_vault_rewrite: false
    }
  });
}
