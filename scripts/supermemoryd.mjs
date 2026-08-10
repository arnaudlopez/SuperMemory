#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createCodexMemoryRecall } from "./lib/codex-memory-recall.mjs";
import { createCodexMemoryRouter } from "./lib/codex-memory-router.mjs";
import { createCodexWorkingRecall } from "./lib/codex-working-recall.mjs";
import { createCodexWorkingSetStore } from "./lib/codex-working-set-store.mjs";
import { createCodexTopicStore } from "./lib/codex-topic-store.mjs";
import { createCodexTopicResolver } from "./lib/codex-topic-resolver.mjs";
import { createCodexTopicView } from "./lib/codex-topic-view.mjs";
import { migrateTopicContinuity } from "./lib/codex-topic-migration.mjs";
import { createCodexWorkspaceStore } from "./lib/codex-workspace-store.mjs";
import { createCanonicalKnowledgeWorker, createCanonicalWorkingEpisodeSource } from "./lib/canonical-knowledge-worker.mjs";
import { createCanonicalCodexPipeline } from "./lib/canonical-codex-pipeline.mjs";
import { createCanonicalOpenRouterPipeline } from "./lib/canonical-openrouter-pipeline.mjs";
import { createGraphdHttpBackend } from "./lib/graphd-http-backend.mjs";
import { createHindsightAuthorityGateway } from "./lib/hindsight-authority-gateway.mjs";
import { createHindsightClientV2 } from "./lib/hindsight-client-v2.mjs";
import { createHindsightOperationReceiptStore } from "./lib/hindsight-operation-receipts.mjs";
import { canonicalClaimMemoryId, createHindsightLearnedPlane } from "./lib/hindsight-learned-plane.mjs";
import { createKnowledgeGraphAdapter } from "./lib/knowledge-graph-adapter.mjs";
import { createMemoryAdmissionPolicy } from "./lib/memory-admission-policy.mjs";
import { createMemoryAuthorityPolicy } from "./lib/memory-authority-policy.mjs";
import { createMemoryExceptionStore } from "./lib/memory-exception-store.mjs";
import { createWorkspaceOntologyRegistry } from "./lib/ontology-registry.mjs";
import { createOwnerPreferenceStore } from "./lib/owner-preference-store.mjs";
import { createCheckoutCredentialStore } from "./lib/checkout-credential-store.mjs";
import { createProjectEnrollmentService } from "./lib/project-enrollment.mjs";
import { createProjectRegistry } from "./lib/project-registry.mjs";
import { createRequestScopeResolver } from "./lib/request-scope-resolver.mjs";
import { normalizeCodexRuntimeConfig } from "./lib/codex-runtime-config.mjs";
import { createSuperMemoryDaemon } from "./lib/supermemory-daemon.mjs";
import { createWorkspaceRuntimeContextFactory } from "./lib/workspace-runtime-context.mjs";
import { createWorkspaceRuntimeSupervisor } from "./lib/workspace-runtime-supervisor.mjs";
import { createAgentCredentialStore } from "./lib/agent-credential-store.mjs";
import { createAgentScopeResolver } from "./lib/agent-scope-resolver.mjs";
import { buildPersonalContextCard } from "./lib/personal-context-card.mjs";
import { createPersonalManagerApi } from "./lib/personal-manager-api.mjs";
import { createPersonalManagerCaptureStore, normalizePersonalManagerCapture } from "./lib/personal-manager-capture.mjs";
import { createPersonalMemoryCommandBus } from "./lib/personal-memory-command-bus.mjs";
import { createPersonalMemoryRevisionStore } from "./lib/personal-memory-revision-store.mjs";
import { createPersonalMutationIntentGate } from "./lib/personal-mutation-intent-gate.mjs";
import { createPersonalRecallOrchestrator } from "./lib/personal-recall-orchestrator.mjs";
import { createMemorySignal, createMemorySignalStore, deriveMemorySignalsFromCapture } from "./lib/memory-signal-store.mjs";
import { resolveMemoryEndorsement } from "./lib/memory-endorsement-resolver.mjs";
import { createMemorySaliencePolicy } from "./lib/memory-salience-policy.mjs";
import { createLongitudinalMemoryConsolidator } from "./lib/longitudinal-memory-consolidator.mjs";
import { createMemoryRecallFeedbackStore } from "./lib/memory-recall-feedback.mjs";
import { redactCodexPayload } from "./lib/codex-redaction.mjs";

const PERSONAL_WORKSPACE_ID = "ws_706d0000-0000-7000-8000-000000000001";
const PERSONAL_PROJECT_ID = "prj_706d0000-0000-7000-8000-000000000002";
const PERSONAL_CHECKOUT_ID = "co_706d0000-0000-7000-8000-000000000003";

function personalCaptureBinding(value, prefix) {
  return `${prefix}_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32)}`;
}

function parseArguments(argv) {
  const options = {
    host: "127.0.0.1",
    port: 0,
    json: false,
    check: false,
    codex_executable: process.env.SUPERMEMORY_CODEX_EXECUTABLE || "/usr/local/bin/codex",
    codex_model: process.env.SUPERMEMORY_CODEX_MODEL || "gpt-5.6-luna",
    codex_reasoning_effort: process.env.SUPERMEMORY_CODEX_REASONING_EFFORT || "high",
    llm_provider: "openai-codex",
    llm_credential_file: process.env.SUPERMEMORY_LLM_CREDENTIAL_FILE || null,
    compiler_timeout_ms: 120_000,
    working_memory: process.env.SUPERMEMORY_WORKING_MEMORY_ENABLED === "1",
    working_offload: process.env.SUPERMEMORY_WORKING_OFFLOAD_ENABLED === "1",
    graphd_endpoint: process.env.SUPERMEMORY_GRAPHD_ENDPOINT || null,
    graphd_token_file: process.env.SUPERMEMORY_GRAPHD_TOKEN_FILE || null,
    hindsight_enabled: process.env.SUPERMEMORY_HINDSIGHT_ENABLED === "1",
    hindsight_url: process.env.SUPERMEMORY_HINDSIGHT_URL || "http://127.0.0.1:8888",
    hindsight_api_key_file: process.env.SUPERMEMORY_HINDSIGHT_API_KEY_FILE || null,
    continuous_improvement: false,
    topic_continuity: true,
    topic_view_capacity_tokens: 100_000,
    topic_auto_bind_threshold: 0.90,
    topic_auto_bind_margin: 0.25,
    authority_visible_min_age_ms: 86_400_000,
    retrieval_max_rounds: 3,
    retrieval_max_ms: 5_000,
    retrieval_max_results: 1_000,
    retrieval_max_tokens: 12_000,
    runtime_schema: null,
    multi_project: false,
    personal_manager: false,
    longitudinal_memory: false,
    personal_manager_device_id: "device_home101",
    agent_token_file: process.env.SUPERMEMORY_AGENT_TOKEN_FILE || null,
    max_active_project_contexts: 16,
    context_idle_ttl_ms: 1_800_000
  };
  const values = new Set([
    "--host",
    "--key-file",
    "--codex-executable",
    "--codex-model",
    "--codex-reasoning-effort",
    "--compiler-timeout-ms",
    "--graphd-endpoint",
    "--graphd-token-file",
    "--hindsight-url",
    "--hindsight-api-key-file",
    "--llm-credential-file",
    "--agent-token-file",
    "--port",
    "--project-id",
    "--runtime-root",
    "--runtime-contract",
    "--token-file",
    "--vault-root",
    "--workspace-id"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json" || token === "--check" || token === "--working-memory" || token === "--working-offload" || token === "--hindsight-enabled") {
      options[token.slice(2)] = true;
      continue;
    }
    if (!values.has(token)) throw new Error(`daemon_option_invalid:${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`daemon_option_value_missing:${token}`);
    options[token.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  for (const required of ["vault_root", "key_file", "token_file"]) {
    if (!options[required]) throw new Error(`daemon_option_required:${required}`);
  }
  options.port = Number(options.port);
  options.compiler_timeout_ms = Number(options.compiler_timeout_ms);
  options.runtime_root = options.runtime_root
    ? path.resolve(options.runtime_root)
    : path.dirname(path.resolve(options.key_file));
  if (Boolean(options.workspace_id) !== Boolean(options.project_id)) {
    throw new Error("daemon_recall_binding_incomplete");
  }
  if (Boolean(options.graphd_endpoint) !== Boolean(options.graphd_token_file)) {
    throw new Error("daemon_graphd_binding_incomplete");
  }
  return options;
}

function readSecretFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o027) !== 0) {
    throw new Error(`${label}_file_insecure`);
  }
  return fs.readFileSync(resolved);
}

function loadKey(filePath) {
  const content = readSecretFile(filePath, "daemon_key");
  if (content.length === 32) return content;
  const text = content.toString("utf8").trim();
  const decoded = /^[0-9a-f]{64}$/i.test(text)
    ? Buffer.from(text, "hex")
    : Buffer.from(text, "base64");
  if (decoded.length !== 32) throw new Error("daemon_key_invalid");
  return decoded;
}

function loadToken(filePath) {
  const token = readSecretFile(filePath, "daemon_token").toString("utf8").trim();
  if (Buffer.byteLength(token) < 32) throw new Error("daemon_token_invalid");
  return token;
}

function output(value, json) {
  process.stdout.write(json
    ? `${JSON.stringify(value)}\n`
    : `supermemoryd ${value.status} at ${value.url ?? "configuration valid"}\n`);
}

let daemon = null;
try {
  const options = parseArguments(process.argv.slice(2));
  if (options.runtime_contract) {
    const runtimeContract = normalizeCodexRuntimeConfig(JSON.parse(
      readSecretFile(options.runtime_contract, "daemon_runtime_contract").toString("utf8")
    ));
    options.working_memory = runtimeContract.working_memory.enabled;
    options.working_offload = runtimeContract.working_memory.offload.enabled;
    if (runtimeContract.knowledge_graph.enabled) {
      options.graphd_endpoint = runtimeContract.knowledge_graph.endpoint;
      options.graphd_token_file = runtimeContract.knowledge_graph.token_file;
    } else {
      options.graphd_endpoint = null;
      options.graphd_token_file = null;
    }
    options.hindsight_enabled = runtimeContract.hindsight.enabled;
    options.continuous_improvement = runtimeContract.continuous_improvement.enabled;
    options.topic_continuity = runtimeContract.topic_continuity.enabled;
    options.topic_view_capacity_tokens = runtimeContract.topic_continuity.working_view_capacity_tokens;
    options.topic_auto_bind_threshold = runtimeContract.topic_continuity.auto_bind_threshold;
    options.topic_auto_bind_margin = runtimeContract.topic_continuity.auto_bind_margin;
    options.authority_visible_min_age_ms = runtimeContract.authority.visible_exception_min_age_ms;
    options.retrieval_max_rounds = runtimeContract.temporal_retrieval.max_rounds;
    options.retrieval_max_ms = runtimeContract.temporal_retrieval.max_ms;
    options.retrieval_max_results = runtimeContract.temporal_retrieval.max_results;
    options.retrieval_max_tokens = runtimeContract.temporal_retrieval.max_tokens;
    options.runtime_schema = runtimeContract.schema;
    options.multi_project = ["supermemory.codex-runtime.v6", "supermemory.codex-runtime.v7", "supermemory.codex-runtime.v8"].includes(runtimeContract.schema);
    options.personal_manager = ["supermemory.codex-runtime.v7", "supermemory.codex-runtime.v8"].includes(runtimeContract.schema) && runtimeContract.personal_manager.enabled;
    options.longitudinal_memory = runtimeContract.schema === "supermemory.codex-runtime.v8" && runtimeContract.longitudinal_memory.enabled;
    if (options.personal_manager) options.personal_manager_device_id = runtimeContract.personal_manager.device_id;
    if (["supermemory.codex-runtime.v7", "supermemory.codex-runtime.v8"].includes(runtimeContract.schema)) {
      options.llm_provider = runtimeContract.llm.provider;
      options.codex_model = runtimeContract.llm.model;
      options.codex_reasoning_effort = runtimeContract.llm.reasoning_effort;
    }
    if (options.multi_project) {
      options.max_active_project_contexts = runtimeContract.runtime_supervisor.max_active_project_contexts;
      options.context_idle_ttl_ms = runtimeContract.runtime_supervisor.idle_ttl_ms;
    }
  }
  const encryptionKey = loadKey(options.key_file);
  const daemonBearer = loadToken(options.token_file);
  if (options.personal_manager && !options.agent_token_file) throw new Error("daemon_option_required:agent_token_file");
  const agentToken = options.personal_manager ? loadToken(options.agent_token_file) : null;
  const hindsightApiKey = options.hindsight_api_key_file ? loadToken(options.hindsight_api_key_file) : "";
  const llmCredential = options.llm_provider === "openrouter"
    ? loadToken(options.llm_credential_file ?? (() => { throw new Error("daemon_option_required:llm_credential_file"); })())
    : null;
  const projectRegistry = options.multi_project ? createProjectRegistry({ vaultRoot: options.vault_root }) : null;
  const credentialStore = options.multi_project ? createCheckoutCredentialStore({ vaultRoot: options.vault_root }) : null;
  const enrollmentService = options.multi_project ? createProjectEnrollmentService({
    registry: projectRegistry,
    credentialStore,
    receiptKey: encryptionKey
  }) : null;
  const ownerScope = options.multi_project
    ? (options.check ? projectRegistry.snapshot().owner : projectRegistry.ensureOwnerScope())
    : null;
  const ownerPreferenceStore = ownerScope ? createOwnerPreferenceStore({
    vaultRoot: options.vault_root,
    encryptionKey,
    ownerScope
  }) : null;
  const agentCredentialStore = options.personal_manager ? createAgentCredentialStore({ vaultRoot: options.vault_root }) : null;
  if (agentCredentialStore && !options.check) {
    agentCredentialStore.provision({
      token: agentToken,
      agentId: "agent_personal_manager",
      ownerId: ownerScope.ownerId,
      deviceId: options.personal_manager_device_id,
      audience: "supermemoryd",
      capabilities: ["pm:context", "pm:recall", "pm:capture", "pm:write", "pm:resolve"]
    });
  }
  const personalRevisionStore = options.personal_manager ? createPersonalMemoryRevisionStore({
    vaultRoot: options.vault_root,
    encryptionKey
  }) : null;
  const personalCaptureStore = options.personal_manager ? createPersonalManagerCaptureStore({
    vaultRoot: options.vault_root,
    encryptionKey
  }) : null;
  const personalSignalStore = options.longitudinal_memory ? createMemorySignalStore({
    vaultRoot: options.vault_root,
    encryptionKey
  }) : null;
  const personalRecallFeedbackStore = options.longitudinal_memory ? createMemoryRecallFeedbackStore({
    vaultRoot: options.vault_root,
    encryptionKey
  }) : null;
  const personalOwnerWorkspaceStore = options.personal_manager ? createCodexWorkspaceStore({
    vaultRoot: options.vault_root,
    workspaceId: PERSONAL_WORKSPACE_ID,
    projectId: PERSONAL_PROJECT_ID
  }) : null;
  const personalOwnerDurableRecall = personalOwnerWorkspaceStore
    ? createCodexMemoryRecall({ workspaceStore: personalOwnerWorkspaceStore, maxLimit: 50 })
    : null;
  const personalOwnerHindsightGateway = options.personal_manager && options.hindsight_enabled
    ? createHindsightAuthorityGateway({
      workspaceId: PERSONAL_WORKSPACE_ID,
      client: createHindsightClientV2({
        workspaceId: PERSONAL_WORKSPACE_ID,
        baseUrl: options.hindsight_url,
        ["api" + "Key"]: hindsightApiKey
      }),
      receiptStore: createHindsightOperationReceiptStore({
        vaultRoot: options.vault_root,
        encryptionKey,
        workspaceId: PERSONAL_WORKSPACE_ID
      }),
      authorityResolver: ({ memoryId, asOf }) => {
        const memory = asOf
          ? personalRevisionStore.asOf({ memoryId, asOf })
          : personalRevisionStore.current({ memoryId });
        if (!memory || memory.scope?.kind !== "owner" || memory.scope.owner_id !== ownerScope.ownerId) return null;
        return {
          workspace_id: PERSONAL_WORKSPACE_ID,
          memory_id: memoryId,
          authorized: memory.status === "active",
          status: memory.status === "active" ? "active" : "revoked",
          authority_state: memory.status === "active" ? "current" : "revoked",
          authority_revision: memory.revision,
          allowed_consumers: ["codex"],
          citation: { memory_id: memoryId, revision: memory.revision, valid_from: memory.valid_from, provenance: memory.provenance }
        };
      }
    })
    : null;
  let personalProjectionProcessor = null;
  let personalLongitudinalWorker = null;
  const personalOperations = personalRevisionStore ? {
    enqueue: async (job) => {
      const operation = personalRevisionStore.putOperation({
      schema: "supermemory.personal-memory-operation.v1",
      operation_id: job.operation_id,
      status: "canonical_committed",
      projection_status: "queued",
      projection_attempts: 0,
      memory_id: job.memory_id,
      revision: job.revision,
      operation: job.operation,
      scope: job.scope
      });
      if (personalProjectionProcessor) queueMicrotask(() => personalProjectionProcessor(operation));
      return operation;
    }
  } : null;
  const personalCommandBus = personalRevisionStore ? createPersonalMemoryCommandBus({
    revisionStore: personalRevisionStore,
    intentGate: createPersonalMutationIntentGate(),
    projectionQueue: personalOperations,
    sanitizePatch: (patch) => {
      const redacted = redactCodexPayload(patch, { encryptionKey, maxStringBytes: 64 * 1024 });
      return { patch: redacted.payload, findings: redacted.findings };
    }
  }) : null;
  const personalManagerRuntimeStatus = options.personal_manager ? () => {
    const operations = personalRevisionStore.listOperations();
    const credentials = agentCredentialStore.snapshot().filter((item) => item.agent_id === "agent_personal_manager");
    return {
      enabled: true,
      status: credentials.some((item) => item.status === "active") ? "ready" : "revoked",
      memory_provider: "supermemory-fabric",
      provider_version: options.longitudinal_memory ? "2.5.0" : "2.4.0",
      direct_hindsight_provider: false,
      llm: { provider: options.llm_provider, model: options.codex_model, reasoning_effort: options.codex_reasoning_effort, fallback_provider: null },
      captures: { durable: personalCaptureStore.list().length },
      longitudinal_memory: personalLongitudinalWorker?.status?.() ?? {
        status: options.longitudinal_memory ? "starting" : "disabled",
        pending: 0,
        processed: 0,
        projection_retryable: 0
      },
      projections: {
        queued: operations.filter((item) => item.projection_status === "queued").length,
        failed_retryable: operations.filter((item) => item.projection_status === "failed_retryable").length,
        completed: operations.filter((item) => item.projection_status === "completed").length
      },
      credential: credentials.at(-1) ?? null
    };
  } : null;
  // A v6 daemon must accept the first enrollment without a restart. The
  // supervisor is therefore available even while the registry is empty.
  const recallEnabled = options.multi_project || Boolean(options.workspace_id && options.project_id);
  const workingSetStore = recallEnabled ? createCodexWorkingSetStore({
    vaultRoot: options.vault_root,
    encryptionKey
  }) : null;
  const codexPipeline = options.llm_provider === "openrouter"
    ? createCanonicalOpenRouterPipeline({
      ["api" + "Key"]: llmCredential,
      model: options.codex_model,
      reasoningEffort: options.codex_reasoning_effort,
      timeoutMs: options.compiler_timeout_ms,
      fetchImpl: options.check ? async () => new Response("{}", { status: 200 }) : globalThis.fetch
    })
    : createCanonicalCodexPipeline({
      executable: options.codex_executable,
      model: options.codex_model,
      reasoningEffort: options.codex_reasoning_effort,
      timeoutMs: options.compiler_timeout_ms,
      runner: options.check ? async () => ({}) : null
    });
  const admissionPolicy = createMemoryAdmissionPolicy();
  let personalOwnerContextPromise = null;
  daemon = createSuperMemoryDaemon({
    vaultRoot: options.vault_root,
    encryptionKey,
    ["auth" + "Token"]: daemonBearer,
    host: options.host,
    port: options.port,
    compilerExtractor: codexPipeline.compilerExtractor,
    compilerVerifier: codexPipeline.compilerVerifier,
    compilerAdmissionMode: "automatic",
    compilerAdmissionPolicy: admissionPolicy,
    runtimeRoot: options.runtime_root,
    workingMemory: {
      enabled: options.working_memory === true,
      offload: {
        enabled: options.working_offload === true,
        replacement_supported: options.working_offload === true,
        threshold_tokens: 12_000,
        allowed_tools: ["Bash"]
      }
    },
    workingSetStore,
    memoryRouterFactory: !options.multi_project && recallEnabled ? ({ captureStore }) => {
      workingSetStore.migrateTemporalEpisodes({ workspaceId: options.workspace_id });
      const topicStore = options.topic_continuity ? createCodexTopicStore({
        vaultRoot: options.vault_root,
        encryptionKey
      }) : null;
      const topicView = topicStore ? createCodexTopicView({
        topicStore,
        workingStore: workingSetStore,
        capacityTokens: options.topic_view_capacity_tokens
      }) : null;
      const topicResolver = topicStore ? createCodexTopicResolver({
        topicStore,
        workingStore: workingSetStore,
        autoBindThreshold: options.topic_auto_bind_threshold,
        autoBindMargin: options.topic_auto_bind_margin
      }) : null;
      if (topicStore) migrateTopicContinuity({
        workspaceId: options.workspace_id,
        projectId: options.project_id,
        workingStore: workingSetStore,
        topicStore
      });
      const workingRecall = createCodexWorkingRecall({
        workingStore: workingSetStore,
        captureStore,
        workspaceId: options.workspace_id,
        projectId: options.project_id,
        topicStore,
        topicView
      });
      const authorityPolicy = createMemoryAuthorityPolicy({
        vaultRoot: options.vault_root,
        encryptionKey,
        workspaceId: options.workspace_id,
        projectId: options.project_id
      });
      const exceptionStore = createMemoryExceptionStore({
        vaultRoot: options.vault_root,
        encryptionKey,
        workspaceId: options.workspace_id,
        projectId: options.project_id,
        visibleMinAgeMs: options.authority_visible_min_age_ms
      });
      const workspaceStore = createCodexWorkspaceStore({
        vaultRoot: options.vault_root,
        workspaceId: options.workspace_id,
        projectId: options.project_id
      });
      const durableRecall = createCodexMemoryRecall({ workspaceStore });
      const remoteBackend = options.graphd_endpoint ? createGraphdHttpBackend({
        endpoint: options.graphd_endpoint,
        tokenFile: options.graphd_token_file,
        workspaceId: options.workspace_id
      }) : null;
      let graphAdapter;
      const ontologyRegistry = createWorkspaceOntologyRegistry({
        vaultRoot: options.vault_root,
        encryptionKey,
        workspaceId: options.workspace_id,
        claimAuthorityResolver: (input) => graphAdapter?.resolveAuthorizedClaims(input) ?? [],
        retrievalCorpus: JSON.parse(fs.readFileSync(new URL(
          "../deploy/hindsight/ontology-retrieval-corpus.v1.json",
          import.meta.url
        ), "utf8"))
      });
      graphAdapter = createKnowledgeGraphAdapter({
        vaultRoot: options.vault_root,
        encryptionKey,
        workspaceId: options.workspace_id,
        ontologyRegistry,
        remoteBackend,
        provenanceResolver: ({ workspaceId, episodeIds, evidenceIds }) => {
          const active = workingSetStore.listImproveEpisodes({ workspaceId, captureStore })
            .filter((source) => source.status === "active" && source.reopened === true);
          const episodes = new Set(active.map((source) => source.episode.episode_id));
          const evidence = new Set(active.map((source) => source.evidence.evidence_id));
          return episodeIds.every((id) => episodes.has(id)) && evidenceIds.every((id) => evidence.has(id));
        }
      });
      graphAdapter.migrateTemporalAuthority({
        workspaceId: options.workspace_id,
        authorityResolver: (claim) => authorityPolicy.evaluate({
          claim: {
            claim_id: claim.claim_id,
            claim_key: claim.claim_key,
            workspace_id: options.workspace_id,
            project_id: options.project_id,
            topic_id: claim.authority?.topic_id ?? null,
            fact_class: claim.authority?.fact_class ?? "external_fact",
            evidence_ids: claim.evidence_ids,
            observed_at: claim.observed_at,
            event_time: claim.event_time,
            proof_strength: "strong",
            authenticated: true,
            explicit: true
          }
        })
      });
      const hindsightClient = options.hindsight_enabled ? createHindsightClientV2({
        workspaceId: options.workspace_id,
        baseUrl: options.hindsight_url,
        ["api" + "Key"]: hindsightApiKey
      }) : null;
      const hindsightGateway = hindsightClient ? createHindsightAuthorityGateway({
        workspaceId: options.workspace_id,
        client: hindsightClient,
        receiptStore: createHindsightOperationReceiptStore({
          vaultRoot: options.vault_root,
          encryptionKey,
          workspaceId: options.workspace_id
        }),
        authorityResolver: ({ memoryId, asOf, consumer }) => {
          if (!memoryId) return null;
          if (memoryId.startsWith("memory:")) {
            const claim = graphAdapter.readAuthorizedState({
              workspaceId: options.workspace_id,
              asOf: asOf ?? new Date().toISOString()
            }).claims.find((item) => canonicalClaimMemoryId(item.claim_id) === memoryId);
            if (!claim) return null;
            return {
              workspace_id: options.workspace_id,
              memory_id: memoryId,
              authorized: true,
              status: "active",
              authority: claim.authority ?? null,
              authority_state: claim.authority?.state ?? "current",
              authority_revision: claim.authority?.revision ?? 0,
              allowed_consumers: ["codex"],
              citation: {
                claim_id: claim.claim_id,
                admission_id: claim.admission.admission_id,
                evidence_ids: claim.evidence_ids,
                episode_ids: claim.episode_ids
              }
            };
          }
          let memory;
          try {
            memory = workspaceStore.getMemory(memoryId, { includeInactive: true });
          } catch {
            return null;
          }
          const candidate = workspaceStore.getCandidate(memory.candidate_id);
          return {
            ...memory,
            authorized: memory.status === "active" && memory.sensitivity === "standard",
            allowed_consumers: memory.allowed_consumers,
            citation: {
              candidate_id: candidate.candidate_id,
              event_ids: candidate.event_ids,
              turn_snapshot_id: candidate.turn_snapshot_id,
              source_snapshot_ids: candidate.source_snapshot_ids,
              locator: workspaceStore.resolveCitation(candidate)
            },
            valid_until: memory.valid_until,
            as_of: asOf,
            consumer
          };
        }
      }) : null;
      const learnedPlane = hindsightGateway ? createHindsightLearnedPlane({ gateway: hindsightGateway, graphAdapter }) : null;
      return createCodexMemoryRouter({
        workspaceId: options.workspace_id,
        projectId: options.project_id,
        workingRecall,
        workingStore: workingSetStore,
        topicRecall: workingRecall,
        topicResolver,
        topicStore,
        topicView,
        authorityPolicy,
        exceptionStore,
        retrievalMaxRounds: options.retrieval_max_rounds,
        retrievalMaxMs: options.retrieval_max_ms,
        retrievalMaxResults: options.retrieval_max_results,
        retrievalMaxTokens: options.retrieval_max_tokens,
        durableRecall,
        graphAdapter,
        hindsightGateway,
        ontologyRegistry,
        learnedPlane
      });
    } : null,
    canonicalWorkerFactory: !options.multi_project && recallEnabled && options.continuous_improvement ? ({ captureStore, memoryRouter }) => {
      return createCanonicalKnowledgeWorker({
        vaultRoot: options.vault_root,
        encryptionKey,
        workspaceId: options.workspace_id,
        enabled: true,
        episodeSource: createCanonicalWorkingEpisodeSource({ workingStore: workingSetStore, captureStore }),
        graphAdapter: memoryRouter.graphAdapter,
        ontologyRegistry: memoryRouter.ontologyRegistry,
        admissionPolicy,
        extractor: codexPipeline.extractor,
        verifier: codexPipeline.verifier,
        learnedPlane: memoryRouter.learnedPlane,
        authorityPolicy: memoryRouter.authorityPolicy,
        exceptionStore: memoryRouter.exceptionStore,
        topicContextResolver: ({ workspaceId, projectId, workingSetId }) => memoryRouter.topicStore?.getContext({
          workspaceId, projectId, workingSetId
        }) ?? null
      });
    } : null,
    runtimeSupervisorFactory: options.multi_project && recallEnabled ? ({ captureStore }) => {
      const createContext = createWorkspaceRuntimeContextFactory({
        vaultRoot: options.vault_root,
        encryptionKey,
        captureStore,
        workingSetStore,
        admissionPolicy,
        codexPipeline,
        graphdEndpoint: options.graphd_endpoint,
        graphdTokenFile: options.graphd_token_file,
        hindsightEnabled: options.hindsight_enabled,
        hindsightUrl: options.hindsight_url,
        hindsightApiKey,
        continuousImprovement: options.continuous_improvement,
        topicContinuity: options.topic_continuity,
        topicViewCapacityTokens: options.topic_view_capacity_tokens,
        topicAutoBindThreshold: options.topic_auto_bind_threshold,
        topicAutoBindMargin: options.topic_auto_bind_margin,
        authorityVisibleMinAgeMs: options.authority_visible_min_age_ms,
        retrievalMaxRounds: options.retrieval_max_rounds,
        retrievalMaxMs: options.retrieval_max_ms,
        retrievalMaxResults: options.retrieval_max_results,
        retrievalMaxTokens: options.retrieval_max_tokens,
        personalRevisionStore
      });
      if (options.personal_manager && !options.check) {
        personalOwnerContextPromise = createContext({
          workspaceId: PERSONAL_WORKSPACE_ID,
          projectId: PERSONAL_PROJECT_ID
        });
        void personalOwnerContextPromise.then(async (context) => {
          await context.router.rebuildFabric?.({});
          await context.worker?.recover?.();
        }).catch(() => {});
      }
      return createWorkspaceRuntimeSupervisor({
        registry: projectRegistry,
        createContext,
        ownerRecall: ownerPreferenceStore ? ownerPreferenceStore.search : null,
        maxActiveProjectContexts: options.max_active_project_contexts,
        idleTtlMs: options.context_idle_ttl_ms
      });
    } : null,
    requestScopeResolver: options.multi_project && recallEnabled
      ? createRequestScopeResolver({ credentialStore })
      : null,
    projectRegistry,
    enrollmentService,
    checkoutCredentialStore: credentialStore,
    ownerPreferenceStore,
    personalManagerApiFactory: options.personal_manager ? ({ runtimeSupervisor, captureStore, memoryCompiler }) => {
      const resolveScope = createAgentScopeResolver({ credentialStore: agentCredentialStore, projectRegistry });
      personalProjectionProcessor = async (operation) => {
        const attempts = Number(operation.projection_attempts ?? 0) + 1;
        try {
          let gateway = null;
          let workspaceId = null;
          if (operation.scope?.kind === "owner") {
            gateway = personalOwnerHindsightGateway;
            workspaceId = PERSONAL_WORKSPACE_ID;
          } else {
            const project = projectRegistry.snapshot().projects.find((item) => (
              item.projectId === operation.scope?.project_id && item.status === "active"
            ));
            if (!project) throw Object.assign(new Error("personal_projection_project_missing"), { code: "personal_projection_project_missing" });
            workspaceId = project.workspaceId;
            const context = await runtimeSupervisor.getContext({
              workspaceId: project.workspaceId,
              projectId: project.projectId
            }, { requireCheckout: false });
            gateway = context.router.hindsightGateway;
          }
          if (!gateway) throw Object.assign(new Error("personal_projection_hindsight_unavailable"), { code: "personal_projection_hindsight_unavailable" });
          let remote;
          if (operation.operation === "forget") {
            remote = await gateway.delete(operation.memory_id);
          } else {
            const memory = personalRevisionStore.current({ memoryId: operation.memory_id });
            if (!memory || memory.revision !== operation.revision || memory.status !== "active") {
              throw Object.assign(new Error("personal_projection_revision_stale"), { code: "personal_projection_revision_stale" });
            }
            remote = await gateway.project({
              workspace_id: workspaceId,
              project_id: memory.scope?.project_id ?? PERSONAL_PROJECT_ID,
              memory_id: memory.memory_id,
              status: "active",
              title: memory.title,
              text: memory.text,
              domain: memory.domain,
              observed_at: memory.valid_from,
              valid_from: memory.valid_from,
              allowed_consumers: ["codex"],
              sensitivity: "standard",
              authority_revision: memory.revision,
              evidence_ids: [memory.provenance?.command_id].filter(Boolean),
              context: `canonical personal memory revision ${memory.revision}`,
              projection: { document_id: memory.memory_id }
            });
          }
          personalRevisionStore.putOperation({
            ...operation,
            status: "completed",
            projection_status: "completed",
            projection_attempts: attempts,
            projected_at: new Date().toISOString(),
            remote_operation_id: remote?.operation_id ?? null,
            graph_projection_status: "canonical_worker_only",
            last_error: null
          });
        } catch (error) {
          personalRevisionStore.putOperation({
            ...operation,
            status: "canonical_committed",
            projection_status: "failed_retryable",
            projection_attempts: attempts,
            last_error: error?.code ?? error?.message ?? "personal_projection_failed"
          });
        }
      };
      for (const pending of personalRevisionStore.listOperations({ statuses: ["queued", "failed_retryable"] })) {
        queueMicrotask(() => personalProjectionProcessor(pending));
      }
      if (options.longitudinal_memory && !personalLongitudinalWorker) {
        personalLongitudinalWorker = createLongitudinalMemoryConsolidator({
          vaultRoot: options.vault_root,
          encryptionKey,
          signalStore: personalSignalStore,
          revisionStore: personalRevisionStore,
          saliencePolicy: createMemorySaliencePolicy(),
          proposer: async ({ signals, workspaceId }) => {
            const messages = signals.map((signal) => ({
              role: signal.authority_role === "assistant_proposal" ? "assistant" : "user",
              content: signal.text
            }));
            const candidate = await codexPipeline.compilerExtractor.extract({
              messages,
              workspaceId,
              projectId: PERSONAL_PROJECT_ID
            });
            if (!candidate) return { operation: "noop", proposed_text: "" };
            return {
              schema: "supermemory.longitudinal-consolidation-proposal.v1",
              operation: "activate",
              proposed_text: candidate.proposedText,
              title: candidate.title,
              domain: candidate.type
            };
          },
          verifier: async ({ proposal, signals }) => {
            const evidence = signals.flatMap((signal) => signal.evidence_ids ?? []);
            const hasAuthoritativeSignal = signals.some((signal) => (
              ["user_direct", "user_endorsement", "derived_pattern"].includes(signal.authority_role)
            ));
            const messages = signals.map((signal) => ({
              role: signal.authority_role === "assistant_proposal" ? "assistant" : "user",
              content: signal.text
            }));
            const checked = await codexPipeline.compilerVerifier.verify({
              candidate: {
                title: proposal.title,
                proposedText: proposal.proposed_text,
                type: proposal.domain,
                confidence: proposal.salience?.score ?? 0.5,
                uncertainty: "",
                sensitivity: "standard"
              },
              messages,
              workspaceId: PERSONAL_WORKSPACE_ID,
              projectId: PERSONAL_PROJECT_ID
            });
            const supported = checked?.status === "verified" && Boolean(proposal?.proposed_text) && evidence.length > 0 && hasAuthoritativeSignal;
            return {
              status: supported ? "verified" : "rejected",
              independent: true,
              evidence_supported: supported,
              verifier: checked?.verifier ?? "configured-provider-verifier",
              evidence_ids: [...new Set(evidence)]
            };
          },
          projector: async ({ memoryId, revision, receipt }) => personalOperations.enqueue({
            schema: "supermemory.personal-memory-projection-job.v1",
            operation: "consolidate",
            operation_id: `op_${crypto.createHash("sha256").update(receipt.receipt_id).digest("base64url").slice(0, 24)}`,
            memory_id: memoryId,
            revision: revision.revision,
            scope: revision.scope
          }),
          limits: {
            concurrency: 1,
            maxBatchEpisodes: 50,
            maxClusterEpisodes: 24,
            maxClusterTokens: 32_000
          }
        });
        queueMicrotask(() => {
          void personalLongitudinalWorker.retryProjections()
            .then(() => personalLongitudinalWorker.drain())
            .catch(() => {});
        });
        const maintenance = setInterval(() => {
          void personalLongitudinalWorker.retryProjections()
            .then(() => personalLongitudinalWorker.drain())
            .catch(() => {});
        }, 86_400_000);
        maintenance.unref();
      }
      const recallOrchestrator = createPersonalRecallOrchestrator({
        projectRegistry,
        ownerRecall: async (input) => {
          const [preferences, explicit, admitted] = await Promise.all([
            ownerPreferenceStore.search(input),
            Promise.resolve(personalRevisionStore.search({
              query: input.query,
              ownerId: ownerScope.ownerId,
              includeOwner: true,
              asOf: input.as_of,
              limit: input.limit
            })),
            personalOwnerDurableRecall.search({
              query: input.query,
              as_of: input.as_of,
              limit: input.limit
            }).catch(() => ({ results: [], partial: true }))
          ]);
          return {
            ...preferences,
            results: [
              ...explicit,
              ...(admitted.results ?? []).map((item) => ({ ...item, text: item.excerpt ?? item.text ?? "", scope: "owner" })),
              ...(preferences.results ?? [])
            ],
            partial: preferences.partial === true || admitted.partial === true
          };
        },
        projectRecall: async ({ project, query, asOf, historical, limit }) => {
          const direct = personalRevisionStore.search({ query, projectIds: [project.projectId], asOf, limit });
          const workingSet = workingSetStore.listWorkingSets({
            workspaceId: project.workspaceId,
            projectId: project.projectId
          }).at(-1);
          if (!workingSet) return { results: direct, partial: false, source: "explicit_personal_memory" };
          const routed = await runtimeSupervisor.forProject({
            workspaceId: project.workspaceId,
            projectId: project.projectId
          }).recall({
            working_set_id: workingSet.manifest.working_set_id,
            query,
            as_of: asOf,
            historical,
            limit
          });
          return { ...routed, results: [...direct, ...(routed.results ?? [])] };
        }
      });
      return createPersonalManagerApi({
        resolveScope,
        recallOrchestrator,
        contextCard: async ({ scope, query = "current priorities decisions preferences commitments", project_id: projectId = null, mode = null }) => {
          const recalled = await recallOrchestrator.recall({
            scope,
            query,
            projectId,
            mode: mode ?? (projectId ? "project" : "portfolio"),
            limit: 50
          });
          return { ...buildPersonalContextCard({ results: recalled.results, maxTokens: 8_000 }), coverage: recalled.coverage };
        },
        commandBus: personalCommandBus,
        capture: async ({ scope, session_id: sessionId, turn_id: turnId, occurred_at: occurredAt, messages, action_receipts: actionReceipts }) => {
          const normalized = normalizePersonalManagerCapture({
            ownerId: scope.ownerId,
            agentId: scope.agentId,
            sessionId,
            turnId,
            occurredAt: occurredAt ?? new Date().toISOString(),
            encryptionKey,
            messages,
            actionReceipts
          });
          const receipt = personalCaptureStore.append(normalized);
          if (personalLongitudinalWorker && receipt.status !== "duplicate") {
            const captured = { ...normalized, capture_id: receipt.capture_id };
            const derived = [...await deriveMemorySignalsFromCapture(captured, { workspaceId: PERSONAL_WORKSPACE_ID })];
            const prior = personalCaptureStore.list()
              .filter((item) => item.session_id === sessionId && item.capture_id !== receipt.capture_id)
              .sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)))[0];
            const acceptance = normalized.messages.find((message) => message.role === "user")?.content;
            const priorProposal = prior?.messages ? [...prior.messages].reverse().find((message) => message.role === "assistant") : null;
            if (acceptance && priorProposal) {
              const endorsement = resolveMemoryEndorsement({
                userMessage: {
                  thread_id: sessionId,
                  message_id: `message:${receipt.capture_id}:user`,
                  episode_id: `episode:${receipt.capture_id}:user`,
                  content: acceptance
                },
                candidateProposals: [{
                  proposal_id: `proposal:${prior.capture_id}`,
                  thread_id: sessionId,
                  message_id: `message:${prior.capture_id}:assistant`,
                  episode_id: `episode:${prior.capture_id}:assistant`,
                  text: priorProposal.content
                }]
              });
              if (endorsement.status === "endorsed") {
                derived.push(createMemorySignal({
                  ownerId: scope.ownerId,
                  workspaceId: PERSONAL_WORKSPACE_ID,
                  sessionId,
                  episodeIds: endorsement.episode_ids,
                  evidenceIds: endorsement.message_ids.map((id) => `evidence:${id}`),
                  subjectKey: `endorsement:${crypto.createHash("sha256").update(endorsement.text).digest("hex").slice(0, 24)}`,
                  memoryClass: "decision",
                  authorityRole: "user_endorsement",
                  text: endorsement.text,
                  occurredAt: normalized.occurred_at,
                  features: { user_commitment: 1, consequentiality: 0.9, future_utility: 0.9, recurrence: 0.2, stability: 0.9, reuse: 0, recency: 1 }
                }));
              }
            }
            for (const signal of derived) personalSignalStore.append(signal);
            const allSignals = personalSignalStore.list({ ownerId: scope.ownerId, workspaceId: PERSONAL_WORKSPACE_ID, includeRevoked: false });
            for (const subjectKey of new Set(derived.map((signal) => signal.subject_key))) {
              const related = allSignals.filter((signal) => signal.subject_key === subjectKey).slice(-24);
              if (!related.length) continue;
              personalLongitudinalWorker.enqueue({
                ownerId: scope.ownerId,
                workspaceId: PERSONAL_WORKSPACE_ID,
                signalIds: related.map((signal) => signal.signal_id)
              });
            }
            queueMicrotask(() => { void personalLongitudinalWorker.drain().catch(() => {}); });
          }
          const visibleUser = normalized.messages.find((message) => message.role === "user")?.content;
          const visibleAssistant = [...normalized.messages].reverse().find((message) => message.role === "assistant")?.content;
          if (!visibleUser || !visibleAssistant) return { ...receipt, admission: "archived_only" };
          const occurred = normalized.occurred_at;
          const sequenceBase = Math.max(0, Math.floor(Date.parse(occurred) * 2));
          const boundSessionId = personalCaptureBinding(sessionId, "ses_pm");
          const boundTurnId = personalCaptureBinding(turnId, "turn_pm");
          const common = {
            adapter: "hook",
            adapter_version: "personal-manager-v1",
            project_id: PERSONAL_PROJECT_ID,
            workspace_id: PERSONAL_WORKSPACE_ID,
            checkout_id: PERSONAL_CHECKOUT_ID,
            session_id: boundSessionId,
            thread_id: String(sessionId).slice(0, 240),
            turn_id: boundTurnId,
            occurred_at: occurred,
            capture_level: "standard"
          };
          try {
            captureStore.ingest({
              ...common,
              external_event_id: `personal:${turnId}:user`,
              event_type: "prompt.submitted",
              sequence: sequenceBase,
              payload: { prompt: visibleUser, action_receipts: normalized.action_receipts }
            });
            const stop = {
              ...common,
              external_event_id: `personal:${turnId}:assistant`,
              event_type: "assistant.completed",
              sequence: sequenceBase + 1,
              payload: { last_assistant_message: visibleAssistant }
            };
            captureStore.ingest(stop);
            memoryCompiler.notifyCapture(stop);
            if (personalOwnerContextPromise) {
              void personalOwnerContextPromise.then((context) => (
                context.worker?.notifySessionClosed?.({ sessionId: boundSessionId })
              )).catch(() => {});
            }
            return { ...receipt, admission: "queued" };
          } catch (error) {
            return { ...receipt, admission: "retryable", admission_error: error?.code ?? "personal_capture_admission_failed" };
          }
        },
        getMemory: async ({ scope, memoryId, asOf }) => {
          const memory = asOf
            ? personalRevisionStore.asOf({ memoryId, asOf })
            : personalRevisionStore.current({ memoryId });
          const authorized = memory?.scope?.kind === "owner"
            ? memory.scope.owner_id === scope.ownerId
            : scope.allowedProjectIds.includes(memory?.scope?.project_id);
          return memory && authorized ? memory : null;
        },
        lineage: async ({ scope, memoryId }) => {
          const memory = personalRevisionStore.current({ memoryId });
          const authorized = memory?.scope?.kind === "owner"
            ? memory.scope.owner_id === scope.ownerId
            : scope.allowedProjectIds.includes(memory?.scope?.project_id);
          if (!authorized) return null;
          return { memory, ...(personalLongitudinalWorker?.lineage({ memoryId }) ?? { episode_ids: [], evidence_ids: [] }) };
        },
        pinMemory: async ({ scope, memoryId, pinned }) => {
          const memory = personalRevisionStore.current({ memoryId });
          const authorized = memory?.scope?.kind === "owner"
            ? memory.scope.owner_id === scope.ownerId
            : scope.allowedProjectIds.includes(memory?.scope?.project_id);
          if (!authorized) return null;
          return personalRevisionStore.pin({
            memoryId,
            expectedRevision: memory.revision,
            pinned,
            provenance: { source: "personal-manager-pin", owner_id: scope.ownerId, agent_id: scope.agentId }
          });
        },
        recordRecallFeedback: async ({ scope, memory_id: memoryId, revision, outcome, session_id: feedbackSessionId, occurred_at: feedbackOccurredAt }) => {
          const memory = personalRevisionStore.current({ memoryId });
          const authorized = memory?.scope?.kind === "owner"
            ? memory.scope.owner_id === scope.ownerId
            : scope.allowedProjectIds.includes(memory?.scope?.project_id);
          if (!authorized || !personalRecallFeedbackStore) throw Object.assign(new Error("personal_memory_not_found"), { code: "personal_memory_not_found" });
          return personalRecallFeedbackStore.record({
            ownerId: scope.ownerId,
            agentId: scope.agentId,
            sessionId: feedbackSessionId,
            memoryId,
            revision: revision ?? memory.revision,
            outcome,
            occurredAt: feedbackOccurredAt ?? new Date().toISOString()
          });
        },
        consolidationStatus: () => personalLongitudinalWorker?.status() ?? { status: "disabled" },
        operationStatus: ({ scope, operationId }) => {
          const operation = personalRevisionStore.getOperation(operationId);
          if (!operation) return null;
          const authorized = operation.scope?.kind === "owner"
            ? operation.scope.owner_id === scope.ownerId
            : scope.allowedProjectIds.includes(operation.scope?.project_id);
          return authorized ? operation : null;
        },
        status: ({ scope }) => ({
          schema: "supermemory.personal-manager-status.v1",
          ...personalManagerRuntimeStatus(),
          agent_id: scope.agentId,
          authorized_projects: scope.allowedProjectIds.length
        })
      });
    } : null,
    personalManagerStatus: personalManagerRuntimeStatus,
    personalManagerAdmin: personalRevisionStore ? {
      list: ({ projectIds }) => [
        ...personalRevisionStore.list({ projectIds, ownerId: ownerScope.ownerId, includeOwner: true }),
        ...personalOwnerWorkspaceStore.listActiveMemories({ consumer: "codex" }).map((memory) => {
          const candidate = personalOwnerWorkspaceStore.getCandidate(memory.candidate_id);
          return {
            ...memory,
            revision: 1,
            domain: candidate.type,
            scope: { kind: "owner", owner_id: ownerScope.ownerId },
            provenance: { source: "personal-manager-admission", candidate_id: memory.candidate_id }
          };
        })
      ],
      lineage: ({ memoryId }) => {
        const memory = personalRevisionStore.current({ memoryId });
        if (!memory) return null;
        return { memory, ...(personalLongitudinalWorker?.lineage({ memoryId }) ?? { episode_ids: [], evidence_ids: [], revisions: [] }) };
      },
      pin: ({ memoryId, pinned }) => {
        const memory = personalRevisionStore.current({ memoryId });
        if (!memory) return null;
        return { memory: personalRevisionStore.pin({
          memoryId,
          expectedRevision: memory.revision,
          pinned,
          provenance: { source: "local-operator-ui", owner_id: ownerScope.ownerId }
        }) };
      },
      receipts: () => personalLongitudinalWorker?.receipts() ?? [],
      runConsolidation: async () => {
        if (!personalLongitudinalWorker) return { status: "disabled" };
        const projections = await personalLongitudinalWorker.retryProjections();
        const consolidation = await personalLongitudinalWorker.drain();
        return { status: "completed", projections, consolidation, worker: personalLongitudinalWorker.status() };
      }
    } : null
  });
  if (options.check) {
    output({ ok: true, status: "configuration_valid" }, options.json);
  } else {
    const address = await daemon.start();
    output({
      ok: true,
      status: "ready",
      url: address.url,
      pid: process.pid
    }, options.json);
    const shutdown = async () => {
      await daemon.stop();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
} catch (error) {
  if (daemon) await daemon.stop().catch(() => {});
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error?.code ?? error?.message ?? "daemon_start_failed"
  })}\n`);
  process.exitCode = 1;
}
