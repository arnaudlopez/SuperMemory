import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexCaptureStore } from "../scripts/lib/codex-capture-store.mjs";
import { createCodexMemoryRouter } from "../scripts/lib/codex-memory-router.mjs";
import { createCodexWorkingRecall } from "../scripts/lib/codex-working-recall.mjs";
import { createKnowledgeGraphAdapter } from "../scripts/lib/knowledge-graph-adapter.mjs";
import { createMemoryAdmissionPolicy } from "../scripts/lib/memory-admission-policy.mjs";
import {
  createCanonicalWorkingEpisodeSource,
  createMemoryImproveWorker
} from "../scripts/lib/memory-improve-worker.mjs";
import { createWorkspaceOntologyRegistry } from "../scripts/lib/ontology-registry.mjs";

const KEY = Buffer.alloc(32, 0x62);
const WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789ac";
const PROJECT = "prj_018f1234-5678-7abc-8def-0123456789ab";
const RETRIEVAL_CORPUS = JSON.parse(fs.readFileSync(
  "tests/fixtures/memory-improve-worker/corpus.v1.json",
  "utf8"
));
const NOW = "2026-08-08T10:01:00.000Z";

test("Memory Fabric v2 E2E: ingest → independent auto-admission → temporal graph → cited hybrid recall", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-fabric-v2-e2e-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let reviewCandidateCalls = 0;
  const captureStore = createCodexCaptureStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    clock: () => NOW,
    workingMemory: { enabled: true, capacityTokens: 100_000 }
  });
  const source = createCanonicalWorkingEpisodeSource({
    workingStore: captureStore.workingStore,
    captureStore
  });
  let graph;
  const ontology = createWorkspaceOntologyRegistry({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    claimAuthorityResolver: (input) => graph.resolveAuthorizedClaims(input),
    retrievalCorpus: RETRIEVAL_CORPUS,
    clock: () => NOW
  });
  graph = createKnowledgeGraphAdapter({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    ontologyRegistry: ontology,
    provenanceResolver: ({ episodeIds, evidenceIds }) => {
      const evidence = source.listCanonicalEvidence({ workspaceId: WORKSPACE });
      return episodeIds.every((id) => evidence.some((item) => item.reopened && item.episode.episode_id === id)) &&
        evidenceIds.every((id) => evidence.some((item) => item.reopened && item.evidence.evidence_id === id));
    },
    clock: () => NOW
  });
  const worker = createMemoryImproveWorker({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    enabled: true,
    episodeSource: source,
    graphAdapter: graph,
    ontologyRegistry: ontology,
    admissionPolicy: createMemoryAdmissionPolicy({ clock: () => NOW }),
    extractor: {
      identity: { provider: "fixture", model: "extractor-v1", prompt_version: "kg-extract-v1" },
      extract: ({ payload }) => payload
    },
    verifier: {
      identity: {
        provider: "fixture",
        model: "independent-verifier-v1",
        prompt_version: "kg-verify-v1",
        independent: true
      },
      verify: () => ({
        status: "verified",
        signals: {
          evidence_entailment: 0.99,
          source_trust: 0.99,
          extraction_agreement: 0.99,
          temporal_consistency: 0.99,
          contradiction_risk: 0,
          scope_valid: true,
          ontology_compatible: true,
          alias_binding_verified: true
        }
      })
    },
    clock: () => NOW
  });

  const capture = captureStore.ingest({
    adapter: "hook",
    adapter_version: "1.0.0",
    external_event_id: "memory-fabric-v2-e2e-1",
    project_id: PROJECT,
    workspace_id: WORKSPACE,
    checkout_id: "co_018f1234-5678-7abc-8def-0123456789ad",
    session_id: "ses_hook:memory-fabric-v2-e2e",
    thread_id: "memory-fabric-v2-e2e",
    turn_id: "turn_memory-fabric-v2-e2e:1",
    item_id: "item-memory-fabric-v2-e2e-1",
    event_type: "tool.completed",
    occurred_at: "2026-08-08T10:00:00.000Z",
    capture_level: "standard",
    sequence: 1,
    payload: {
      claim_key: "supermemory-depends-on-graphd",
      text: "SuperMemory depends on GraphD.",
      entities: [
        {
          binding_id: "project:supermemory",
          canonical_name: "SuperMemory",
          entity_type: "Project",
          aliases: ["Super Memory"]
        },
        {
          binding_id: "service:graphd",
          canonical_name: "GraphD",
          entity_type: "Tool",
          aliases: []
        }
      ],
      relations: [{
        relation_key: "supermemory-graphd-dependency",
        subject_binding_id: "project:supermemory",
        predicate: "DEPENDS_ON",
        object_binding_id: "service:graphd"
      }],
      ontology_proposals: []
    }
  });
  assert.equal(capture.working.complete, true);
  assert.equal(capture.working.reopen_verified, true);

  const improved = worker.process();
  assert.equal(improved.status, "complete");
  assert.equal(improved.processed, 1);
  const canonical = graph.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(canonical.claims.length, 1);
  assert.equal(canonical.claims[0].admission.decision, "auto_activate");
  assert.equal(canonical.relations.length, 1);
  assert.equal(canonical.relations[0].valid_from, NOW);
  assert.equal(reviewCandidateCalls, 0);

  const workingRecall = createCodexWorkingRecall({
    workingStore: captureStore.workingStore,
    captureStore,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    clock: () => NOW
  });
  const router = createCodexMemoryRouter({
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    workingRecall,
    graphAdapter: graph,
    durableRecall: {
      search: async () => ({
        results: [{
          memory_id: "mem_fixture_supermemory_graphd",
          text: "SuperMemory depends on GraphD.",
          score: 0.9,
          admission_ids: [canonical.claims[0].admission.admission_id],
          admission_states: ["active"]
        }]
      })
    },
    wallClock: () => NOW
  });
  const recalled = await router.recall({
    working_set_id: capture.working.working_set_id,
    query: "How does SuperMemory depend on GraphD?",
    strategy: "hybrid",
    entity_ids: [canonical.entities.find((item) => item.binding_id === "project:supermemory").entity_id],
    relation_types: ["DEPENDS_ON"],
    direction: "outbound",
    max_hops: 3
  });

  assert.equal(recalled.partial, false);
  assert.deepEqual(recalled.coverage, { working: "complete", graph: "complete", durable: "complete" });
  assert.ok(recalled.results.some((item) => item.memory_tiers.includes("working")));
  const hybrid = recalled.results.find((item) => (
    item.memory_tiers.includes("graph") && item.memory_tiers.includes("durable")
  ));
  assert.ok(hybrid);
  assert.ok(hybrid.citations.some((citation) => citation.kind === "graph_edge"));
  assert.ok(hybrid.citations.some((citation) => citation.kind === "durable_memory"));
  assert.deepEqual(hybrid.evidence_ids, [capture.working.evidence_id]);
  assert.deepEqual(hybrid.episode_ids, [capture.working.episode_id]);
  assert.deepEqual(hybrid.admission_states, ["active"]);
});
