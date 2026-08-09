import fs from "node:fs";
import { createCanonicalKnowledgeWorker, createCanonicalWorkingEpisodeSource } from "./canonical-knowledge-worker.mjs";
import { createCodexMemoryRecall } from "./codex-memory-recall.mjs";
import { createCodexMemoryRouter } from "./codex-memory-router.mjs";
import { createCodexTopicResolver } from "./codex-topic-resolver.mjs";
import { createCodexTopicStore } from "./codex-topic-store.mjs";
import { migrateTopicContinuity } from "./codex-topic-migration.mjs";
import { createCodexTopicView } from "./codex-topic-view.mjs";
import { createCodexWorkingRecall } from "./codex-working-recall.mjs";
import { createCodexWorkspaceStore } from "./codex-workspace-store.mjs";
import { createGraphdHttpBackend } from "./graphd-http-backend.mjs";
import { createHindsightAuthorityGateway } from "./hindsight-authority-gateway.mjs";
import { createHindsightClientV2 } from "./hindsight-client-v2.mjs";
import { canonicalClaimMemoryId, createHindsightLearnedPlane } from "./hindsight-learned-plane.mjs";
import { createHindsightOperationReceiptStore } from "./hindsight-operation-receipts.mjs";
import { createKnowledgeGraphAdapter } from "./knowledge-graph-adapter.mjs";
import { createMemoryAuthorityPolicy } from "./memory-authority-policy.mjs";
import { createMemoryExceptionStore } from "./memory-exception-store.mjs";
import { createWorkspaceOntologyRegistry } from "./ontology-registry.mjs";

export function createWorkspaceRuntimeContextFactory({
  vaultRoot,
  encryptionKey,
  captureStore,
  workingSetStore,
  admissionPolicy,
  codexPipeline,
  graphdEndpoint = null,
  graphdTokenFile = null,
  hindsightEnabled = false,
  hindsightUrl = "http://127.0.0.1:8888",
  hindsightApiKey = "",
  continuousImprovement = true,
  topicContinuity = true,
  topicViewCapacityTokens = 100_000,
  topicAutoBindThreshold = 0.90,
  topicAutoBindMargin = 0.25,
  authorityVisibleMinAgeMs = 86_400_000,
  retrievalMaxRounds = 3,
  retrievalMaxMs = 5_000,
  retrievalMaxResults = 1_000,
  retrievalMaxTokens = 12_000
} = {}) {
  if (!captureStore || !workingSetStore || !admissionPolicy || !codexPipeline) {
    throw new Error("runtime_context_factory_invalid");
  }
  const retrievalCorpus = JSON.parse(fs.readFileSync(new URL(
    "../../deploy/hindsight/ontology-retrieval-corpus.v1.json",
    import.meta.url
  ), "utf8"));

  return async ({ workspaceId, projectId } = {}) => {
    workingSetStore.migrateTemporalEpisodes({ workspaceId });
    const topicStore = topicContinuity ? createCodexTopicStore({ vaultRoot, encryptionKey }) : null;
    const topicView = topicStore ? createCodexTopicView({
      topicStore,
      workingStore: workingSetStore,
      capacityTokens: topicViewCapacityTokens
    }) : null;
    const topicResolver = topicStore ? createCodexTopicResolver({
      topicStore,
      workingStore: workingSetStore,
      autoBindThreshold: topicAutoBindThreshold,
      autoBindMargin: topicAutoBindMargin
    }) : null;
    if (topicStore) migrateTopicContinuity({
      workspaceId,
      projectId,
      workingStore: workingSetStore,
      topicStore
    });
    const workingRecall = createCodexWorkingRecall({
      workingStore: workingSetStore,
      captureStore,
      workspaceId,
      projectId,
      topicStore,
      topicView
    });
    const authorityPolicy = createMemoryAuthorityPolicy({
      vaultRoot,
      encryptionKey,
      workspaceId,
      projectId
    });
    const exceptionStore = createMemoryExceptionStore({
      vaultRoot,
      encryptionKey,
      workspaceId,
      projectId,
      visibleMinAgeMs: authorityVisibleMinAgeMs
    });
    const workspaceStore = createCodexWorkspaceStore({ vaultRoot, workspaceId, projectId });
    const durableRecall = createCodexMemoryRecall({ workspaceStore });
    const remoteBackend = graphdEndpoint ? createGraphdHttpBackend({
      endpoint: graphdEndpoint,
      tokenFile: graphdTokenFile,
      workspaceId
    }) : null;
    let graphAdapter;
    const ontologyRegistry = createWorkspaceOntologyRegistry({
      vaultRoot,
      encryptionKey,
      workspaceId,
      claimAuthorityResolver: (input) => graphAdapter?.resolveAuthorizedClaims(input) ?? [],
      retrievalCorpus
    });
    graphAdapter = createKnowledgeGraphAdapter({
      vaultRoot,
      encryptionKey,
      workspaceId,
      ontologyRegistry,
      remoteBackend,
      provenanceResolver: ({ workspaceId: requestedWorkspace, episodeIds, evidenceIds }) => {
        const active = workingSetStore.listImproveEpisodes({
          workspaceId: requestedWorkspace,
          captureStore
        }).filter((source) => source.status === "active" && source.reopened === true);
        const episodes = new Set(active.map((source) => source.episode.episode_id));
        const evidence = new Set(active.map((source) => source.evidence.evidence_id));
        return episodeIds.every((id) => episodes.has(id)) && evidenceIds.every((id) => evidence.has(id));
      }
    });
    graphAdapter.migrateTemporalAuthority({
      workspaceId,
      authorityResolver: (claim) => authorityPolicy.evaluate({
        claim: {
          claim_id: claim.claim_id,
          claim_key: claim.claim_key,
          workspace_id: workspaceId,
          project_id: projectId,
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
    const hindsightClient = hindsightEnabled ? createHindsightClientV2({
      workspaceId,
      baseUrl: hindsightUrl,
      ["api" + "Key"]: hindsightApiKey
    }) : null;
    const hindsightGateway = hindsightClient ? createHindsightAuthorityGateway({
      workspaceId,
      client: hindsightClient,
      receiptStore: createHindsightOperationReceiptStore({ vaultRoot, encryptionKey, workspaceId }),
      authorityResolver: ({ memoryId, asOf, consumer }) => {
        if (!memoryId) return null;
        if (memoryId.startsWith("memory:")) {
          const claim = graphAdapter.readAuthorizedState({
            workspaceId,
            asOf: asOf ?? new Date().toISOString()
          }).claims.find((item) => canonicalClaimMemoryId(item.claim_id) === memoryId);
          if (!claim) return null;
          return {
            workspace_id: workspaceId,
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
    const learnedPlane = hindsightGateway
      ? createHindsightLearnedPlane({ gateway: hindsightGateway, graphAdapter })
      : null;
    const router = createCodexMemoryRouter({
      workspaceId,
      projectId,
      workingRecall,
      workingStore: workingSetStore,
      topicRecall: workingRecall,
      topicResolver,
      topicStore,
      topicView,
      authorityPolicy,
      exceptionStore,
      retrievalMaxRounds,
      retrievalMaxMs,
      retrievalMaxResults,
      retrievalMaxTokens,
      durableRecall,
      graphAdapter,
      hindsightGateway,
      ontologyRegistry,
      learnedPlane
    });
    const worker = continuousImprovement ? createCanonicalKnowledgeWorker({
      vaultRoot,
      encryptionKey,
      workspaceId,
      enabled: true,
      episodeSource: createCanonicalWorkingEpisodeSource({ workingStore: workingSetStore, captureStore }),
      graphAdapter,
      ontologyRegistry,
      admissionPolicy,
      extractor: codexPipeline.extractor,
      verifier: codexPipeline.verifier,
      learnedPlane,
      authorityPolicy,
      exceptionStore,
      topicContextResolver: ({ workspaceId: requestedWorkspace, projectId: requestedProject, workingSetId }) => (
        topicStore?.getContext({
          workspaceId: requestedWorkspace,
          projectId: requestedProject,
          workingSetId
        }) ?? null
      )
    }) : null;
    return Object.freeze({ workspaceId, projectId, router, worker, workspaceStore });
  };
}
