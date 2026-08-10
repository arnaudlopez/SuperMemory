import path from "node:path";

const LEGACY_SCHEMA = /^supermemory\.(?:codex|hook|mcp|app-server)-runtime\.v[123]$/;
const RUNTIME_V4 = "supermemory.codex-runtime.v4";
const RUNTIME_V5 = "supermemory.codex-runtime.v5";
const RUNTIME_V6 = "supermemory.codex-runtime.v6";
const RUNTIME_V7 = "supermemory.codex-runtime.v7";
const RUNTIME_V8 = "supermemory.codex-runtime.v8";

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
  if ([RUNTIME_V6, RUNTIME_V7, RUNTIME_V8].includes(schema)) {
    config.deployment.activation = "disabled";
    config.scope = {
      mode: "owner_plus_current_project",
      registry: "canonical_dynamic",
      cross_project_mcp: false,
      owner_promotion: "governed"
    };
    config.runtime_supervisor = {
      max_active_project_contexts: 16,
      idle_ttl_ms: 1_800_000,
      context_start_concurrency: 4,
      worker_concurrency: 4
    };
    config.enrollment = {
      credential_mode: "opaque_per_checkout",
      plan_ttl_ms: 600_000,
      require_plan_hash: true
    };
    config.history_import = {
      enabled: true,
      default_capture_level: "backfill",
      max_event_bytes: 524_288,
      max_parallel_sessions: 4,
      unknown_schema: "reject"
    };
    config.codex_integration = {
      plugin_id: "supermemory@supermemory-local",
      require_new_session_after_change: true,
      auto_trust_hooks: false
    };
  }
  if ([RUNTIME_V7, RUNTIME_V8].includes(schema)) {
    config.personal_manager = {
      enabled: false,
      memory_provider: "supermemory-fabric",
      direct_hindsight_provider: false,
      runtime_host: "home101",
      device_id: "device_home101",
      transport: "ssh_local_forward",
      endpoint: "http://127.0.0.1:18765",
      context_budget_tokens: 8_000,
      capture_level: "governed",
      mutation_authority: "explicit_signed_turn"
    };
    config.action_connectors = {
      mode: "hermes_native",
      supermemory_reimplements_connectors: false,
      retain_reduced_receipts: true
    };
    config.llm = {
      provider_mode: "single",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      reasoning_effort: "high",
      fallback_provider: null
    };
  }
  if (schema === RUNTIME_V8) {
    config.longitudinal_memory = {
      enabled: false,
      activation: "disabled",
      canary: false,
      progressive: false,
      worker_concurrency: 1,
      max_batch_episodes: 50,
      max_cluster_episodes: 24,
      max_cluster_tokens: 32_000,
      daily_maintenance: true,
      session_close_consolidation: true,
      salience_policy: "salience-v1",
      endorsement_policy: "endorsement-v1",
      decay_policy: "class-aware-v1",
      explicit_remember_behavior: "pin",
      authority: "canonical-vault-first"
    };
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
  if (![RUNTIME_V4, RUNTIME_V5, RUNTIME_V6, RUNTIME_V7, RUNTIME_V8].includes(config.schema)) fail("runtime_config_schema_invalid");
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
  if ([RUNTIME_V5, RUNTIME_V6, RUNTIME_V7, RUNTIME_V8].includes(config.schema)) {
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
  if ([RUNTIME_V6, RUNTIME_V7, RUNTIME_V8].includes(config.schema)) {
    if (
      config.scope?.mode !== "owner_plus_current_project" ||
      config.scope?.registry !== "canonical_dynamic" ||
      config.scope?.cross_project_mcp !== false ||
      config.scope?.owner_promotion !== "governed"
    ) fail("runtime_scope_contract_invalid");
    if (
      !Number.isSafeInteger(config.runtime_supervisor?.max_active_project_contexts) ||
      config.runtime_supervisor.max_active_project_contexts < 1 ||
      config.runtime_supervisor.max_active_project_contexts > 128 ||
      !Number.isSafeInteger(config.runtime_supervisor?.idle_ttl_ms) ||
      config.runtime_supervisor.idle_ttl_ms < 60_000 ||
      !Number.isSafeInteger(config.runtime_supervisor?.context_start_concurrency) ||
      config.runtime_supervisor.context_start_concurrency < 1 ||
      config.runtime_supervisor.context_start_concurrency > 16 ||
      !Number.isSafeInteger(config.runtime_supervisor?.worker_concurrency) ||
      config.runtime_supervisor.worker_concurrency < 1 ||
      config.runtime_supervisor.worker_concurrency > 32
    ) fail("runtime_supervisor_contract_invalid");
    if (
      config.enrollment?.credential_mode !== "opaque_per_checkout" ||
      config.enrollment?.require_plan_hash !== true ||
      !Number.isSafeInteger(config.enrollment?.plan_ttl_ms) ||
      config.enrollment.plan_ttl_ms < 60_000 ||
      config.enrollment.plan_ttl_ms > 3_600_000
    ) fail("runtime_enrollment_contract_invalid");
    if (
      config.history_import?.default_capture_level !== "backfill" ||
      config.history_import?.unknown_schema !== "reject" ||
      !Number.isSafeInteger(config.history_import?.max_event_bytes) ||
      config.history_import.max_event_bytes < 1_024 ||
      config.history_import.max_event_bytes > 4 * 1_024 * 1_024 ||
      !Number.isSafeInteger(config.history_import?.max_parallel_sessions) ||
      config.history_import.max_parallel_sessions < 1 ||
      config.history_import.max_parallel_sessions > 16 ||
      config.codex_integration?.plugin_id !== "supermemory@supermemory-local" ||
      config.codex_integration?.require_new_session_after_change !== true ||
      config.codex_integration?.auto_trust_hooks !== false
    ) fail("runtime_codex_sync_contract_invalid");
  }
  if ([RUNTIME_V7, RUNTIME_V8].includes(config.schema)) {
    if (
      config.personal_manager?.memory_provider !== "supermemory-fabric" ||
      config.personal_manager?.direct_hindsight_provider !== false ||
      config.personal_manager?.runtime_host !== "home101" ||
      config.personal_manager?.device_id !== "device_home101" ||
      config.personal_manager?.transport !== "ssh_local_forward" ||
      config.personal_manager?.endpoint !== "http://127.0.0.1:18765" ||
      !Number.isSafeInteger(config.personal_manager?.context_budget_tokens) ||
      config.personal_manager.context_budget_tokens < 256 ||
      config.personal_manager.context_budget_tokens > 8_000 ||
      config.personal_manager?.capture_level !== "governed" ||
      config.personal_manager?.mutation_authority !== "explicit_signed_turn"
    ) fail("runtime_personal_manager_provider_invalid");
    if (
      config.action_connectors?.mode !== "hermes_native" ||
      config.action_connectors?.supermemory_reimplements_connectors !== false ||
      config.action_connectors?.retain_reduced_receipts !== true
    ) fail("runtime_action_connectors_invalid");
    if (
      config.llm?.provider_mode !== "single" ||
      !["openai-codex", "openrouter"].includes(config.llm?.provider) ||
      typeof config.llm?.model !== "string" || !config.llm.model ||
      (config.llm.provider === "openai-codex" && config.llm.model !== "gpt-5.6-luna") ||
      config.llm?.fallback_provider !== null
    ) fail("runtime_llm_provider_invalid");
  }
  if (config.schema === RUNTIME_V8) {
    const longitudinal = config.longitudinal_memory;
    if (
      longitudinal?.canary !== false || longitudinal?.progressive !== false ||
      longitudinal?.worker_concurrency !== 1 || longitudinal?.max_batch_episodes !== 50 ||
      longitudinal?.max_cluster_episodes !== 24 || longitudinal?.max_cluster_tokens !== 32_000 ||
      longitudinal?.daily_maintenance !== true || longitudinal?.session_close_consolidation !== true ||
      longitudinal?.salience_policy !== "salience-v1" || longitudinal?.endorsement_policy !== "endorsement-v1" ||
      longitudinal?.decay_policy !== "class-aware-v1" || longitudinal?.explicit_remember_behavior !== "pin" ||
      longitudinal?.authority !== "canonical-vault-first" ||
      !["disabled", "full"].includes(longitudinal?.activation)
    ) fail("runtime_longitudinal_memory_invalid");
  }
  if (["full", "enabled"].includes(config.deployment.activation)) {
    if (
      !config.working_memory.enabled || !config.memory_router.enabled ||
      !config.knowledge_graph.enabled || !config.hindsight.enabled ||
      !config.hindsight.reflect.enabled || !config.continuous_improvement.enabled ||
      config.admission.mode !== "automatic" || config.admission.human_review_default !== false
    ) fail("runtime_full_activation_incomplete");
    if ([RUNTIME_V5, RUNTIME_V6, RUNTIME_V7, RUNTIME_V8].includes(config.schema) && (
      !config.topic_continuity.enabled || !config.temporal_retrieval.enabled || !config.authority.enabled
    )) fail("runtime_full_activation_incomplete");
    if ([RUNTIME_V6, RUNTIME_V7, RUNTIME_V8].includes(config.schema) && !config.history_import.enabled) {
      fail("runtime_full_activation_incomplete");
    }
    if ([RUNTIME_V7, RUNTIME_V8].includes(config.schema) && !config.personal_manager.enabled) fail("runtime_full_activation_incomplete");
    if (config.schema === RUNTIME_V8 && (!config.longitudinal_memory.enabled || config.longitudinal_memory.activation !== "full")) fail("runtime_full_activation_incomplete");
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
  if (input.schema === RUNTIME_V7) return migrateCodexRuntimeV7ToV8(input);
  if (![RUNTIME_V5, RUNTIME_V6, RUNTIME_V8].includes(input.schema)) fail("runtime_config_schema_invalid");
  return validate(merge(defaults(input.schema), input));
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

export function createDisabledCodexRuntimeV6() {
  return validate(defaults(RUNTIME_V6));
}

export function migrateCodexRuntimeV5ToV6(input = {}) {
  if (input?.schema !== RUNTIME_V5) fail("runtime_config_schema_invalid");
  const merged = merge(defaults(RUNTIME_V6), {
    ...input,
    schema: RUNTIME_V6,
    deployment: {
      ...input.deployment,
      activation: input.deployment?.activation === "full" ? "enabled" : "disabled"
    },
    migration: {
      ...input.migration,
      source_schema: RUNTIME_V5,
      compatibility_flags_off: true,
      immutable_vault_rewrite: false
    }
  });
  return validate(merged);
}

export function createFullDeploymentRuntimeV6({ graphEndpoint, graphTokenFile } = {}) {
  return validate(merge(defaults(RUNTIME_V6), {
    schema: RUNTIME_V6,
    deployment: { activation: "enabled" },
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
      source_schema: RUNTIME_V5,
      compatibility_flags_off: true,
      immutable_vault_rewrite: false
    }
  }));
}

export function createDisabledCodexRuntimeV7() {
  return validate(defaults(RUNTIME_V7));
}

export function migrateCodexRuntimeV6ToV7(input = {}) {
  if (input?.schema !== RUNTIME_V6) fail("runtime_config_schema_invalid");
  const merged = merge(defaults(RUNTIME_V7), {
    ...input,
    schema: RUNTIME_V7,
    personal_manager: { enabled: input.deployment?.activation === "enabled" },
    migration: {
      ...input.migration,
      source_schema: RUNTIME_V6,
      compatibility_flags_off: true,
      immutable_vault_rewrite: false
    }
  });
  return validate(merged);
}

export function createFullDeploymentRuntimeV7({ graphEndpoint, graphTokenFile } = {}) {
  return migrateCodexRuntimeV6ToV7(createFullDeploymentRuntimeV6({ graphEndpoint, graphTokenFile }));
}

export function createDisabledCodexRuntimeV8() {
  return validate(defaults(RUNTIME_V8));
}

export function migrateCodexRuntimeV7ToV8(input = {}) {
  if (input?.schema !== RUNTIME_V7) fail("runtime_config_schema_invalid");
  const active = ["full", "enabled"].includes(input.deployment?.activation);
  return validate(merge(defaults(RUNTIME_V8), {
    ...input,
    schema: RUNTIME_V8,
    deployment: { ...input.deployment, activation: active ? "full" : "disabled" },
    longitudinal_memory: { enabled: active, activation: active ? "full" : "disabled" },
    migration: {
      ...input.migration,
      source_schema: RUNTIME_V7,
      compatibility_flags_off: true,
      immutable_vault_rewrite: false
    }
  }));
}

export function createFullDeploymentRuntimeV8({ graphEndpoint, graphTokenFile } = {}) {
  return migrateCodexRuntimeV7ToV8(createFullDeploymentRuntimeV7({ graphEndpoint, graphTokenFile }));
}
