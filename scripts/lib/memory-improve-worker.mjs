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
import { withVaultMutationLock } from "./registry-transaction.mjs";

const WORKSPACE_ID = /^ws_[A-Za-z0-9._:-]{8,}$/;
const MAX_FEEDBACK_WEIGHT = 0.25;

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

function assertWorkspace(value) {
  if (typeof value !== "string" || !WORKSPACE_ID.test(value)) fail("improve_scope_invalid");
  return value;
}

function assertKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) fail("improve_encryption_key_invalid");
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

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    if (!/^[A-Za-z0-9._:-]+$/.test(segment)) fail("improve_path_invalid");
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("improve_path_invalid");
    } else fs.mkdirSync(next, { mode: 0o700 });
    current = fs.realpathSync(next);
    const remainder = path.relative(root, current);
    if (remainder.startsWith("..") || path.isAbsolute(remainder)) fail("improve_scope_invalid");
  }
  return current;
}

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function boundedVector(value) {
  const bytes = crypto.createHash("sha256").update(value).digest();
  return [...bytes.subarray(0, 8)].map((byte) => Number(((byte - 127.5) / 127.5).toFixed(6)));
}

export function createCanonicalWorkingEpisodeSource({ workingStore, captureStore } = {}) {
  if (
    !workingStore || typeof workingStore.listImproveEpisodes !== "function" ||
    typeof workingStore.readClosedSession !== "function" ||
    typeof workingStore.listRevokedAdmissions !== "function" ||
    !captureStore || typeof captureStore.readEvents !== "function"
  ) fail("improve_working_source_invalid");
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

export function createMemoryImproveWorker({
  vaultRoot,
  encryptionKey,
  workspaceId: boundWorkspaceId,
  enabled = false,
  episodeSource = null,
  graphAdapter = null,
  ontologyRegistry = null,
  admissionPolicy = null,
  extractor = null,
  verifier = null,
  clock = () => new Date().toISOString()
} = {}) {
  assertKey(encryptionKey);
  const workspaceId = assertWorkspace(boundWorkspaceId);
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const rootRelative = `20_professional/memory-fabric/${workspaceId}/improve`;
  const root = path.join(vault, rootRelative);
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      workspaceId,
      root,
      process: () => ({ status: "disabled", workspace_id: workspaceId, processed: 0 }),
      notifySessionClosed: () => ({ status: "disabled", workspace_id: workspaceId }),
      readProjection: () => null,
      readCheckpoint: () => null,
      feedbackWeight: () => 0
    });
  }
  if (
    !episodeSource || typeof episodeSource.listCanonicalEvidence !== "function" ||
    typeof episodeSource.readClosedSession !== "function"
  ) fail("improve_episode_source_required");
  if (
    !graphAdapter || typeof graphAdapter.upsertEpisodeGraph !== "function" ||
    typeof graphAdapter.readCanonicalState !== "function" ||
    typeof graphAdapter.readAuthorizedState !== "function" ||
    typeof graphAdapter.resolveAuthorizedClaims !== "function"
  ) fail("improve_graph_required");
  if (!admissionPolicy || typeof admissionPolicy.evaluate !== "function") fail("improve_admission_policy_required");
  if (!extractor || typeof extractor.extract !== "function") fail("improve_extractor_required");
  if (!verifier || typeof verifier.verify !== "function") fail("improve_verifier_required");
  const extractorIdentity = identity(extractor.identity, "improve_extractor_identity_invalid");
  const verifierIdentity = identity(verifier.identity, "improve_verifier_identity_invalid");
  if (
    verifier.identity?.independent !== true ||
    (verifierIdentity.model === extractorIdentity.model && verifierIdentity.prompt_version === extractorIdentity.prompt_version)
  ) fail("improve_verifier_not_independent");
  ensureDirectory(vault, rootRelative);

  const aad = (kind, id) => `supermemory.improve-artifact.v1.${workspaceId}.${kind}.${id}`;
  const artifactPath = (kind, id, create = false) => {
    const directory = create ? ensureDirectory(vault, `${rootRelative}/${kind}`) : path.join(root, kind);
    return path.join(directory, `${id}.json.aead`);
  };
  const readArtifact = (kind, id) => {
    try {
      const value = openJsonAead(JSON.parse(fs.readFileSync(artifactPath(kind, id), "utf8")), {
        encryptionKey,
        expectedAad: aad(kind, id)
      });
      if (value?.workspace_id !== workspaceId || value.artifact_id !== id) fail("improve_artifact_corrupt");
      return value;
    } catch (error) {
      if (error?.code === "improve_artifact_corrupt") throw error;
      fail("improve_artifact_corrupt");
    }
  };
  const writeArtifact = (kind, id, body) => {
    const filePath = artifactPath(kind, id, true);
    if (fs.existsSync(filePath)) {
      const existing = readArtifact(kind, id);
      if (canonicalJson(existing) !== canonicalJson(body)) fail("improve_artifact_collision");
      return existing;
    }
    atomicWrite(filePath, `${JSON.stringify(sealJsonAead(body, { encryptionKey, aad: aad(kind, id) }))}\n`);
    return readArtifact(kind, id);
  };
  const listArtifacts = (kind) => {
    const directory = path.join(root, kind);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json.aead")) {
        fail("improve_artifact_corrupt");
      }
      return readArtifact(kind, entry.name.slice(0, -10));
    });
  };
  const readCheckpoint = () => listArtifacts("checkpoints")
    .sort((left, right) => left.sequence - right.sequence || left.artifact_id.localeCompare(right.artifact_id)).at(-1) ?? null;
  const checkpointEpisode = (source, outcome) => {
    const previous = readCheckpoint();
    const sourceHighWatermarks = { ...(previous?.source_high_watermarks ?? {}) };
    sourceHighWatermarks[source.cursor.owner] = Math.max(
      Number(sourceHighWatermarks[source.cursor.owner] ?? -1),
      source.cursor.sequence
    );
    const processedEpisodeIds = [...new Set([
      ...(previous?.processed_episode_ids ?? []),
      source.episode.episode_id
    ])].sort();
    const material = {
      workspace_id: workspaceId,
      sequence: (previous?.sequence ?? 0) + 1,
      previous_checkpoint_id: previous?.checkpoint_id ?? null,
      source_cursor: source.cursor,
      source_high_watermarks: sourceHighWatermarks,
      processed_episode_ids: processedEpisodeIds,
      episode_id: source.episode.episode_id,
      outcome
    };
    const checkpointId = `imcp_${hash(canonicalJson(material))}`;
    return writeArtifact("checkpoints", checkpointId, {
      schema: "supermemory.improve-checkpoint.v1",
      artifact_id: checkpointId,
      checkpoint_id: checkpointId,
      ...material,
      recorded_at: clock()
    });
  };
  const normalizeExtraction = (source, value) => {
    const { episode } = source;
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("improve_extraction_invalid");
    if (typeof value.claim_key !== "string" || !value.claim_key.trim() || typeof value.text !== "string" || !value.text.trim()) {
      fail("improve_extraction_invalid");
    }
    if (!Array.isArray(value.entities) || value.entities.length === 0 || !Array.isArray(value.relations) || value.relations.length === 0) {
      fail("improve_extraction_invalid");
    }
    const entities = value.entities.map((entity) => {
      const aliases = [...new Set(entity.aliases ?? [])].sort();
      return {
        entity_id: canonicalGraphEntityId({ workspaceId, bindingId: entity.binding_id }),
        binding_id: entity.binding_id,
        canonical_name: entity.canonical_name,
        entity_type: entity.entity_type,
        aliases
      };
    });
    const byBinding = new Map(entities.map((entity) => [entity.binding_id, entity.entity_id]));
    const relations = value.relations.map((relation) => {
      const subject = byBinding.get(relation.subject_binding_id);
      const object = byBinding.get(relation.object_binding_id);
      if (!subject || !object) fail("improve_relation_entity_unknown");
      return {
        relation_id: canonicalGraphRelationId({ workspaceId, relationKey: relation.relation_key }),
        relation_key: relation.relation_key,
        subject_entity_id: subject,
        predicate: relation.predicate,
        object_entity_id: object,
        valid_from: relation.valid_from ?? episode.observed_at,
        valid_to: relation.valid_to ?? null,
        supersedes_relation_ids: [...new Set(relation.supersedes_relation_ids ?? [])].sort(),
        contradicts_relation_ids: [...new Set(relation.contradicts_relation_ids ?? [])].sort()
      };
    });
    return { ...value, entities, relations };
  };
  const authoritativeState = () => {
    const state = graphAdapter.readCanonicalState({ workspaceId });
    const authorized = graphAdapter.readAuthorizedState({ workspaceId, asOf: clock() });
    return { state, claims: authorized.claims, relations: authorized.relations, entities: authorized.entities };
  };
  const projectionMaterial = () => {
    const { claims, relations, entities, state } = authoritativeState();
    const claimById = new Map(claims.map((claim) => [claim.claim_id, claim]));
    const cite = (claim, ontologyVersion) => ({
      source_claim_ids: [claim.claim_id],
      episode_ids: claim.episode_ids,
      evidence_ids: claim.evidence_ids,
      admission_ids: [claim.admission.admission_id],
      ontology_version: ontologyVersion
    });
    const triplets = relations.map((relation) => ({
      artifact_id: `trip_${hash(canonicalJson({ workspace_id: workspaceId, relation_id: relation.relation_id }))}`,
      relation_id: relation.relation_id,
      subject_entity_id: relation.subject_entity_id,
      predicate: relation.predicate,
      object_entity_id: relation.object_entity_id,
      valid_from: relation.valid_from,
      valid_to: relation.valid_to,
      ...cite(claimById.get(relation.claim_id), relation.ontology_version)
    })).sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
    const embeddings = claims.map((claim) => {
      const ontologyVersion = relations.find((item) => item.claim_id === claim.claim_id)?.ontology_version ?? claim.ontology_version;
      return {
        artifact_id: `emb_${hash(canonicalJson({ workspace_id: workspaceId, claim_id: claim.claim_id }))}`,
        vector: boundedVector(claim.claim_text),
        ...cite(claim, ontologyVersion)
      };
    }).sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
    const adjacency = new Map(entities.map((entity) => [entity.entity_id, new Set()]));
    for (const relation of relations) {
      adjacency.get(relation.subject_entity_id)?.add(relation.object_entity_id);
      adjacency.get(relation.object_entity_id)?.add(relation.subject_entity_id);
    }
    const communities = [];
    const visited = new Set();
    for (const entityId of [...adjacency.keys()].sort()) {
      if (visited.has(entityId)) continue;
      const queue = [entityId];
      const members = [];
      while (queue.length) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        members.push(current);
        queue.push(...[...(adjacency.get(current) ?? [])].sort());
      }
      const related = relations.filter((item) => members.includes(item.subject_entity_id) || members.includes(item.object_entity_id));
      const relatedClaims = [...new Set(related.map((item) => item.claim_id))].sort();
      const sources = relatedClaims.map((id) => claimById.get(id));
      const communityId = `com_${hash(canonicalJson({ workspace_id: workspaceId, entity_ids: members.sort() }))}`;
      communities.push({
        artifact_id: communityId,
        entity_ids: members.sort(),
        relation_ids: related.map((item) => item.relation_id).sort(),
        source_claim_ids: relatedClaims,
        episode_ids: [...new Set(sources.flatMap((claim) => claim.episode_ids))].sort(),
        evidence_ids: [...new Set(sources.flatMap((claim) => claim.evidence_ids))].sort(),
        admission_ids: [...new Set(sources.map((claim) => claim.admission.admission_id))].sort(),
        ontology_versions: [...new Set(related.map((item) => item.ontology_version))].sort()
      });
    }
    const summaries = communities.map((community) => ({
      artifact_id: `sum_${hash(canonicalJson({ workspace_id: workspaceId, community_id: community.artifact_id }))}`,
      community_id: community.artifact_id,
      text: community.source_claim_ids.map((id) => claimById.get(id).claim_text).sort().join(" "),
      source_claim_ids: community.source_claim_ids,
      episode_ids: community.episode_ids,
      evidence_ids: community.evidence_ids,
      admission_ids: community.admission_ids,
      ontology_versions: community.ontology_versions
    }));
    return {
      schema: "supermemory.enrichment-projection.v1",
      workspace_id: workspaceId,
      canonical_projection_hash: contentHash({
        entities: state.entities, claims: state.claims, relations: state.relations, tombstones: state.tombstones
      }),
      triplets,
      embeddings,
      communities,
      summaries
    };
  };
  const rebuildEnrichments = () => withVaultMutationLock(vault, () => {
    const material = projectionMaterial();
    const projectionId = `enr_${hash(canonicalJson(material))}`;
    if (fs.existsSync(artifactPath("projections", projectionId))) {
      return readArtifact("projections", projectionId);
    }
    return writeArtifact("projections", projectionId, {
      artifact_id: projectionId,
      projection_id: projectionId,
      ...material,
      rebuilt_at: clock()
    });
  });
  const readProjection = () => {
    const current = projectionMaterial();
    const currentId = `enr_${hash(canonicalJson(current))}`;
    return listArtifacts("projections").find((item) => item.projection_id === currentId) ?? null;
  };
  const syncSourceAuthority = (sources) => {
    let state = graphAdapter.readCanonicalState({ workspaceId });
    const tombstonedEpisodes = new Set(state.tombstones.filter((item) => item.tombstone_type === "episode").map((item) => item.target_id));
    for (const source of sources.filter((item) => item.status === "tombstoned")) {
      if (
        !tombstonedEpisodes.has(source.episode.episode_id) &&
        state.claims.some((claim) => claim.episode_ids.includes(source.episode.episode_id))
      ) {
        graphAdapter.tombstoneEpisode({ workspaceId, episodeId: source.episode.episode_id });
        tombstonedEpisodes.add(source.episode.episode_id);
      }
    }
    for (const admissionId of episodeSource.listRevokedAdmissions?.({ workspaceId }) ?? []) {
      state = graphAdapter.readCanonicalState({ workspaceId });
      if (
        !state.tombstones.some((item) => item.tombstone_type === "admission" && item.target_id === admissionId) &&
        state.claims.some((claim) => claim.admission.admission_id === admissionId)
      ) graphAdapter.revokeAdmission({ workspaceId, admissionId });
    }
  };
  const process = ({ sessionId = null, session_id: snakeSessionId = null } = {}) => {
    const requestedSession = sessionId ?? snakeSessionId;
    const allSources = episodeSource.listCanonicalEvidence({ workspaceId });
    syncSourceAuthority(allSources);
    const processed = new Set(readCheckpoint()?.processed_episode_ids ?? []);
    const pending = allSources.filter((source) => (
      source.status === "active" && !processed.has(source.episode.episode_id) &&
      (!requestedSession || source.episode.session_id === requestedSession)
    ));
    const results = [];
    for (const source of pending) {
      const { episode, evidence, payload } = source;
      try {
        const computedContentHash = contentHash(payload);
        const expectedCursorOwner = `${evidence.source_adapter}:${evidence.session_id}`;
        if (
          source.reopened !== true || episode.workspace_id !== workspaceId || evidence.workspace_id !== workspaceId ||
          episode.project_id !== evidence.project_id || episode.session_id !== evidence.session_id ||
          evidence.episode_id !== episode.episode_id || !episode.evidence_ids.includes(evidence.evidence_id) ||
          !Array.isArray(episode.source_event_ids) || !episode.source_event_ids.includes(evidence.event_id) ||
          episode.content_hash !== evidence.content_hash || episode.content_hash !== computedContentHash ||
          payload === null || payload === undefined ||
          source.cursor?.owner !== expectedCursorOwner || source.cursor?.event_id !== evidence.event_id ||
          source.cursor?.sequence !== evidence.source_sequence ||
          !Number.isSafeInteger(source.cursor.sequence) || source.cursor.sequence < 0
        ) fail("improve_canonical_evidence_invalid");
        const extracted = normalizeExtraction(source, extractor.extract({
          workspaceId,
          episode,
          evidence,
          payload,
          extractor: extractorIdentity
        }));
        const claimId = canonicalGraphClaimId({ workspaceId, claimKey: extracted.claim_key });
        const candidate = {
          candidate_id: claimId,
          workspace_id: workspaceId,
          evidence_ids: episode.evidence_ids,
          sensitivity: episode.sensitivity ?? "standard",
          extractor: extractorIdentity
        };
        const verification = verifier.verify({
          workspaceId,
          episode,
          evidence,
          payload,
          candidate: { ...candidate, text: extracted.text },
          extraction: extracted,
          verifier: verifierIdentity
        });
        if (!verification || verification.status !== "verified") {
          results.push({ episode_id: episode.episode_id, status: "pending_verification" });
          break;
        }
        if (
          extracted.entities.some((entity) => entity.aliases.length > 0) &&
          verification.signals?.alias_binding_verified !== true
        ) fail("improve_alias_binding_unverified");
        verification.verifier = { ...verifierIdentity, independent: verifier.identity.independent === true };
        const admission = admissionPolicy.evaluate({ candidate, verification });
        if (!admission.recall_allowed) {
          checkpointEpisode(source, admission.status);
          results.push({ episode_id: episode.episode_id, status: admission.status });
          continue;
        }
        const graph = graphAdapter.upsertEpisodeGraph({
          workspaceId,
          episodeId: episode.episode_id,
          evidenceIds: episode.evidence_ids,
          claim: {
            claim_id: claimId,
            claim_key: extracted.claim_key,
            text: extracted.text,
            observed_at: episode.observed_at
          },
          admission: admission.admission,
          entities: extracted.entities,
          relations: extracted.relations
        });
        const authoritativeClaim = graphAdapter.resolveAuthorizedClaims({
          workspaceId,
          claimIds: [claimId],
          asOf: clock()
        })[0];
        if (!authoritativeClaim) fail("improve_claim_authority_missing");
        for (const proposal of extracted.ontology_proposals ?? []) {
          const supportAttestation = createOntologySupportAttestation({
            workspaceId,
            claim: authoritativeClaim,
            proposal
          });
          ontologyRegistry?.proposeChange({
            ...proposal,
            sourceClaimId: claimId,
            supportAttestation
          });
        }
        const ontology = ontologyRegistry?.reevaluateShadows?.() ?? [];
        checkpointEpisode(source, admission.status);
        results.push({ episode_id: episode.episode_id, status: admission.status, claim_id: claimId, graph, ontology });
      } catch (error) {
        results.push({ episode_id: episode.episode_id, status: "failed", error: error?.code ?? "improve_failed" });
        break;
      }
    }
    const projection = rebuildEnrichments();
    return {
      status: results.some((item) => ["failed", "pending_verification"].includes(item.status)) ? "degraded" : "complete",
      workspace_id: workspaceId,
      processed: results.length,
      results,
      checkpoint: readCheckpoint(),
      projection
    };
  };
  const recordFeedback = ({ feedbackId, feedback_id: snakeId, artifactId, artifact_id: snakeArtifact, delta } = {}) => withVaultMutationLock(vault, () => {
    const id = feedbackId ?? snakeId;
    const target = artifactId ?? snakeArtifact;
    if (typeof id !== "string" || !id.trim() || typeof target !== "string" || !target.trim()) fail("improve_feedback_invalid");
    const amount = Number(delta);
    if (!Number.isFinite(amount)) fail("improve_feedback_invalid");
    const bounded = Math.max(-MAX_FEEDBACK_WEIGHT, Math.min(MAX_FEEDBACK_WEIGHT, amount));
    const artifactIdValue = `fdb_${hash(canonicalJson({ workspace_id: workspaceId, feedback_id: id, artifact_id: target }))}`;
    if (fs.existsSync(artifactPath("feedback", artifactIdValue))) return readArtifact("feedback", artifactIdValue);
    return writeArtifact("feedback", artifactIdValue, {
      schema: "supermemory.feedback.v1",
      artifact_id: artifactIdValue,
      workspace_id: workspaceId,
      feedback_id: id,
      target_artifact_id: target,
      bounded_delta: bounded,
      recorded_at: clock()
    });
  });
  const feedbackWeight = (artifactId) => Math.max(-MAX_FEEDBACK_WEIGHT, Math.min(
    MAX_FEEDBACK_WEIGHT,
    listArtifacts("feedback").filter((item) => item.target_artifact_id === artifactId)
      .reduce((sum, item) => sum + item.bounded_delta, 0)
  ));
  const notifySessionClosed = ({ sessionId, session_id: snakeSessionId } = {}) => {
    const sessionIdValue = sessionId ?? snakeSessionId;
    if (typeof sessionIdValue !== "string" || !sessionIdValue.trim()) fail("improve_session_close_invalid");
    const canonicalClose = episodeSource.readClosedSession({ workspaceId, sessionId: sessionIdValue });
    if (canonicalClose.workspace_id !== workspaceId || canonicalClose.session_id !== sessionIdValue) {
      fail("improve_session_close_invalid");
    }
    const closedAtValue = canonicalClose.closed_at;
    const notificationId = `scn_${hash(canonicalJson({ workspace_id: workspaceId, session_id: sessionIdValue, closed_at: closedAtValue }))}`;
    const existingPath = artifactPath("sessions", notificationId);
    if (fs.existsSync(existingPath)) return readArtifact("sessions", notificationId);
    const result = process({ sessionId: sessionIdValue });
    const completedAt = clock();
    const latencyMs = Date.parse(completedAt) - Date.parse(closedAtValue);
    if (latencyMs < 0 || latencyMs > 120_000) fail("improve_consolidation_deadline_exceeded");
    if (result.status !== "complete") {
      return {
        schema: "supermemory.session-consolidation.v1",
        notification_id: notificationId,
        workspace_id: workspaceId,
        session_id: sessionIdValue,
        closed_at: closedAtValue,
        completed_at: completedAt,
        latency_ms: latencyMs,
        status: "degraded_retryable",
        persisted: false
      };
    }
    return writeArtifact("sessions", notificationId, {
      schema: "supermemory.session-consolidation.v1",
      artifact_id: notificationId,
      notification_id: notificationId,
      workspace_id: workspaceId,
      session_id: sessionIdValue,
      closed_at: closedAtValue,
      completed_at: completedAt,
      latency_ms: latencyMs,
      checkpoint_id: result.checkpoint?.checkpoint_id ?? null,
      projection_id: result.projection.projection_id,
      status: result.status
    });
  };
  return Object.freeze({
    enabled: true,
    workspaceId,
    root,
    process,
    rebuildEnrichments,
    readProjection,
    readCheckpoint,
    recordFeedback,
    feedbackWeight,
    notifySessionClosed
  });
}

export function processImproveWorkspaces(workers) {
  if (!Array.isArray(workers)) fail("improve_workers_invalid");
  return workers.map((worker) => {
    try {
      return { workspace_id: worker.workspaceId, result: worker.process() };
    } catch (error) {
      return { workspace_id: worker.workspaceId, error: error?.code ?? "improve_failed" };
    }
  });
}
