import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createCodexMemoryRouter } from "../scripts/lib/codex-memory-router.mjs";

const WORKSPACE_ID = "ws_018f7c0e-7b7d-7abc-8def-0123456789ab";
const PROJECT_ID = "prj_018f7c0e-7b7d-7abc-8def-0123456789ac";
const WORKING_SET_ID = "wset_018f7c0e-7b7d-7abc-8def-0123456789ad";
const corpus = JSON.parse(fs.readFileSync(new URL("./fixtures/memory-router/corpus.v1.json", import.meta.url), "utf8"));

function workingResult() {
  return {
    results: [{
      text: "Décision architecture graph-first",
      score: 0.9,
      evidence_ids: ["wev-1"],
      episode_ids: ["wep-1"],
      citations: [{ kind: "working_evidence", evidence_id: "wev-1" }],
      valid_from: "2026-08-08T10:00:00.000Z",
      valid_to: null
    }]
  };
}

test("hybrid recall preserves healthy results and explicit partial coverage", async () => {
  const workingRecall = {
    assertBound: () => ({ manifest: { working_set_id: WORKING_SET_ID } }),
    search: async () => workingResult(), map: () => ({}), open: () => ({}), neighbors: () => ({})
  };
  const durableRecall = {
    search: async () => new Promise(() => {}),
    get: () => ({}), explainCitation: () => ({})
  };
  const graphAdapter = {
    readAuthorizedState: () => ({ entities: [], relations: [] }),
    query: () => ({ paths: [] })
  };
  let tick = 0;
  const router = createCodexMemoryRouter({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    workingRecall,
    durableRecall,
    graphAdapter,
    timeoutMs: 20,
    monotonicNow: () => tick++
  });
  const result = await router.recall({
    working_set_id: WORKING_SET_ID,
    strategy: "hybrid",
    query: "architecture"
  });
  assert.equal(result.coverage.working, "complete");
  assert.equal(result.coverage.durable, "timeout");
  assert.equal(result.partial, true);
  assert.equal(result.results[0].memory_tiers.includes("working"), true);
  assert.ok(result.trace.first_useful_ms <= 250);
  assert.ok(result.trace.complete_ms <= 1_500);
});

test("graph recall accepts only typed bounded queries and records explainable paths", async () => {
  let received;
  const workingRecall = {
    assertBound: () => ({ manifest: { working_set_id: WORKING_SET_ID } }),
    search: async () => ({ results: [] }), map: () => ({}), open: () => ({}), neighbors: () => ({})
  };
  const path = {
    path_id: "gpath-1",
    entity_ids: ["ent-a", "ent-b"],
    edges: [{
      relation_id: "rel-1", claim_id: "clm-1", admission_id: "adm-1",
      claim_text: "A dépend de B", evidence_ids: ["wev-1"], episode_ids: ["wep-1"],
      valid_from: "2026-01-01T00:00:00.000Z", valid_to: null
    }]
  };
  const graphAdapter = {
    readAuthorizedState: () => ({
      entities: [{ entity_id: "ent-a", canonical_name: "A", aliases: [] }],
      relations: [{ predicate: "depends_on" }]
    }),
    query: (ast) => { received = ast; return { paths: [path] }; }
  };
  const router = createCodexMemoryRouter({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingRecall, graphAdapter });
  const result = await router.graphQuery({
    working_set_id: WORKING_SET_ID,
    query: "Pourquoi A dépend de B?",
    entity_ids: ["ent-a"],
    relation_types: ["depends_on"]
  });
  assert.equal(received.workspace_id, WORKSPACE_ID);
  assert.equal(received.max_hops, 3);
  assert.equal(result.results[0].path_ids[0], "gpath-1");
  assert.equal(router.explainPath({ working_set_id: WORKING_SET_ID, path_id: "gpath-1" }).path.path_id, "gpath-1");
  await assert.rejects(router.graphQuery({
    working_set_id: WORKING_SET_ID,
    query: "A",
    cypher: "MATCH (n) RETURN n"
  }), /graph_query_unsafe/);
  await assert.rejects(router.graphQuery({
    working_set_id: WORKING_SET_ID,
    query: "A",
    max_hops: 6
  }), /graph_query_hops_invalid/);
});

test("auto routing follows the versioned deterministic intent corpus", async () => {
  const workingRecall = {
    assertBound: () => ({ manifest: { working_set_id: WORKING_SET_ID } }),
    search: async () => ({ results: [] }), map: () => ({}), open: () => ({}), neighbors: () => ({})
  };
  const durableRecall = { search: async () => ({ results: [] }), get: () => ({}), explainCitation: () => ({}) };
  const graphAdapter = {
    readAuthorizedState: () => ({ entities: [], relations: [] }),
    query: () => ({ paths: [] })
  };
  const router = createCodexMemoryRouter({
    workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingRecall, durableRecall, graphAdapter
  });
  for (const item of corpus.cases) {
    const result = await router.recall({
      working_set_id: WORKING_SET_ID,
      strategy: "auto",
      query: item.query
    });
    assert.equal(result.strategy_used, item.expected_strategy, item.query);
    assert.notEqual(result.routing_reason, "");
  }
});

test("cross-tier dedup retains every tier, admission, temporal window and citation", async () => {
  const workingRecall = {
    assertBound: () => ({ manifest: { working_set_id: WORKING_SET_ID } }),
    search: async () => ({ results: [{
      text: "La décision D dépend de C", score: 0.9, evidence_ids: ["wev-1"],
      episode_ids: ["wep-1"], admission_ids: ["adm-working"], admission_states: ["active"],
      valid_from: "2026-01-01T00:00:00.000Z", valid_to: null,
      citations: [{ kind: "working_evidence", evidence_id: "wev-1" }]
    }] }),
    map: () => ({}), open: () => ({}), neighbors: () => ({})
  };
  const durableRecall = { search: async () => ({ results: [{
    memory_id: "mem-1", excerpt: "La décision D dépend de C", score: 0.8,
    admission_ids: ["adm-durable"], admission_state: "active",
    citation: { candidate_id: "cand-1" }, valid_from: "2026-02-01T00:00:00.000Z", valid_to: null
  }] }), get: () => ({}), explainCitation: () => ({}) };
  const graphAdapter = {
    readAuthorizedState: () => ({
      entities: [{ entity_id: "ent-d", canonical_name: "décision", aliases: [] }],
      relations: [{ predicate: "depends_on" }]
    }),
    query: () => ({ paths: [{
      path_id: "path-1", entity_ids: ["ent-d", "ent-c"], edges: [{
        relation_id: "rel-1", claim_id: "clm-1", admission_id: "adm-graph",
        admission_state: "active", claim_text: "La décision D dépend de C",
        evidence_ids: ["wev-2"], episode_ids: ["wep-2"],
        valid_from: "2026-03-01T00:00:00.000Z", valid_to: null
      }]
    }] })
  };
  const router = createCodexMemoryRouter({
    workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingRecall, durableRecall, graphAdapter
  });
  const result = await router.recall({
    working_set_id: WORKING_SET_ID, strategy: "hybrid", query: "décision dépend"
  });
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0].memory_tiers, ["durable", "graph", "working"]);
  assert.deepEqual(result.results[0].admission_ids, ["adm-durable", "adm-graph", "adm-working"]);
  assert.equal(result.results[0].temporal_intervals.length, 3);
  assert.equal(result.results[0].citations.length, 3);
  assert.deepEqual(result.results[0].evidence_ids, ["wev-1", "wev-2"]);
});

test("HN-AC20/21 + TR-AC08: Hindsight and Neo4j failures degrade independently without stopping capture-facing recall", async () => {
  const workingRecall = {
    assertBound: () => ({ manifest: { working_set_id: WORKING_SET_ID } }),
    search: async () => workingResult(), map: () => ({}), open: () => ({}), neighbors: () => ({})
  };
  let hindsightOffline = true;
  let graphOffline = false;
  const hindsightGateway = {
    recall: async () => {
      if (hindsightOffline) throw Object.assign(new Error("offline"), { code: "backend_unavailable" });
      return { results: [{ id: "fact_1", fact_type: "world", memory_id: "mem_1", text: "Durable fact", score: 0.8, citation: { memory_id: "mem_1" } }] };
    },
    status: async () => ({ available: !hindsightOffline })
  };
  const graphAdapter = {
    readAuthorizedState: () => ({
      entities: [{ entity_id: "ent-a", canonical_name: "A", aliases: [] }],
      relations: [{ predicate: "RELATED_TO" }]
    }),
    queryAsync: async () => {
      if (graphOffline) throw Object.assign(new Error("offline"), { code: "backend_unavailable" });
      return { paths: [] };
    },
    query: () => ({ paths: [] })
  };
  const router = createCodexMemoryRouter({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    workingRecall,
    hindsightGateway,
    graphAdapter
  });
  const withoutHindsight = await router.recall({
    working_set_id: WORKING_SET_ID,
    query: "A relation",
    strategy: "hybrid",
    entity_ids: ["ent-a"],
    relation_types: ["RELATED_TO"]
  });
  assert.equal(withoutHindsight.coverage.working, "complete");
  assert.equal(withoutHindsight.coverage.graph, "complete");
  assert.equal(withoutHindsight.coverage.durable, "unavailable");
  assert.equal(withoutHindsight.partial, true);
  hindsightOffline = false;
  graphOffline = true;
  const withoutNeo4j = await router.recall({
    working_set_id: WORKING_SET_ID,
    query: "A relation",
    strategy: "hybrid",
    entity_ids: ["ent-a"],
    relation_types: ["RELATED_TO"]
  });
  assert.equal(withoutNeo4j.coverage.working, "complete");
  assert.equal(withoutNeo4j.coverage.durable, "complete");
  assert.equal(withoutNeo4j.coverage.graph, "unavailable");
  assert.ok(withoutNeo4j.results.some((item) => item.memory_tiers.includes("durable")));
});

test("TR-AC04/06/07: exhaustive aggregation is proven once and unresolved gaps abstain after three rounds", async () => {
  const workingRecall = {
    assertBound: () => ({ manifest: { working_set_id: WORKING_SET_ID } }),
    search: async () => ({ results: [], pagination: { complete: true } }),
    map: () => ({}), open: () => ({}), neighbors: () => ({})
  };
  const durableRecall = { search: async () => ({ results: [] }), get: () => ({}), explainCitation: () => ({}) };
  const event = {
    relation_id: "rel-event", claim_id: "clm-event", claim_text: "Incident enregistré",
    predicate: "OCCURRED_IN", evidence_ids: ["wev-event"], episode_ids: ["epi-event"],
    admission_id: "adm-event", subject_entity_id: "ent-a", object_entity_id: "ent-b",
    valid_from: "2026-08-01T00:00:00.000Z", valid_to: null,
    event_time: {
      kind: "interval", earliest: "2026-08-01T00:00:00.000Z", latest: "2026-08-01T23:59:59.999Z",
      granularity: "day", anchor_timestamp: "2026-08-08T00:00:00.000Z", normalization: "explicit"
    }
  };
  const graphAdapter = {
    readAuthorizedState: () => ({ entities: [], relations: [] }),
    query: () => ({ paths: [] }),
    queryEvents: () => ({
      results: [event],
      pagination: { complete: true, coverage_complete: true, unresolved_event_time_count: 0, total: 1 }
    })
  };
  const router = createCodexMemoryRouter({
    workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, workingRecall,
    topicRecall: workingRecall, durableRecall, graphAdapter,
    wallClock: () => "2026-08-08T00:00:00.000Z"
  });
  const exact = await router.recall({
    working_set_id: WORKING_SET_ID,
    query: "Combien d'incidents le 2026-08-01 ?"
  });
  assert.equal(exact.retrieval_plan.intent, "aggregation");
  assert.equal(exact.evidence_coverage.coverage.aggregation, "exact");
  assert.equal(exact.rounds, 1);
  assert.equal(exact.abstention_required, false);

  const unavailable = createCodexMemoryRouter({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    workingRecall,
    durableRecall,
    graphAdapter: {
      readAuthorizedState: () => ({ entities: [], relations: [] }),
      query: () => ({ paths: [] }),
      queryEvents: () => { throw Object.assign(new Error("offline"), { code: "backend_unavailable" }); }
    },
    wallClock: () => "2026-08-08T00:00:00.000Z"
  });
  const partial = await unavailable.recall({
    working_set_id: WORKING_SET_ID,
    query: "Combien d'incidents le 2026-08-01 ?"
  });
  assert.equal(partial.rounds, 3);
  assert.equal(partial.abstention_required, true);
  assert.equal(partial.partial, true);
  assert.equal(partial.trace.attempts.filter((item) => item.source === "events").length, 3);
});
