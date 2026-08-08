import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson } from "../scripts/lib/codex-redaction.mjs";
import { createMemoryAdmissionPolicy } from "../scripts/lib/memory-admission-policy.mjs";
import {
  canonicalGraphClaimId,
  canonicalGraphEntityId,
  canonicalGraphRelationId,
  createInMemoryGraphEngine,
  createKnowledgeGraphAdapter
} from "../scripts/lib/knowledge-graph-adapter.mjs";

const KEY = Buffer.alloc(32, 0x51);
const WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789ac";
const FOREIGN_WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789af";
const TOKEN = "graph-test-token-0000000000000000000000000000";

function projectionHash(records) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(records)).digest("hex")}`;
}

function statefulRemoteBackend() {
  const empty = { entities: [], claims: [], relations: [], tombstones: [] };
  let snapshot = JSON.parse(canonicalJson(empty));
  return {
    project(request) {
      const received = JSON.parse(canonicalJson(request.parameters.records));
      const independentlyDerivedHash = projectionHash(received);
      snapshot = received;
      return { ok: independentlyDerivedHash === request.parameters.projection_hash, projection_hash: independentlyDerivedHash };
    },
    query(request) {
      return createInMemoryGraphEngineFrom(snapshot).query(request);
    },
    clear() {
      snapshot = JSON.parse(canonicalJson(empty));
    },
    snapshot() {
      return JSON.parse(canonicalJson(snapshot));
    },
    snapshotHash() {
      return projectionHash(snapshot);
    }
  };
}

function createInMemoryGraphEngineFrom(records) {
  const engine = createInMemoryGraphEngine();
  engine.reset(records);
  return engine;
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-graph-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const active = new Set();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const provenanceResolver = ({ workspaceId, episodeIds, evidenceIds }) => (
    workspaceId === WORKSPACE && [...episodeIds, ...evidenceIds].every((id) => active.has(id))
  );
  const adapter = createKnowledgeGraphAdapter({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    provenanceResolver,
    clock: () => "2026-08-04T12:00:00.000Z",
    ...options
  });
  return { root, vault, active, adapter, provenanceResolver };
}

function ids(number) {
  const suffix = `018f1234-5678-7abc-8def-${String(number).padStart(12, "0")}`;
  return { episodeId: `epi_${suffix}`, evidenceId: `wev_${suffix}` };
}

function entity(workspaceId, bindingId, canonicalName, entityType = "Project", aliases = []) {
  return {
    entity_id: canonicalGraphEntityId({ workspaceId, bindingId }),
    binding_id: bindingId,
    canonical_name: canonicalName,
    entity_type: entityType,
    aliases
  };
}

function admittedClaim(workspaceId, claimKey, evidenceId, observedAt) {
  const claimId = canonicalGraphClaimId({ workspaceId, claimKey });
  const policy = createMemoryAdmissionPolicy({ clock: () => observedAt });
  const result = policy.evaluate({
    candidate: {
      candidate_id: claimId,
      workspace_id: workspaceId,
      evidence_ids: [evidenceId],
      sensitivity: "standard",
      extractor: { provider: "fixture", model: "extractor", prompt_version: "graph-v1" }
    },
    verification: {
      status: "verified",
      verifier: { provider: "fixture", model: "verifier", prompt_version: "verify-v1", independent: true },
      signals: {
        evidence_entailment: 0.99, source_trust: 0.99, extraction_agreement: 0.99,
        temporal_consistency: 0.99, contradiction_risk: 0,
        scope_valid: true, ontology_compatible: true
      }
    }
  });
  return { claimId, admission: result.admission };
}

function mutation({ workspaceId = WORKSPACE, number, claimKey, text, entities, relations, observedAt }) {
  const { episodeId, evidenceId } = ids(number);
  const { claimId, admission } = admittedClaim(workspaceId, claimKey, evidenceId, observedAt);
  return {
    provenance: { episodeId, evidenceId },
    input: {
      workspaceId,
      episodeId,
      evidenceIds: [evidenceId],
      claim: { claim_id: claimId, claim_key: claimKey, text, observed_at: observedAt },
      admission,
      entities,
      relations
    }
  };
}

function relation(workspaceId, relationKey, subject, predicate, object, validFrom, extras = {}) {
  return {
    relation_id: canonicalGraphRelationId({ workspaceId, relationKey }),
    relation_key: relationKey,
    subject_entity_id: subject,
    predicate,
    object_entity_id: object,
    valid_from: validFrom,
    valid_to: null,
    supersedes_relation_ids: extras.supersedes ?? [],
    contradicts_relation_ids: extras.contradicts ?? []
  };
}

function activate(fixtureValue, mutationValue) {
  fixtureValue.active.add(mutationValue.provenance.episodeId);
  fixtureValue.active.add(mutationValue.provenance.evidenceId);
  return fixtureValue.adapter.upsertEpisodeGraph(mutationValue.input);
}

test("KG-AC01/02/03: canonical objects are cited, aliases merge explicitly, and homonyms stay distinct", (t) => {
  const fx = fixture(t);
  const project = entity(WORKSPACE, "project:supermemory", "SuperMemory", "Project", ["SM"]);
  const tool = entity(WORKSPACE, "tool:vault", "Vault", "Tool");
  const first = mutation({
    number: 1, claimKey: "project-uses-vault", text: "SuperMemory uses Vault.",
    observedAt: "2026-01-01T00:00:00.000Z", entities: [project, tool],
    relations: [relation(WORKSPACE, "project-vault", project.entity_id, "DEPENDS_ON", tool.entity_id, "2026-01-01T00:00:00.000Z")]
  });
  const result = activate(fx, first);
  assert.equal(result.status, "canonical");
  const aliasUpdate = mutation({
    number: 2, claimKey: "project-alias", text: "SM names SuperMemory.",
    observedAt: "2026-01-02T00:00:00.000Z",
    entities: [{ ...project, aliases: ["Super Memory"] }, tool],
    relations: [relation(WORKSPACE, "project-alias-vault", project.entity_id, "RELATED_TO", tool.entity_id, "2026-01-02T00:00:00.000Z")]
  });
  activate(fx, aliasUpdate);
  const homonym = entity(WORKSPACE, "document:supermemory", "SuperMemory", "Document");
  const homonymMutation = mutation({
    number: 3, claimKey: "homonym", text: "A document has the same name.",
    observedAt: "2026-01-03T00:00:00.000Z", entities: [homonym, tool],
    relations: [relation(WORKSPACE, "homonym-vault", homonym.entity_id, "ABOUT", tool.entity_id, "2026-01-03T00:00:00.000Z")]
  });
  activate(fx, homonymMutation);
  const state = fx.adapter.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(state.entities.length, 3);
  assert.deepEqual(state.entities.find((item) => item.entity_id === project.entity_id).aliases, ["SM", "Super Memory"]);
  for (const item of [...state.entities, ...state.claims, ...state.relations]) {
    assert.equal(item.workspace_id, WORKSPACE);
    assert.ok(item.evidence_ids.length > 0);
    assert.ok(item.episode_ids.length > 0);
  }
  assert.equal(state.entities.every((item) => item.observed_at && item.admission_ids.length > 0), true);
  assert.equal(state.claims.every((item) => item.admission?.integrity_hash), true);
  assert.equal(state.relations.every((item) => item.valid_from && "valid_to" in item && item.admission_id), true);
  const files = fs.readdirSync(path.join(fx.vault, "20_professional/memory-fabric", WORKSPACE, "graph", "claims"));
  assert.ok(files.length >= 3);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(fx.vault, "20_professional/memory-fabric", WORKSPACE, "graph", "claims", file), "utf8"), /SuperMemory uses Vault/);
});

test("KG-AC04/05: contradiction closes history and as_of returns only the valid relation", (t) => {
  const fx = fixture(t);
  const a = entity(WORKSPACE, "project:a", "A");
  const b = entity(WORKSPACE, "tool:b", "B", "Tool");
  const old = relation(WORKSPACE, "old-dependency", a.entity_id, "DEPENDS_ON", b.entity_id, "2026-01-01T00:00:00.000Z");
  activate(fx, mutation({
    number: 1, claimKey: "old", text: "A depends on B.", observedAt: "2026-01-01T00:00:00.000Z",
    entities: [a, b], relations: [old]
  }));
  const replacement = relation(
    WORKSPACE, "new-status", a.entity_id, "RELATED_TO", b.entity_id,
    "2026-02-01T00:00:00.000Z", { contradicts: [old.relation_id] }
  );
  activate(fx, mutation({
    number: 2, claimKey: "new", text: "A no longer depends on B.", observedAt: "2026-02-01T00:00:00.000Z",
    entities: [a, b], relations: [replacement]
  }));
  const superseding = relation(
    WORKSPACE, "final-status", a.entity_id, "RELATED_TO", b.entity_id,
    "2026-04-01T00:00:00.000Z", { supersedes: [replacement.relation_id] }
  );
  activate(fx, mutation({
    number: 3, claimKey: "final", text: "A has a newer relationship to B.", observedAt: "2026-04-01T00:00:00.000Z",
    entities: [a, b], relations: [superseding]
  }));
  const state = fx.adapter.readCanonicalState({ workspaceId: WORKSPACE });
  const closed = state.relations.find((item) => item.relation_id === old.relation_id);
  assert.equal(closed.status, "contradicted");
  assert.equal(closed.valid_to, "2026-02-01T00:00:00.000Z");
  const january = fx.adapter.query({
    workspace_id: WORKSPACE, entity_ids: [a.entity_id], relation_types: ["DEPENDS_ON", "RELATED_TO"],
    direction: "outbound", as_of: "2026-01-15T00:00:00.000Z", max_hops: 1
  });
  assert.deepEqual(january.paths.map((item) => item.edges[0].relation_id), [old.relation_id]);
  const march = fx.adapter.query({
    workspace_id: WORKSPACE, entity_ids: [a.entity_id], relation_types: ["DEPENDS_ON", "RELATED_TO"],
    direction: "outbound", as_of: "2026-03-01T00:00:00.000Z", max_hops: 1
  });
  assert.deepEqual(march.paths.map((item) => item.edges[0].relation_id), [replacement.relation_id]);
  assert.equal(state.relations.find((item) => item.relation_id === replacement.relation_id).status, "superseded");
  const may = fx.adapter.query({
    workspace_id: WORKSPACE, entity_ids: [a.entity_id], relation_types: ["RELATED_TO"],
    direction: "outbound", as_of: "2026-05-01T00:00:00.000Z", max_hops: 1
  });
  assert.deepEqual(may.paths.map((item) => item.edges[0].relation_id), [superseding.relation_id]);
  assert.equal(state.claims.length, 3);
});

test("temporal closure preflight accepts exact replay but rejects competing and dual classifications with zero visibility", (t) => {
  const fx = fixture(t);
  const a = entity(WORKSPACE, "project:closure-a", "Closure A");
  const b = entity(WORKSPACE, "project:closure-b", "Closure B");
  const old = relation(WORKSPACE, "closure-old", a.entity_id, "DEPENDS_ON", b.entity_id, "2026-01-01T00:00:00.000Z");
  activate(fx, mutation({
    number: 51, claimKey: "closure-old", text: "Closure A depends on Closure B.",
    observedAt: "2026-01-01T00:00:00.000Z", entities: [a, b], relations: [old]
  }));
  const closer = relation(
    WORKSPACE, "closure-first", a.entity_id, "RELATED_TO", b.entity_id,
    "2026-02-01T00:00:00.000Z", { supersedes: [old.relation_id] }
  );
  const firstClosure = mutation({
    number: 52, claimKey: "closure-first", text: "Closure A has a replacement relation.",
    observedAt: "2026-02-01T00:00:00.000Z", entities: [a, b], relations: [closer]
  });
  activate(fx, firstClosure);
  const closedState = fx.adapter.readCanonicalState({ workspaceId: WORKSPACE });
  activate(fx, firstClosure);
  assert.deepEqual(fx.adapter.readCanonicalState({ workspaceId: WORKSPACE }), closedState);

  const competing = mutation({
    number: 53, claimKey: "closure-competing", text: "A competing relation tries to close the same history.",
    observedAt: "2026-02-01T00:00:00.000Z", entities: [a, b],
    relations: [relation(
      WORKSPACE, "closure-competing", a.entity_id, "RELATED_TO", b.entity_id,
      "2026-02-01T00:00:00.000Z", { supersedes: [old.relation_id] }
    )]
  });
  fx.active.add(competing.provenance.episodeId);
  fx.active.add(competing.provenance.evidenceId);
  assert.throws(() => fx.adapter.upsertEpisodeGraph(competing.input), /graph_relation_already_closed/);
  assert.deepEqual(fx.adapter.readCanonicalState({ workspaceId: WORKSPACE }), closedState);

  const dual = mutation({
    number: 54, claimKey: "closure-dual", text: "An ambiguous relation attempts two closure classes.",
    observedAt: "2026-03-01T00:00:00.000Z", entities: [a, b],
    relations: [relation(
      WORKSPACE, "closure-dual", a.entity_id, "RELATED_TO", b.entity_id,
      "2026-03-01T00:00:00.000Z", { supersedes: [closer.relation_id], contradicts: [closer.relation_id] }
    )]
  });
  fx.active.add(dual.provenance.episodeId);
  fx.active.add(dual.provenance.evidenceId);
  assert.throws(() => fx.adapter.upsertEpisodeGraph(dual.input), /graph_relation_closure_ambiguous/);
  assert.deepEqual(fx.adapter.readCanonicalState({ workspaceId: WORKSPACE }), closedState);
});

test("KG-AC06/07/12: cited three-hop paths are bounded and unsafe or foreign queries never reach a backend", (t) => {
  let queryCalls = 0;
  const memory = createInMemoryGraphEngine();
  const backend = {
    project: (request) => memory.reset(request.parameters.records),
    query: (request) => { queryCalls += 1; return memory.query(request); }
  };
  const fx = fixture(t, { graphitiBackend: backend, authToken: TOKEN });
  const nodes = ["a", "b", "c", "d"].map((name) => entity(WORKSPACE, `project:${name}`, name.toUpperCase()));
  for (let index = 0; index < 3; index += 1) {
    activate(fx, mutation({
      number: index + 1, claimKey: `hop-${index}`, text: `${nodes[index].canonical_name} depends next.`,
      observedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      entities: [nodes[index], nodes[index + 1]],
      relations: [relation(WORKSPACE, `hop-${index}`, nodes[index].entity_id, "DEPENDS_ON", nodes[index + 1].entity_id, `2026-01-0${index + 1}T00:00:00.000Z`)]
    }));
  }
  queryCalls = 0;
  const result = fx.adapter.query({
    workspace_id: WORKSPACE, entity_ids: [nodes[0].entity_id],
    relation_types: ["DEPENDS_ON"], direction: "outbound", as_of: "2026-02-01T00:00:00.000Z"
  });
  const path3 = result.paths.find((item) => item.edges.length === 3);
  assert.ok(path3);
  assert.equal(path3.edges.every((edge) => edge.admission_id && edge.evidence_ids.length && edge.episode_ids.length), true);
  assert.equal(result.query.max_hops, 3);
  assert.equal(queryCalls, 1);
  for (const unsafe of [
    { workspace_id: WORKSPACE, entity_ids: [nodes[0].entity_id], relation_types: ["DEPENDS_ON"], max_hops: 6 },
    { workspace_id: WORKSPACE, entity_ids: [nodes[0].entity_id], relation_types: ["RAW_EDGE"] },
    { workspace_id: WORKSPACE, entity_ids: [nodes[0].entity_id], relation_types: ["DEPENDS_ON"], cypher: "MATCH (n) RETURN n" }
  ]) assert.throws(() => fx.adapter.query(unsafe));
  assert.equal(queryCalls, 1);
  const foreignEntity = canonicalGraphEntityId({ workspaceId: FOREIGN_WORKSPACE, bindingId: "project:a" });
  const foreign = fx.adapter.query({
    workspace_id: WORKSPACE, entity_ids: [foreignEntity], relation_types: ["DEPENDS_ON"]
  });
  assert.deepEqual(foreign.paths, []);
  assert.equal(queryCalls, 1);
  assert.throws(() => fx.adapter.query({
    workspace_id: FOREIGN_WORKSPACE,
    entity_ids: [foreignEntity],
    relation_types: ["DEPENDS_ON"]
  }), /graph_unknown/);
  assert.equal(queryCalls, 1);
});

test("KG-AC08: complete backend loss rebuilds from encrypted canonical records with equivalent hashes", (t) => {
  const remote = statefulRemoteBackend();
  const fx = fixture(t, { graphitiBackend: remote, authToken: TOKEN });
  const a = entity(WORKSPACE, "project:a", "A");
  const b = entity(WORKSPACE, "project:b", "B");
  activate(fx, mutation({
    number: 1, claimKey: "edge", text: "A relates to B.", observedAt: "2026-01-01T00:00:00.000Z",
    entities: [a, b], relations: [relation(WORKSPACE, "edge", a.entity_id, "RELATED_TO", b.entity_id, "2026-01-01T00:00:00.000Z")]
  }));
  const expected = fx.adapter.projectionHash({ workspaceId: WORKSPACE });
  const canonical = fx.adapter.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(remote.snapshotHash(), expected);
  assert.deepEqual(remote.snapshot(), canonical);
  assert.equal(remote.snapshot().relations[0].valid_from, "2026-01-01T00:00:00.000Z");
  remote.clear();
  assert.notEqual(remote.snapshotHash(), expected);
  assert.deepEqual(remote.snapshot(), { entities: [], claims: [], relations: [], tombstones: [] });
  const rebuilt = fx.adapter.rebuildProjection({ workspaceId: WORKSPACE });
  assert.equal(rebuilt.projection_hash, expected);
  assert.equal(remote.snapshotHash(), expected);
  assert.deepEqual(remote.snapshot(), canonical);
});

test("KG-AC09: episode tombstone and admission revocation remove authority before stale projection cleanup", (t) => {
  let fault = null;
  const engine = createInMemoryGraphEngine();
  const fx = fixture(t, {
    engine,
    faultInjector: (point) => {
      if (fault && point === "after_authority_removal") {
        const code = fault;
        fault = null;
        throw Object.assign(new Error(code), { code });
      }
    }
  });
  const a = entity(WORKSPACE, "project:a", "A");
  const b = entity(WORKSPACE, "project:b", "B");
  const first = mutation({
    number: 1, claimKey: "first", text: "A supports B.", observedAt: "2026-01-01T00:00:00.000Z",
    entities: [a, b], relations: [relation(WORKSPACE, "first", a.entity_id, "SUPPORTS", b.entity_id, "2026-01-01T00:00:00.000Z")]
  });
  activate(fx, first);
  const query = () => fx.adapter.query({
    workspace_id: WORKSPACE, entity_ids: [a.entity_id], relation_types: ["SUPPORTS"],
    as_of: "2026-02-01T00:00:00.000Z"
  });
  assert.equal(query().paths.length, 1);
  fault = "episode_tombstone_crash";
  assert.throws(() => fx.adapter.tombstoneEpisode({ workspaceId: WORKSPACE, episodeId: first.provenance.episodeId }), /episode_tombstone_crash/);
  assert.deepEqual(query().paths, []);
  fx.adapter.tombstoneEpisode({ workspaceId: WORKSPACE, episodeId: first.provenance.episodeId });
  const stateAfterTombstone = fx.adapter.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(stateAfterTombstone.claims[0].status, "tombstoned");
  assert.equal(stateAfterTombstone.relations[0].status, "tombstoned");

  const c = entity(WORKSPACE, "project:c", "C");
  const second = mutation({
    number: 2, claimKey: "second", text: "C supports B.", observedAt: "2026-03-01T00:00:00.000Z",
    entities: [c, b], relations: [relation(WORKSPACE, "second", c.entity_id, "SUPPORTS", b.entity_id, "2026-03-01T00:00:00.000Z")]
  });
  activate(fx, second);
  fx.adapter.revokeAdmission({ workspaceId: WORKSPACE, admissionId: second.input.admission.admission_id });
  const revoked = fx.adapter.query({
    workspace_id: WORKSPACE, entity_ids: [c.entity_id], relation_types: ["SUPPORTS"],
    as_of: "2026-04-01T00:00:00.000Z"
  });
  assert.deepEqual(revoked.paths, []);
  assert.equal(fx.adapter.rebuildProjection({ workspaceId: WORKSPACE }).projected, true);
  assert.deepEqual(revoked.paths, []);
});

test("graph exposes one centralized current-authority decision for recall, ontology, and enrichment", (t) => {
  const fx = fixture(t);
  const a = entity(WORKSPACE, "project:authority-a", "Authority A");
  const b = entity(WORKSPACE, "project:authority-b", "Authority B");
  const item = mutation({
    number: 61,
    claimKey: "central-authority",
    text: "Authority A relates to Authority B.",
    observedAt: "2026-01-01T00:00:00.000Z",
    entities: [a, b],
    relations: [relation(WORKSPACE, "central-authority", a.entity_id, "RELATED_TO", b.entity_id, "2026-01-01T00:00:00.000Z")]
  });
  activate(fx, item);
  assert.equal(fx.adapter.readAuthorizedState({ workspaceId: WORKSPACE }).claims.length, 1);
  assert.equal(fx.adapter.resolveAuthorizedClaims({ workspaceId: WORKSPACE, claimIds: [item.input.claim.claim_id] }).length, 1);
  fx.active.delete(item.provenance.evidenceId);
  assert.equal(fx.adapter.readAuthorizedState({ workspaceId: WORKSPACE }).claims.length, 0);
  assert.equal(fx.adapter.resolveAuthorizedClaims({ workspaceId: WORKSPACE, claimIds: [item.input.claim.claim_id] }).length, 0);
  assert.deepEqual(fx.adapter.query({
    workspace_id: WORKSPACE,
    entity_ids: [a.entity_id],
    relation_types: ["RELATED_TO"],
    as_of: "2026-02-01T00:00:00.000Z"
  }).paths, []);
});

test("malformed Graphiti project and query responses use authenticated parameterized direct-Neo4j fallback", (t) => {
  const requests = [];
  let validRelationId;
  let validEntities;
  const graphiti = {
    project: () => ({ ok: true }),
    query: () => ({ malformed: true })
  };
  const neo4j = {
    project: (request) => {
      requests.push(request);
      return { ok: true, projection_hash: request.parameters.projection_hash };
    },
    query: (request) => {
      requests.push(request);
      return { paths: [
        { entity_ids: validEntities, relation_ids: [validRelationId] },
        { entity_ids: [validEntities[0], `ent_${"f".repeat(64)}`], relation_ids: [`rel_${"f".repeat(64)}`] }
      ] };
    }
  };
  const fx = fixture(t, { graphitiBackend: graphiti, directNeo4jBackend: neo4j, authToken: TOKEN });
  const a = entity(WORKSPACE, "project:a", "A");
  const b = entity(WORKSPACE, "project:b", "B");
  const edge = relation(WORKSPACE, "fallback", a.entity_id, "RELATED_TO", b.entity_id, "2026-01-01T00:00:00.000Z");
  validRelationId = edge.relation_id;
  validEntities = [a.entity_id, b.entity_id];
  activate(fx, mutation({
    number: 1, claimKey: "fallback", text: "A relates to B.", observedAt: "2026-01-01T00:00:00.000Z",
    entities: [a, b], relations: [edge]
  }));
  const result = fx.adapter.query({
    workspace_id: WORKSPACE, entity_ids: [a.entity_id], relation_types: ["RELATED_TO"], max_hops: 1
  });
  assert.equal(result.backend, "direct-neo4j");
  assert.equal(result.paths.length, 1);
  assert.equal(requests.every((request) => request.headers.authorization === `Bearer ${TOKEN}`), true);
  assert.equal(requests.every((request) => request.statement_id && !("cypher" in request)), true);
  assert.equal(requests.at(-1).parameters.max_hops, 1);
});

test("thrown Graphiti project and query failures use successful direct-Neo4j fallback", (t) => {
  const requests = [];
  let edge;
  let nodes;
  const graphiti = {
    project: () => { throw Object.assign(new Error("project down"), { code: "graphiti_project_down" }); },
    query: () => { throw Object.assign(new Error("query down"), { code: "graphiti_query_down" }); }
  };
  const neo4j = {
    project: (request) => {
      requests.push(request);
      return { ok: true, projection_hash: projectionHash(request.parameters.records) };
    },
    query: (request) => {
      requests.push(request);
      return { paths: [{ entity_ids: nodes, relation_ids: [edge.relation_id] }] };
    }
  };
  const fx = fixture(t, { graphitiBackend: graphiti, directNeo4jBackend: neo4j, authToken: TOKEN });
  const a = entity(WORKSPACE, "project:thrown-a", "Thrown A");
  const b = entity(WORKSPACE, "project:thrown-b", "Thrown B");
  edge = relation(WORKSPACE, "thrown", a.entity_id, "RELATED_TO", b.entity_id, "2026-01-01T00:00:00.000Z");
  nodes = [a.entity_id, b.entity_id];
  const projected = activate(fx, mutation({
    number: 55, claimKey: "thrown", text: "Thrown A relates to Thrown B.",
    observedAt: "2026-01-01T00:00:00.000Z", entities: [a, b], relations: [edge]
  }));
  assert.equal(projected.projection.backend, "direct-neo4j");
  const result = fx.adapter.query({
    workspace_id: WORKSPACE, entity_ids: [a.entity_id], relation_types: ["RELATED_TO"], max_hops: 1
  });
  assert.equal(result.backend, "direct-neo4j");
  assert.equal(result.paths.length, 1);
  assert.equal(requests.every((request) => request.headers.authorization === `Bearer ${TOKEN}`), true);
  assert.equal(requests.every((request) => request.statement_id && !("cypher" in request)), true);
});

test("canonical mutation is idempotent and projection failure is recoverable without remote truth", (t) => {
  let unavailable = true;
  const remote = {
    project: (request) => {
      if (unavailable) throw Object.assign(new Error("offline"), { code: "projection_offline" });
      return { ok: true, projection_hash: request.parameters.projection_hash };
    },
    query: () => ({ paths: [] })
  };
  const fx = fixture(t, { graphitiBackend: remote, directNeo4jBackend: remote, authToken: TOKEN });
  const a = entity(WORKSPACE, "project:a", "A");
  const b = entity(WORKSPACE, "project:b", "B");
  const item = mutation({
    number: 1, claimKey: "idempotent", text: "A affects B.", observedAt: "2026-01-01T00:00:00.000Z",
    entities: [a, b], relations: [relation(WORKSPACE, "idempotent", a.entity_id, "AFFECTS", b.entity_id, "2026-01-01T00:00:00.000Z")]
  });
  const first = activate(fx, item);
  assert.equal(first.projection.projected, false);
  const graphRoot = path.join(fx.vault, "20_professional/memory-fabric", WORKSPACE, "graph");
  const canonicalCounts = () => Object.fromEntries(["entities", "claims", "relations"].map((kind) => [
    kind,
    fs.readdirSync(path.join(graphRoot, kind)).length
  ]));
  const beforeRetry = canonicalCounts();
  activate(fx, item);
  assert.deepEqual(canonicalCounts(), beforeRetry);
  let state = fx.adapter.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(state.claims.length, 1);
  assert.equal(state.relations.length, 1);
  unavailable = false;
  const recovered = fx.adapter.rebuildProjection({ workspaceId: WORKSPACE });
  assert.equal(recovered.projected, true);
  state = fx.adapter.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(state.claims.length, 1);
});

test("atomic graph batches hide every staged revision until the immutable commit is visible", (t) => {
  let crashAfter = 2;
  const fx = fixture(t, {
    faultInjector: (point, value) => {
      if (point === "after_staged_record" && value.staged_count === crashAfter) {
        crashAfter = null;
        throw Object.assign(new Error("injected_batch_crash"), { code: "injected_batch_crash" });
      }
    }
  });
  const a = entity(WORKSPACE, "project:atomic-a", "Atomic A");
  const b = entity(WORKSPACE, "project:atomic-b", "Atomic B");
  const item = mutation({
    number: 41, claimKey: "atomic", text: "Atomic A depends on Atomic B.",
    observedAt: "2026-05-01T00:00:00.000Z", entities: [a, b],
    relations: [relation(WORKSPACE, "atomic", a.entity_id, "DEPENDS_ON", b.entity_id, "2026-05-01T00:00:00.000Z")]
  });
  fx.active.add(item.provenance.episodeId);
  fx.active.add(item.provenance.evidenceId);
  assert.throws(() => fx.adapter.upsertEpisodeGraph(item.input), /injected_batch_crash/);
  assert.deepEqual(fx.adapter.readCanonicalState({ workspaceId: WORKSPACE }), {
    entities: [], claims: [], relations: [], tombstones: []
  });
  const committed = fx.adapter.upsertEpisodeGraph(item.input);
  assert.equal(committed.status, "canonical");
  const state = fx.adapter.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(state.claims.length, 1);
  assert.equal(state.entities.length, 2);
  assert.equal(state.relations.length, 1);
});

test("preflight rejects non-canonical relation IDs without exposing any canonical truth", (t) => {
  const fx = fixture(t);
  const a = entity(WORKSPACE, "project:preflight-a", "Preflight A");
  const b = entity(WORKSPACE, "project:preflight-b", "Preflight B");
  const item = mutation({
    number: 42, claimKey: "preflight", text: "Preflight A relates to Preflight B.",
    observedAt: "2026-05-02T00:00:00.000Z", entities: [a, b],
    relations: [{
      ...relation(WORKSPACE, "preflight", a.entity_id, "RELATED_TO", b.entity_id, "2026-05-02T00:00:00.000Z"),
      relation_id: `rel_${"f".repeat(64)}`
    }]
  });
  fx.active.add(item.provenance.episodeId);
  fx.active.add(item.provenance.evidenceId);
  assert.throws(() => fx.adapter.upsertEpisodeGraph(item.input), /graph_relation_key_invalid/);
  assert.deepEqual(fx.adapter.readCanonicalState({ workspaceId: WORKSPACE }), {
    entities: [], claims: [], relations: [], tombstones: []
  });
});

test("a missing remote projection hash never creates a complete checkpoint", (t) => {
  const remote = { project: () => ({ ok: true }), query: () => ({ paths: [] }) };
  const fx = fixture(t, { graphitiBackend: remote, directNeo4jBackend: remote, authToken: TOKEN });
  const a = entity(WORKSPACE, "project:hash-a", "Hash A");
  const b = entity(WORKSPACE, "project:hash-b", "Hash B");
  const result = activate(fx, mutation({
    number: 43, claimKey: "hash", text: "Hash A affects Hash B.",
    observedAt: "2026-05-03T00:00:00.000Z", entities: [a, b],
    relations: [relation(WORKSPACE, "hash", a.entity_id, "AFFECTS", b.entity_id, "2026-05-03T00:00:00.000Z")]
  }));
  assert.equal(result.projection.projected, false);
  const checkpointRoot = path.join(fx.vault, "20_professional/memory-fabric", WORKSPACE, "graph", "checkpoints");
  assert.equal(fs.existsSync(checkpointRoot), false);
});

test("a mismatched remote projection hash never creates a complete checkpoint", (t) => {
  const remote = {
    project: () => ({ ok: true, projection_hash: `sha256:${"0".repeat(64)}` }),
    query: () => ({ paths: [] })
  };
  const fx = fixture(t, { graphitiBackend: remote, directNeo4jBackend: remote, authToken: TOKEN });
  const a = entity(WORKSPACE, "project:mismatch-a", "Mismatch A");
  const b = entity(WORKSPACE, "project:mismatch-b", "Mismatch B");
  const result = activate(fx, mutation({
    number: 44, claimKey: "mismatch", text: "Mismatch A affects Mismatch B.",
    observedAt: "2026-05-04T00:00:00.000Z", entities: [a, b],
    relations: [relation(WORKSPACE, "mismatch", a.entity_id, "AFFECTS", b.entity_id, "2026-05-04T00:00:00.000Z")]
  }));
  assert.equal(result.projection.projected, false);
  const checkpointRoot = path.join(fx.vault, "20_professional/memory-fabric", WORKSPACE, "graph", "checkpoints");
  assert.equal(fs.existsSync(checkpointRoot), false);
});

test("async graphd projection is hash-acknowledged and every returned path is canonically revalidated", async (t) => {
  let projected = null;
  let validRelationId = null;
  const remoteBackend = {
    async project(request) {
      projected = request.parameters.records;
      return { ok: true, projection_hash: request.parameters.projection_hash };
    },
    async query(request) {
      return {
        paths: [
          {
            entity_ids: [request.parameters.entity_ids[0], projected.entities[1].entity_id],
            relation_ids: [validRelationId]
          },
          {
            entity_ids: [request.parameters.entity_ids[0], projected.entities[1].entity_id],
            relation_ids: [`rel_${"f".repeat(64)}`]
          }
        ]
      };
    }
  };
  const fx = fixture(t, { remoteBackend });
  const a = entity(WORKSPACE, "project:remote-a", "Remote A");
  const b = entity(WORKSPACE, "project:remote-b", "Remote B");
  const edge = relation(
    WORKSPACE,
    "remote-edge",
    a.entity_id,
    "RELATED_TO",
    b.entity_id,
    "2026-01-01T00:00:00.000Z"
  );
  validRelationId = edge.relation_id;
  activate(fx, mutation({
    number: 70,
    claimKey: "remote-edge",
    text: "Remote A relates to Remote B.",
    observedAt: "2026-01-01T00:00:00.000Z",
    entities: [a, b],
    relations: [edge]
  }));

  const rebuilt = await fx.adapter.rebuildProjectionAsync({ workspaceId: WORKSPACE });
  assert.equal(rebuilt.backend, "graphd-http");
  assert.equal(rebuilt.projection_hash, fx.adapter.projectionHash({ workspaceId: WORKSPACE }));
  const result = await fx.adapter.queryAsync({
    workspace_id: WORKSPACE,
    entity_ids: [a.entity_id],
    relation_types: ["RELATED_TO"],
    direction: "outbound",
    as_of: "2026-08-04T12:00:00.000Z",
    max_hops: 1
  });
  assert.equal(result.backend, "graphd-http");
  assert.equal(result.paths.length, 1);
  assert.equal(result.paths[0].edges[0].relation_id, validRelationId);
  assert.deepEqual(result.paths[0].edges[0].evidence_ids, projected.relations[0].evidence_ids);
});
