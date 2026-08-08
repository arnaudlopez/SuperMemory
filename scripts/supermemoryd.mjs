#!/usr/bin/env node

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
import { normalizeCodexRuntimeConfig } from "./lib/codex-runtime-config.mjs";
import { createSuperMemoryDaemon } from "./lib/supermemory-daemon.mjs";

function parseArguments(argv) {
  const options = {
    host: "127.0.0.1",
    port: 0,
    json: false,
    check: false,
    codex_executable: process.env.SUPERMEMORY_CODEX_EXECUTABLE || "/usr/local/bin/codex",
    codex_model: process.env.SUPERMEMORY_CODEX_MODEL || "gpt-5.6-luna",
    codex_reasoning_effort: process.env.SUPERMEMORY_CODEX_REASONING_EFFORT || "high",
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
    retrieval_max_tokens: 12_000
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
  }
  const encryptionKey = loadKey(options.key_file);
  const daemonBearer = loadToken(options.token_file);
  const hindsightApiKey = options.hindsight_api_key_file ? loadToken(options.hindsight_api_key_file) : "";
  const recallEnabled = Boolean(options.workspace_id && options.project_id);
  const workingSetStore = recallEnabled ? createCodexWorkingSetStore({
    vaultRoot: options.vault_root,
    encryptionKey
  }) : null;
  const codexPipeline = createCanonicalCodexPipeline({
    executable: options.codex_executable,
    model: options.codex_model,
    reasoningEffort: options.codex_reasoning_effort,
    timeoutMs: options.compiler_timeout_ms,
    runner: options.check ? async () => ({}) : null
  });
  const admissionPolicy = createMemoryAdmissionPolicy();
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
    memoryRouterFactory: recallEnabled ? ({ captureStore }) => {
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
    canonicalWorkerFactory: recallEnabled && options.continuous_improvement ? ({ captureStore, memoryRouter }) => {
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
