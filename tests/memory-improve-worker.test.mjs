import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson } from "../scripts/lib/codex-redaction.mjs";
import { createCodexCaptureStore } from "../scripts/lib/codex-capture-store.mjs";
import { createKnowledgeGraphAdapter, canonicalGraphRelationId } from "../scripts/lib/knowledge-graph-adapter.mjs";
import { createMemoryAdmissionPolicy } from "../scripts/lib/memory-admission-policy.mjs";
import {
  createCanonicalWorkingEpisodeSource,
  createMemoryImproveWorker,
  processImproveWorkspaces
} from "../scripts/lib/memory-improve-worker.mjs";
import { createWorkspaceOntologyRegistry } from "../scripts/lib/ontology-registry.mjs";

const KEY = Buffer.alloc(32, 0x71);
const WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789ac";
const OTHER_WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789af";
const RETRIEVAL_CORPUS = JSON.parse(fs.readFileSync("tests/fixtures/memory-improve-worker/corpus.v1.json", "utf8"));

function episode(number, payload, workspaceId = WORKSPACE) {
  const suffix = `018f1234-5678-7abc-8def-${String(number).padStart(12, "0")}`;
  return {
    schema: "supermemory.episode.v1",
    episode_id: `epi_${suffix}`,
    workspace_id: workspaceId,
    project_id: "prj_018f1234-5678-7abc-8def-0123456789ab",
    session_id: "ses_improve:test",
    source_event_ids: [`event-epi_${suffix}`],
    evidence_ids: [`wev_${suffix}`],
    observed_at: `2026-08-04T10:00:${String(number).padStart(2, "0")}.000Z`,
    sensitivity: "standard",
    status: "active",
    payload
  };
}

function extraction({ claimKey, text, relationKey, predicate = "RELATED_TO", subjectBinding = "project:a", subjectType = "Project", subjectName = "A", subjectAliases = [], objectBinding = "tool:b", objectType = "Tool", objectName = "B", extras = {}, ontologyProposals = [] }) {
  return {
    claim_key: claimKey,
    text,
    entities: [
      { binding_id: subjectBinding, canonical_name: subjectName, entity_type: subjectType, aliases: subjectAliases },
      { binding_id: objectBinding, canonical_name: objectName, entity_type: objectType, aliases: [] }
    ],
    relations: [{
      relation_key: relationKey,
      subject_binding_id: subjectBinding,
      predicate,
      object_binding_id: objectBinding,
      ...extras
    }],
    ontology_proposals: ontologyProposals
  };
}

function fixture(t, {
  workspaceId = WORKSPACE,
  episodes = [],
  verificationStatus = "verified",
  temporary = false,
  sourceMutator = (source) => source
} = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-improve-"));
  const vault = path.join(temporaryRoot, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  let now = "2026-08-04T10:01:00.000Z";
  let currentVerificationStatus = verificationStatus;
  const clock = () => now;
  const active = new Set(episodes.flatMap((item) => [item.episode_id, ...item.evidence_ids]));
  const closedSessions = new Map();
  let graph;
  const ontology = createWorkspaceOntologyRegistry({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId,
    claimAuthorityResolver: (input) => graph.resolveAuthorizedClaims(input),
    retrievalCorpus: RETRIEVAL_CORPUS,
    clock
  });
  graph = createKnowledgeGraphAdapter({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId,
    ontologyRegistry: ontology,
    provenanceResolver: ({ workspaceId: requested, episodeIds, evidenceIds }) => (
      requested === workspaceId && [...episodeIds, ...evidenceIds].every((id) => active.has(id))
    ),
    clock
  });
  const policy = createMemoryAdmissionPolicy({ clock });
  const extractor = {
    identity: { provider: "fixture", model: "extractor", prompt_version: "extract-v1" },
    extract: ({ payload }) => payload
  };
  const verifier = {
    identity: { provider: "fixture", model: "verifier", prompt_version: "verify-v1", independent: true },
    verify: () => currentVerificationStatus === "verified" ? {
      status: "verified",
      signals: {
        evidence_entailment: 0.99,
        source_trust: 0.99,
        extraction_agreement: 0.99,
        temporal_consistency: 0.99,
        scope_valid: true,
        ontology_compatible: true,
        alias_binding_verified: true,
        temporary
      }
    } : { status: currentVerificationStatus }
  };
  const episodeSource = {
    listCanonicalEvidence: () => episodes.map((item, index) => {
      const contentHash = `sha256:${crypto.createHash("sha256").update(canonicalJson(item.payload)).digest("hex")}`;
      const sourceSequence = Number(item.source_sequence ?? index + 1);
      const eventId = `event-${item.episode_id}`;
      item.content_hash = contentHash;
      item.source_event_ids = [eventId];
      return sourceMutator({
        episode: item,
        evidence: {
          evidence_id: item.evidence_ids[0],
          workspace_id: item.workspace_id,
          project_id: item.project_id,
          session_id: item.session_id,
          episode_id: item.episode_id,
          event_id: eventId,
          source_adapter: "fixture",
          source_sequence: sourceSequence,
          content_hash: contentHash
        },
        payload: item.payload,
        cursor: { owner: `fixture:${item.session_id}`, sequence: sourceSequence, event_id: eventId },
        reopened: item.status === "active",
        status: item.status
      });
    }),
    readClosedSession: ({ sessionId }) => {
      const closedAt = closedSessions.get(sessionId);
      if (!closedAt) throw Object.assign(new Error("working_session_not_closed"), { code: "working_session_not_closed" });
      return { workspace_id: workspaceId, session_id: sessionId, closed_at: closedAt };
    },
    listRevokedAdmissions: () => []
  };
  const worker = createMemoryImproveWorker({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId,
    enabled: true,
    episodeSource,
    graphAdapter: graph,
    ontologyRegistry: ontology,
    admissionPolicy: policy,
    extractor,
    verifier,
    clock
  });
  return {
    vault, worker, graph, ontology, active,
    closeSession: (sessionId, closedAt) => closedSessions.set(sessionId, closedAt),
    setVerificationStatus: (value) => { currentVerificationStatus = value; },
    setNow: (value) => { now = value; }
  };
}

test("IM-AC01 and E2E: canonical episodes become cited graph enrichments and replay exactly once", (t) => {
  const oldRelationId = canonicalGraphRelationId({ workspaceId: WORKSPACE, relationKey: "old-dependency" });
  const episodes = [
    episode(1, extraction({
      claimKey: "old-dependency", text: "A depends on B.", relationKey: "old-dependency",
      predicate: "DEPENDS_ON", subjectAliases: ["Alpha"],
      ontologyProposals: [{ kind: "add_entity_type", name: "CustomerRisk" }]
    })),
    episode(2, extraction({
      claimKey: "replacement", text: "A now relates to B.", relationKey: "replacement",
      subjectAliases: ["A project"], extras: { contradicts_relation_ids: [oldRelationId] }
    })),
    episode(3, extraction({
      claimKey: "homonym", text: "A document is about B.", relationKey: "homonym",
      predicate: "ABOUT", subjectBinding: "document:a", subjectType: "Document", subjectName: "A"
    }))
  ];
  const fx = fixture(t, { episodes });
  const first = fx.worker.process();
  assert.equal(first.status, "complete");
  assert.equal(first.processed, 3);
  const state = fx.graph.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(state.claims.length, 3);
  assert.equal(state.entities.length, 3);
  assert.equal(state.entities.find((item) => item.binding_id === "project:a").aliases.includes("A project"), true);
  assert.equal(state.entities.find((item) => item.binding_id === "document:a").entity_type, "Document");
  assert.equal(state.relations.find((item) => item.relation_id === oldRelationId).status, "contradicted");
  assert.equal(fx.ontology.listChanges()[0].state, "shadow");
  assert.equal(fx.ontology.hasEntityType("CustomerRisk"), false);
  const projection = first.projection;
  assert.equal(projection.triplets.length, 2);
  assert.equal(projection.embeddings.length, 3);
  assert.equal(projection.communities.length, 1);
  assert.equal(projection.summaries.length, 1);
  for (const item of [...projection.triplets, ...projection.embeddings, ...projection.communities, ...projection.summaries]) {
    assert.ok(item.source_claim_ids.length);
    assert.ok(item.episode_ids.length);
    assert.ok(item.evidence_ids.length);
    assert.ok(item.admission_ids.length);
  }
  const checkpointId = first.checkpoint.checkpoint_id;
  const replay = fx.worker.process();
  assert.equal(replay.processed, 0);
  assert.equal(replay.checkpoint.checkpoint_id, checkpointId);
  assert.equal(replay.projection.projection_id, projection.projection_id);
});

test("authority-chain E2E consumes independently reopened encrypted working-store evidence", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-improve-canonical-"));
  const vault = path.join(temporaryRoot, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const captureStore = createCodexCaptureStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    workingMemory: { enabled: true }
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
    clock: () => "2026-08-04T10:01:00.000Z"
  });
  graph = createKnowledgeGraphAdapter({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    ontologyRegistry: ontology,
    provenanceResolver: ({ episodeIds, evidenceIds }) => {
      const current = source.listCanonicalEvidence({ workspaceId: WORKSPACE });
      return episodeIds.every((id) => current.some((item) => item.status === "active" && item.episode.episode_id === id)) &&
        evidenceIds.every((id) => current.some((item) => item.status === "active" && item.evidence.evidence_id === id));
    },
    clock: () => "2026-08-04T10:01:00.000Z"
  });
  const worker = createMemoryImproveWorker({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    enabled: true,
    episodeSource: source,
    graphAdapter: graph,
    ontologyRegistry: ontology,
    admissionPolicy: createMemoryAdmissionPolicy({ clock: () => "2026-08-04T10:01:00.000Z" }),
    extractor: {
      identity: { provider: "fixture", model: "canonical-extractor", prompt_version: "v1" },
      extract: ({ payload }) => payload
    },
    verifier: {
      identity: { provider: "fixture", model: "canonical-verifier", prompt_version: "v2", independent: true },
      verify: () => ({
        status: "verified",
        signals: {
          evidence_entailment: 0.99, source_trust: 0.99, extraction_agreement: 0.99,
          temporal_consistency: 0.99, scope_valid: true, ontology_compatible: true,
          alias_binding_verified: true
        }
      })
    },
    clock: () => "2026-08-04T10:01:00.000Z"
  });
  let last;
  const ingestCanonical = (number) => captureStore.ingest({
      adapter: "hook",
      adapter_version: "1.0.0",
      external_event_id: `canonical-${number}`,
      project_id: "prj_018f1234-5678-7abc-8def-0123456789ab",
      workspace_id: WORKSPACE,
      checkout_id: "co_018f1234-5678-7abc-8def-0123456789ad",
      session_id: "ses_hook:canonical-improve",
      thread_id: "canonical-improve",
      turn_id: `turn_canonical:${number}`,
      item_id: `item-${number}`,
      event_type: "tool.completed",
      occurred_at: `2026-08-04T10:00:0${number}.000Z`,
      capture_level: "standard",
      sequence: number,
      payload: extraction({
        claimKey: `canonical-${number}`,
        text: `Canonical claim ${number}.`,
        relationKey: `canonical-${number}`,
        subjectAliases: number === 1 ? ["Explicit A"] : []
      })
    });
  for (const number of [1, 3]) last = ingestCanonical(number);
  let reopened = source.listCanonicalEvidence({ workspaceId: WORKSPACE });
  assert.equal(reopened.length, 2);
  assert.equal(worker.process().processed, 2);
  last = ingestCanonical(2);
  assert.equal(worker.process().processed, 1);
  reopened = source.listCanonicalEvidence({ workspaceId: WORKSPACE });
  assert.equal(reopened.length, 3);
  assert.equal(reopened.every((item) => item.reopened && item.episode.content_hash === item.evidence.content_hash), true);
  const result = worker.process();
  assert.equal(result.status, "complete");
  assert.equal(result.processed, 0);
  assert.equal(graph.readCanonicalState({ workspaceId: WORKSPACE }).claims.length, 3);
  const revokedAdmissionId = graph.readCanonicalState({ workspaceId: WORKSPACE }).claims[0].admission.admission_id;
  captureStore.workingStore.recordAdmissionRevocation({
    workspaceId: WORKSPACE,
    admissionId: revokedAdmissionId,
    revokedAt: "2026-08-04T10:00:20.000Z"
  });
  const afterRevocation = worker.process();
  assert.equal(afterRevocation.projection.embeddings.length, 2);
  assert.equal(graph.readAuthorizedState({ workspaceId: WORKSPACE }).claims.length, 2);
  assert.equal(
    afterRevocation.projection.embeddings.some((item) => item.admission_ids.includes(revokedAdmissionId)),
    false
  );
  const session = captureStore.workingStore.closeSession({
    workspaceId: WORKSPACE,
    projectId: "prj_018f1234-5678-7abc-8def-0123456789ab",
    sessionId: "ses_hook:canonical-improve",
    workingSetId: last.working.working_set_id,
    closedAt: "2026-08-04T10:00:30.000Z"
  });
  assert.equal(session.closed_at, "2026-08-04T10:00:30.000Z");
  assert.equal(worker.notifySessionClosed({ sessionId: session.session_id }).latency_ms, 30_000);
});

test("red_test: canonical source delegates encrypted admission revocations instead of returning an empty authority set", () => {
  const source = createCanonicalWorkingEpisodeSource({
    workingStore: {
      listImproveEpisodes: () => [],
      readClosedSession: () => ({ workspace_id: WORKSPACE, session_id: "ses_x", closed_at: "2026-08-04T10:00:00.000Z" }),
      listRevokedAdmissions: () => ["adm_canonical_revoked"]
    },
    captureStore: { readEvents: () => [] }
  });
  assert.deepEqual(source.listRevokedAdmissions({ workspaceId: WORKSPACE }), ["adm_canonical_revoked"]);
});

test("red_test: worker independently rejects payload, evidence, project, session, and cursor tampering", (t) => {
  const tamperedPayload = extraction({
    claimKey: "tampered",
    text: "Tampered A controls B.",
    relationKey: "tampered",
    predicate: "RELATED_TO"
  });
  const mutations = {
    payload: (source) => ({ ...source, payload: tamperedPayload }),
    episode: (source) => ({
      ...source,
      evidence: { ...source.evidence, episode_id: "epi_018f1234-5678-7abc-8def-999999999999" }
    }),
    project: (source) => ({
      ...source,
      evidence: { ...source.evidence, project_id: "prj_018f1234-5678-7abc-8def-999999999999" }
    }),
    session: (source) => ({
      ...source,
      evidence: { ...source.evidence, session_id: "ses_improve:attacker" }
    }),
    cursor_owner: (source) => ({
      ...source,
      cursor: { ...source.cursor, owner: "attacker:other-session" }
    }),
    cursor_event: (source) => ({
      ...source,
      cursor: { ...source.cursor, event_id: "event-attacker" }
    })
  };
  let number = 30;
  for (const [name, mutate] of Object.entries(mutations)) {
    const original = episode(number, extraction({
      claimKey: `untampered-${name}`,
      text: `Original ${name} A relates to B.`,
      relationKey: `untampered-${name}`
    }));
    number += 1;
    const fx = fixture(t, { episodes: [original], sourceMutator: mutate });
    const result = fx.worker.process();
    assert.equal(result.status, "degraded", name);
    assert.equal(result.results[0].error, "improve_canonical_evidence_invalid", name);
    assert.equal(fx.graph.readCanonicalState({ workspaceId: WORKSPACE }).claims.length, 0, name);
    assert.equal(fx.worker.readCheckpoint(), null, name);
  }
});

test("missing verification never advances high-watermark and workspace failures remain isolated", (t) => {
  const blocked = fixture(t, {
    episodes: [episode(4, extraction({
      claimKey: "blocked", text: "Blocked A relates to B.", relationKey: "blocked",
      ontologyProposals: [{ kind: "add_entity_type", name: "UnverifiedType" }]
    }))],
    verificationStatus: "unavailable"
  });
  const healthyEpisodes = [episode(5, extraction({ claimKey: "healthy", text: "Healthy A relates to B.", relationKey: "healthy" }), OTHER_WORKSPACE)];
  const healthy = fixture(t, { workspaceId: OTHER_WORKSPACE, episodes: healthyEpisodes });
  const results = processImproveWorkspaces([blocked.worker, healthy.worker]);
  assert.equal(results[0].result.status, "degraded");
  assert.equal(blocked.worker.readCheckpoint(), null);
  assert.equal(blocked.graph.readCanonicalState({ workspaceId: WORKSPACE }).claims.length, 0);
  assert.deepEqual(blocked.ontology.listChanges(), []);
  assert.equal(results[1].result.status, "complete");
  assert.equal(healthy.graph.readCanonicalState({ workspaceId: OTHER_WORKSPACE }).claims.length, 1);
});

test("source-owned cursors process a late arrival below the recorded high-watermark exactly once", (t) => {
  const first = episode(20, extraction({ claimKey: "cursor-1", text: "Cursor one.", relationKey: "cursor-1" }));
  first.source_sequence = 1;
  const third = episode(21, extraction({ claimKey: "cursor-3", text: "Cursor three.", relationKey: "cursor-3" }));
  third.source_sequence = 3;
  const episodes = [first, third];
  const fx = fixture(t, { episodes });
  assert.equal(fx.worker.process().processed, 2);
  assert.equal(fx.worker.readCheckpoint().source_high_watermarks["fixture:ses_improve:test"], 3);
  const late = episode(22, extraction({ claimKey: "cursor-2", text: "Cursor two arrived late.", relationKey: "cursor-2" }));
  late.source_sequence = 2;
  episodes.push(late);
  fx.active.add(late.episode_id);
  fx.active.add(...late.evidence_ids);
  assert.equal(fx.worker.process().processed, 1);
  assert.equal(fx.graph.readCanonicalState({ workspaceId: WORKSPACE }).claims.length, 3);
  assert.equal(fx.worker.process().processed, 0);
});

test("shadow ontology stays non-projectable and activation is additive with historical version binding", (t) => {
  const proposal = { kind: "add_relation_type", name: "COLLABORATES_WITH" };
  const episodes = [episode(10, extraction({
    claimKey: "support-10",
    text: "Support 10 says A relates to B.",
    relationKey: "support-10",
    ontologyProposals: [proposal]
  }))];
  const fx = fixture(t, { episodes });
  fx.worker.process();
  const coreVersion = fx.ontology.activeVersion().version_id;
  assert.equal(fx.ontology.listChanges().at(-1).state, "shadow");
  for (const number of [11, 12]) {
    const item = episode(number, extraction({
      claimKey: `support-${number}`,
      text: `Support ${number} says A relates to B.`,
      relationKey: `support-${number}`,
      ontologyProposals: [proposal]
    }));
    episodes.push(item);
    fx.active.add(item.episode_id);
    fx.active.add(...item.evidence_ids);
    fx.worker.process();
  }
  const promotedVersion = fx.ontology.activeVersion().version_id;
  assert.notEqual(promotedVersion, coreVersion);
  assert.equal(fx.ontology.hasRelationType("COLLABORATES_WITH"), true);
  const learnedEpisode = episode(13, extraction({
    claimKey: "learned-relation",
    text: "A collaborates with B.",
    relationKey: "learned-relation",
    predicate: "COLLABORATES_WITH"
  }));
  episodes.push(learnedEpisode);
  fx.active.add(learnedEpisode.episode_id);
  fx.active.add(...learnedEpisode.evidence_ids);
  assert.equal(fx.worker.process().status, "complete");
  const relations = fx.graph.readCanonicalState({ workspaceId: WORKSPACE }).relations;
  assert.equal(relations.filter((item) => item.ontology_version === coreVersion).length, 3);
  assert.equal(relations.find((item) => item.predicate === "COLLABORATES_WITH").ontology_version, promotedVersion);
});

test("IM-AC03: feedback is deterministically bounded and cannot change graph or ontology authority", (t) => {
  const fx = fixture(t, { episodes: [episode(6, extraction({ claimKey: "feedback", text: "A affects B.", relationKey: "feedback", predicate: "AFFECTS" }))] });
  const result = fx.worker.process();
  const beforeGraph = fx.graph.readCanonicalState({ workspaceId: WORKSPACE });
  const beforeOntology = fx.ontology.activeVersion().version_id;
  const target = result.projection.summaries[0].artifact_id;
  const first = fx.worker.recordFeedback({ feedbackId: "feedback-1", artifactId: target, delta: 9 });
  assert.equal(first.bounded_delta, 0.25);
  assert.equal(fx.worker.recordFeedback({ feedbackId: "feedback-1", artifactId: target, delta: -9 }).bounded_delta, 0.25);
  assert.equal(fx.worker.feedbackWeight(target), 0.25);
  assert.deepEqual(fx.graph.readCanonicalState({ workspaceId: WORKSPACE }), beforeGraph);
  assert.equal(fx.ontology.activeVersion().version_id, beforeOntology);
  assert.equal(fx.worker.readProjection().projection_id, result.projection.projection_id);
});

test("authority removal and TTL expiry invalidate enrichments before cleanup", (t) => {
  const item = episode(7, extraction({ claimKey: "ttl", text: "A temporarily supports B.", relationKey: "ttl", predicate: "SUPPORTS" }));
  const fx = fixture(t, { episodes: [item], temporary: true });
  const activeProjection = fx.worker.process().projection;
  assert.equal(activeProjection.summaries.length, 1);
  fx.setNow("2026-08-12T10:01:00.000Z");
  assert.equal(fx.worker.readProjection(), null);
  assert.equal(fx.worker.rebuildEnrichments().summaries.length, 0);

  const permanentItem = episode(8, extraction({ claimKey: "permanent", text: "A supports B.", relationKey: "permanent", predicate: "SUPPORTS" }));
  const other = fixture(t, { episodes: [permanentItem] });
  const projected = other.worker.process().projection;
  assert.equal(projected.summaries.length, 1);
  permanentItem.status = "tombstoned";
  const removed = other.worker.process().projection;
  assert.equal(removed.summaries.length, 0);
  assert.equal(other.worker.readProjection().projection_id, removed.projection_id);
});

test("IM-AC02: session-close consolidation is canonical, idempotent, scoped, and under 120 seconds", (t) => {
  const closedEpisode = episode(9, extraction({ claimKey: "session", text: "A relates to B.", relationKey: "session" }));
  const openEpisode = episode(24, extraction({ claimKey: "other-session", text: "Another session remains open.", relationKey: "other-session" }));
  openEpisode.session_id = "ses_improve:other";
  const fx = fixture(t, { episodes: [closedEpisode, openEpisode] });
  fx.setNow("2026-08-04T10:01:00.000Z");
  assert.throws(() => fx.worker.notifySessionClosed({ sessionId: "ses_improve:test" }), /working_session_not_closed/);
  fx.closeSession("ses_improve:test", "2026-08-04T10:00:00.000Z");
  const first = fx.worker.notifySessionClosed({ sessionId: "ses_improve:test" });
  const replay = fx.worker.notifySessionClosed({ sessionId: "ses_improve:test" });
  assert.equal(first.latency_ms, 60_000);
  assert.equal(first.notification_id, replay.notification_id);
  assert.equal(first.checkpoint_id, replay.checkpoint_id);
  const state = fx.graph.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(state.claims.length, 1);
  assert.equal(state.claims[0].claim_key, "session");
});

test("degraded session consolidation is not persisted and retries after verifier recovery", (t) => {
  const fx = fixture(t, {
    episodes: [episode(23, extraction({ claimKey: "retry-close", text: "Retry close.", relationKey: "retry-close" }))],
    verificationStatus: "unavailable"
  });
  fx.closeSession("ses_improve:test", "2026-08-04T10:00:00.000Z");
  const degraded = fx.worker.notifySessionClosed({ sessionId: "ses_improve:test" });
  assert.equal(degraded.status, "degraded_retryable");
  assert.equal(degraded.persisted, false);
  fx.setVerificationStatus("verified");
  const completed = fx.worker.notifySessionClosed({ sessionId: "ses_improve:test" });
  assert.equal(completed.status, "complete");
  assert.equal(completed.notification_id, degraded.notification_id);
});

test("improvement is disabled by default and creates no projection state", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-improve-disabled-"));
  const vault = path.join(temporaryRoot, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const worker = createMemoryImproveWorker({ vaultRoot: vault, encryptionKey: KEY, workspaceId: WORKSPACE });
  assert.equal(worker.process().status, "disabled");
  assert.equal(fs.existsSync(worker.root), false);
});
