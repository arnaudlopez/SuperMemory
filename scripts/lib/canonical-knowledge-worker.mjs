import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import {
  canonicalGraphClaimId,
  canonicalGraphEntityId,
  canonicalGraphRelationId
} from "./knowledge-graph-adapter.mjs";
import { createOntologySupportAttestation } from "./ontology-registry.mjs";
import { normalizeTemporalExpression } from "./codex-temporal-normalizer.mjs";

const WORKSPACE = /^ws_[A-Za-z0-9._:-]{8,}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function contentHash(value) {
  return `sha256:${hash(canonicalJson(value))}`;
}

function identity(value, code) {
  const result = {
    provider: String(value?.provider ?? "").trim(),
    model: String(value?.model ?? "").trim(),
    prompt_version: String(value?.prompt_version ?? "").trim()
  };
  if (!result.provider || !result.model || !result.prompt_version) fail(code);
  return result;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function createCanonicalWorkingEpisodeSource({ workingStore, captureStore } = {}) {
  if (
    !workingStore?.listImproveEpisodes || !workingStore?.readClosedSession ||
    !workingStore?.listRevokedAdmissions || !captureStore?.readEvents
  ) fail("canonical_working_source_invalid");
  return Object.freeze({
    listCanonicalEvidence: ({ workspaceId, sessionId = null } = {}) => workingStore.listImproveEpisodes({
      workspaceId,
      ...(sessionId ? { sessionId } : {}),
      captureStore
    }),
    readClosedSession: (input) => workingStore.readClosedSession(input),
    listRevokedAdmissions: (input) => workingStore.listRevokedAdmissions(input)
  });
}

export function createCanonicalKnowledgeWorker({
  vaultRoot,
  encryptionKey,
  workspaceId,
  enabled = false,
  episodeSource = null,
  graphAdapter = null,
  ontologyRegistry = null,
  admissionPolicy = null,
  extractor = null,
  verifier = null,
  learnedPlane = null,
  authorityPolicy = null,
  exceptionStore = null,
  topicContextResolver = null,
  clock = () => new Date().toISOString()
} = {}) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) fail("canonical_worker_key_invalid");
  if (!WORKSPACE.test(String(workspaceId ?? ""))) fail("canonical_worker_scope_invalid");
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const root = path.join(vault, "20_professional", "memory-fabric", workspaceId, "canonical-worker");
  const checkpointPath = path.join(root, "checkpoint.aead.json");
  const aad = `supermemory.canonical-worker-checkpoint.v1\0${workspaceId}`;
  const disabled = Object.freeze({
    enabled: false,
    workspaceId,
    root,
    process: async () => ({ status: "disabled", workspace_id: workspaceId, processed: 0 }),
    recover: async () => ({ status: "disabled", workspace_id: workspaceId, sessions: 0 }),
    notifySessionClosed: async () => ({ status: "disabled", workspace_id: workspaceId }),
    readCheckpoint: () => null,
    status: () => ({ enabled: false, status: "disabled" })
  });
  if (!enabled) return disabled;
  if (!episodeSource?.listCanonicalEvidence || !episodeSource?.readClosedSession) fail("canonical_episode_source_required");
  if (!graphAdapter?.upsertEpisodeGraph || !graphAdapter?.readCanonicalState || !graphAdapter?.resolveAuthorizedClaims) {
    fail("canonical_graph_required");
  }
  if (!admissionPolicy?.evaluate || !extractor?.extract || !verifier?.verify) fail("canonical_pipeline_required");
  const extractorIdentity = identity(extractor.identity, "canonical_extractor_identity_invalid");
  const verifierIdentity = identity(verifier.identity, "canonical_verifier_identity_invalid");
  if (
    verifier.identity?.independent !== true ||
    (verifierIdentity.model === extractorIdentity.model && verifierIdentity.prompt_version === extractorIdentity.prompt_version)
  ) fail("canonical_verifier_not_independent");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  const readCheckpoint = () => {
    if (!fs.existsSync(checkpointPath)) return null;
    const stat = fs.lstatSync(checkpointPath);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("canonical_checkpoint_insecure");
    const value = openJsonAead(JSON.parse(fs.readFileSync(checkpointPath, "utf8")), {
      encryptionKey,
      expectedAad: aad
    });
    if (value?.workspace_id !== workspaceId || value.schema !== "supermemory.canonical-worker-checkpoint.v1") {
      fail("canonical_checkpoint_invalid");
    }
    return value;
  };

  const writeCheckpoint = (previous, source, outcome) => {
    const processed = [...new Set([...(previous?.processed_episode_ids ?? []), source.episode.episode_id])].sort();
    const material = {
      schema: "supermemory.canonical-worker-checkpoint.v1",
      workspace_id: workspaceId,
      sequence: (previous?.sequence ?? 0) + 1,
      processed_episode_ids: processed,
      source_high_watermarks: {
        ...(previous?.source_high_watermarks ?? {}),
        [source.cursor.owner]: Math.max(previous?.source_high_watermarks?.[source.cursor.owner] ?? -1, source.cursor.sequence)
      },
      last_outcome: outcome,
      updated_at: clock()
    };
    atomicWrite(checkpointPath, `${canonicalJson(sealJsonAead(material, { encryptionKey, aad }))}\n`);
    return material;
  };

  const validateSource = (source) => {
    const { episode, evidence, payload, cursor } = source;
    if (
      source.reopened !== true || source.status !== "active" ||
      episode?.workspace_id !== workspaceId || evidence?.workspace_id !== workspaceId ||
      episode.project_id !== evidence.project_id || episode.session_id !== evidence.session_id ||
      evidence.episode_id !== episode.episode_id || !episode.evidence_ids?.includes(evidence.evidence_id) ||
      !episode.source_event_ids?.includes(evidence.event_id) ||
      episode.content_hash !== evidence.content_hash || episode.content_hash !== contentHash(payload) ||
      cursor?.owner !== `${evidence.source_adapter}:${evidence.session_id}` ||
      cursor.event_id !== evidence.event_id || cursor.sequence !== evidence.source_sequence ||
      !Number.isSafeInteger(cursor.sequence) || cursor.sequence < 0
    ) fail("canonical_evidence_invalid");
  };

  const normalizeExtraction = (source, value) => {
    if (!value || typeof value !== "object" || !value.claim_key || !value.text) fail("canonical_extraction_invalid");
    if (!Array.isArray(value.entities) || !Array.isArray(value.relations) || value.entities.length === 0) {
      fail("canonical_extraction_invalid");
    }
    const entities = value.entities.map((item) => ({
      entity_id: canonicalGraphEntityId({ workspaceId, bindingId: item.binding_id }),
      binding_id: item.binding_id,
      canonical_name: item.canonical_name,
      entity_type: item.entity_type,
      aliases: [...new Set(item.aliases ?? [])].sort()
    }));
    const byBinding = new Map(entities.map((item) => [item.binding_id, item.entity_id]));
    const claimEventTime = normalizeTemporalExpression({
      text: value.temporal_expression ?? value.text,
      observedAt: source.episode.observed_at,
      explicit: value.event_time ?? null
    });
    const relations = value.relations.map((item) => {
      const subject = byBinding.get(item.subject_binding_id);
      const object = byBinding.get(item.object_binding_id);
      if (!subject || !object) fail("canonical_relation_entity_unknown");
      const versionedRelationKey = `${item.relation_key}@${source.episode.episode_id}`;
      return {
        relation_id: canonicalGraphRelationId({ workspaceId, relationKey: versionedRelationKey }),
        relation_key: versionedRelationKey,
        subject_entity_id: subject,
        predicate: item.predicate,
        object_entity_id: object,
        valid_from: item.valid_from ?? source.episode.observed_at,
        valid_to: item.valid_to ?? null,
        event_time: normalizeTemporalExpression({
          text: item.temporal_expression ?? value.temporal_expression ?? value.text,
          observedAt: source.episode.observed_at,
          explicit: item.event_time ?? value.event_time ?? null
        }),
        supersedes_relation_ids: [...new Set(item.supersedes_relation_ids ?? [])].sort(),
        contradicts_relation_ids: [...new Set(item.contradicts_relation_ids ?? [])].sort()
      };
    });
    return { ...value, event_time: claimEventTime, entities, relations };
  };

  const factClass = (extracted) => {
    if (extracted.fact_class) return extracted.fact_class;
    if (extracted.relations.some((item) => item.predicate === "PREFERS")) return "user_preference";
    if (extracted.entities.some((item) => item.entity_type === "Decision")) return "user_decision";
    if (/\b(permission|autorisation|consentement|allowed|interdit)\b/i.test(extracted.text)) return "permission";
    if (extracted.entities.some((item) => ["Tool", "Error"].includes(item.entity_type))) return "machine_state";
    if (extracted.entities.some((item) => ["Requirement", "Procedure"].includes(item.entity_type))) return "project_constraint";
    return "external_fact";
  };

  const syncRevocations = async (sources) => {
    let state = graphAdapter.readCanonicalState({ workspaceId });
    for (const source of sources.filter((item) => item.status === "tombstoned")) {
      const known = state.claims.some((claim) => claim.episode_ids.includes(source.episode.episode_id));
      const removed = state.tombstones.some((item) => item.tombstone_type === "episode" && item.target_id === source.episode.episode_id);
      if (known && !removed) graphAdapter.tombstoneEpisode({ workspaceId, episodeId: source.episode.episode_id });
    }
    for (const admissionId of episodeSource.listRevokedAdmissions?.({ workspaceId }) ?? []) {
      state = graphAdapter.readCanonicalState({ workspaceId });
      const known = state.claims.some((claim) => claim.admission.admission_id === admissionId);
      const removed = state.tombstones.some((item) => item.tombstone_type === "admission" && item.target_id === admissionId);
      if (known && !removed) graphAdapter.revokeAdmission({ workspaceId, admissionId });
    }
    await learnedPlane?.reconcileRevocations?.({ workspaceId, canonicalState: graphAdapter.readCanonicalState({ workspaceId }) });
  };

  let lastRun = null;
  const process = async ({ sessionId = null, session_id: snakeSessionId = null } = {}) => {
    const requestedSession = sessionId ?? snakeSessionId;
    const sources = episodeSource.listCanonicalEvidence({ workspaceId });
    await syncRevocations(sources);
    let checkpoint = readCheckpoint();
    const completed = new Set(checkpoint?.processed_episode_ids ?? []);
    const pending = sources.filter((source) => (
      source.status === "active" && !completed.has(source.episode.episode_id) &&
      (!requestedSession || source.episode.session_id === requestedSession)
    ));
    const results = [];
    for (const source of pending) {
      try {
        validateSource(source);
        const extracted = normalizeExtraction(source, await extractor.extract({
          workspaceId, episode: source.episode, evidence: source.evidence,
          payload: source.payload, extractor: extractorIdentity
        }));
        const graphClaimKey = `${extracted.claim_key}@${source.episode.episode_id}`;
        const claimId = canonicalGraphClaimId({ workspaceId, claimKey: graphClaimKey });
        const candidate = {
          candidate_id: claimId,
          workspace_id: workspaceId,
          evidence_ids: source.episode.evidence_ids,
          sensitivity: source.episode.sensitivity ?? "standard",
          extractor: extractorIdentity
        };
        const verification = await verifier.verify({
          workspaceId, episode: source.episode, evidence: source.evidence, payload: source.payload,
          candidate: { ...candidate, text: extracted.text }, extraction: extracted, verifier: verifierIdentity
        });
        if (verification?.status !== "verified") {
          results.push({ episode_id: source.episode.episode_id, status: "pending_verification" });
          break;
        }
        if (extracted.entities.some((item) => item.aliases.length) && verification.signals?.alias_binding_verified !== true) {
          fail("canonical_alias_binding_unverified");
        }
        verification.verifier = { ...verifierIdentity, independent: true };
        const admission = admissionPolicy.evaluate({ candidate, verification });
        if (!admission.recall_allowed) {
          checkpoint = writeCheckpoint(checkpoint, source, admission.status);
          results.push({ episode_id: source.episode.episode_id, status: admission.status });
          continue;
        }
        let authority = null;
        if (authorityPolicy?.evaluate) {
          let topicId = null;
          try {
            topicId = topicContextResolver?.({
              workspaceId,
              projectId: source.episode.project_id,
              workingSetId: source.episode.working_set_id
            })?.topic?.topic_id ?? null;
          } catch {
            topicId = null;
          }
          authority = authorityPolicy.evaluate({
            claim: {
              claim_id: claimId,
              claim_key: extracted.claim_key,
              workspace_id: workspaceId,
              project_id: source.episode.project_id,
              topic_id: topicId,
              fact_class: factClass(extracted),
              evidence_ids: source.episode.evidence_ids,
              observed_at: source.episode.observed_at,
              event_time: extracted.event_time,
              proof_strength: verification.signals?.evidence_entailment >= 0.9 ? "strong" : "standard",
              explicit: extracted.explicit === true,
              authenticated: extracted.authenticated === true,
              inferred: extracted.inferred === true,
              ...(extracted.ttl_ms ? { ttl_ms: extracted.ttl_ms } : {})
            }
          });
          if (authority.state.state === "disputed" && exceptionStore?.upsert) {
            exceptionStore.upsert({
              topicId,
              claimIds: [...new Set([claimId, ...authority.transitions.filter((item) => item.claim_id !== claimId).map((item) => item.claim_id)])],
              reasonCodes: authority.state.reason_codes,
              level: "latent",
              impact: authority.state.fact_class === "permission" ? "high" : "low",
              irreversibility: authority.state.fact_class === "permission" ? "permission" : "reversible"
            });
          }
        }
        let graph = graphAdapter.upsertEpisodeGraph({
          workspaceId,
          episodeId: source.episode.episode_id,
          evidenceIds: source.episode.evidence_ids,
          claim: {
            claim_id: claimId,
            claim_key: graphClaimKey,
            text: extracted.text,
            observed_at: source.episode.observed_at,
            event_time: extracted.event_time
          },
          admission: admission.admission,
          ...(authority ? {
            authorityState: authority.state,
            authorityTransitions: authority.transitions
          } : {}),
          entities: extracted.entities,
          relations: extracted.relations
        });
        if (typeof graphAdapter.rebuildProjectionAsync === "function") {
          try {
            graph = { ...graph, projection: await graphAdapter.rebuildProjectionAsync({ workspaceId }) };
          } catch (error) {
            graph = {
              ...graph,
              projection: { projected: false, status: "degraded_retryable", error: error?.code ?? "graph_projection_failed" }
            };
          }
        }
        const claim = graphAdapter.resolveAuthorizedClaims({ workspaceId, claimIds: [claimId], asOf: clock() })[0];
        if (!claim && !["superseded", "revoked", "expired"].includes(authority?.state?.state)) {
          fail("canonical_claim_authority_missing");
        }
        if (!claim) {
          checkpoint = writeCheckpoint(checkpoint, source, authority.state.state);
          results.push({
            episode_id: source.episode.episode_id,
            status: authority.state.state,
            claim_id: claimId,
            graph,
            authority: authority.state,
            learned: { status: "not_authoritative" }
          });
          continue;
        }
        for (const proposal of extracted.ontology_proposals ?? []) {
          ontologyRegistry?.proposeChange({
            ...proposal,
            sourceClaimId: claimId,
            supportAttestation: createOntologySupportAttestation({ workspaceId, claim, proposal })
          });
        }
        const ontology = ontologyRegistry?.reevaluateShadows?.() ?? [];
        checkpoint = writeCheckpoint(checkpoint, source, admission.status);
        let learned = { status: "disabled" };
        try {
          learned = await learnedPlane?.projectCanonicalClaim?.({ workspaceId, claim, graph, source }) ?? learned;
        } catch (error) {
          learned = { status: "degraded_retryable", error: error?.code ?? "hindsight_unavailable" };
        }
        results.push({
          episode_id: source.episode.episode_id,
          status: admission.status,
          claim_id: claimId,
          graph,
          ontology,
          authority: authority?.state ?? claim.authority ?? null,
          learned
        });
      } catch (error) {
        results.push({ episode_id: source.episode?.episode_id ?? null, status: "failed", error: error?.code ?? "canonical_worker_failed" });
        break;
      }
    }
    const result = {
      schema: "supermemory.canonical-worker-result.v1",
      status: results.some((item) => ["failed", "pending_verification"].includes(item.status)) ? "degraded" : "complete",
      workspace_id: workspaceId,
      processed: results.length,
      results,
      checkpoint: readCheckpoint()
    };
    lastRun = {
      status: result.status,
      processed: result.processed,
      outcome: result.results.at(-1)?.status ?? "idle",
      error: result.results.find((item) => item.error)?.error ?? null
    };
    return result;
  };

  const notifySessionClosed = async ({ sessionId, session_id: snakeSessionId } = {}) => {
    const session = sessionId ?? snakeSessionId;
    const closed = episodeSource.readClosedSession({ workspaceId, sessionId: session });
    if (closed?.workspace_id !== workspaceId || closed.session_id !== session) fail("canonical_session_close_invalid");
    const result = await process({ sessionId: session });
    let consolidation = { status: "disabled" };
    if (result.status === "complete" && learnedPlane?.consolidateSession) {
      try {
        consolidation = await learnedPlane.consolidateSession({ workspaceId, sessionId: session });
      } catch (error) {
        consolidation = { status: "degraded_retryable", error: error?.code ?? "hindsight_unavailable" };
      }
    }
    return {
      schema: "supermemory.session-consolidation.v2",
      workspace_id: workspaceId,
      session_id: session,
      closed_at: closed.closed_at,
      completed_at: clock(),
      status: result.status,
      canonical: result,
      consolidation
    };
  };

  const recover = async () => {
    const sessions = [...new Set(episodeSource.listCanonicalEvidence({ workspaceId })
      .map((source) => source.episode?.session_id)
      .filter(Boolean))].sort();
    const results = [];
    for (const sessionId of sessions) {
      try {
        episodeSource.readClosedSession({ workspaceId, sessionId });
      } catch (error) {
        if (error?.code === "working_session_not_closed") continue;
        throw error;
      }
      results.push(await notifySessionClosed({ sessionId }));
    }
    return {
      schema: "supermemory.canonical-worker-recovery.v1",
      workspace_id: workspaceId,
      status: results.some((result) => result.status === "degraded") ? "degraded" : "complete",
      sessions: results.length,
      results
    };
  };

  return Object.freeze({
    enabled: true,
    workspaceId,
    root,
    process,
    recover,
    notifySessionClosed,
    readCheckpoint,
    status: () => ({
      enabled: true,
      status: lastRun?.status === "degraded" ? "degraded" : "ready",
      checkpoint: readCheckpoint()?.sequence ?? 0,
      last_outcome: lastRun?.outcome ?? null,
      last_error: lastRun?.error ?? null,
      last_processed: lastRun?.processed ?? 0
    })
  });
}

export async function processCanonicalKnowledgeWorkspaces(workers) {
  if (!Array.isArray(workers)) fail("canonical_workers_invalid");
  return Promise.all(workers.map(async (worker) => {
    try {
      return { workspace_id: worker.workspaceId, result: await worker.process() };
    } catch (error) {
      return { workspace_id: worker.workspaceId, error: error?.code ?? "canonical_worker_failed" };
    }
  }));
}
