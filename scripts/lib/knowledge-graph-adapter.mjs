import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifyAdmissionDecision } from "./memory-admission-policy.mjs";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import {
  CORE_ONTOLOGY_V1,
  assertCoreRelationType,
  createOntologyRegistry
} from "./ontology-registry.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";
import {
  eventTimeOverlaps,
  legacyObservedEventTime,
  validateEventTime
} from "./codex-temporal-normalizer.mjs";

const RECORD_KINDS = Object.freeze(["entities", "claims", "relations", "checkpoints", "tombstones", "commits"]);
const CANONICAL_KINDS = Object.freeze(["entities", "claims", "relations", "tombstones"]);
const ENTITY_ID = /^ent_[0-9a-f]{64}$/;
const CLAIM_ID = /^clm_[0-9a-f]{64}$/;
const RELATION_ID = /^rel_[0-9a-f]{64}$/;
const EPISODE_ID = /^epi_[A-Za-z0-9-]{8,}$/;
const EVIDENCE_ID = /^wev_[A-Za-z0-9-]{8,}$/;
const ADMISSION_ID = /^adm_[A-Za-z0-9-]{8,}$/;

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

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail("graph_encryption_key_invalid");
}

function assertWorkspace(value, code = "graph_scope_invalid") {
  if (typeof value !== "string" || !/^ws_[A-Za-z0-9._:-]{8,}$/.test(value)) fail(code);
  return value;
}

function assertId(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

function assertTimestamp(value, code) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(code);
  return value;
}

function boundedInteger(value, fallback, minimum, maximum, code) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) fail(code);
  return number;
}

function exactFields(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code);
}

function uniqueIds(value, pattern, code) {
  if (!Array.isArray(value) || value.length === 0) fail(code);
  const result = [...new Set(value)];
  for (const id of result) assertId(id, pattern, code);
  return result.sort();
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    if (!/^[A-Za-z0-9._:-]+$/.test(segment)) fail("graph_path_invalid");
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("graph_path_invalid");
    } else fs.mkdirSync(next, { mode: 0o700 });
    fs.chmodSync(next, 0o700);
    current = fs.realpathSync(next);
    const remainder = path.relative(root, current);
    if (remainder.startsWith("..") || path.isAbsolute(remainder)) fail("graph_scope_escape");
  }
  return current;
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
    // File fsync and atomic rename remain the portable durability baseline.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
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
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function recordPayload(value) {
  const result = { ...value };
  delete result.schema;
  delete result.workspace_id;
  delete result.record_kind;
  delete result.record_id;
  delete result.revision;
  delete result.integrity_hash;
  delete result.batch_id;
  return result;
}

function validAt(record, asOf) {
  const point = Date.parse(asOf);
  return Date.parse(record.valid_from) <= point &&
    (record.valid_to === null || point < Date.parse(record.valid_to));
}

export function canonicalGraphEntityId({ workspaceId, bindingId }) {
  assertWorkspace(workspaceId);
  if (typeof bindingId !== "string" || !bindingId.trim()) fail("graph_entity_binding_invalid");
  return `ent_${hash(canonicalJson({ workspace_id: workspaceId, binding_id: bindingId }))}`;
}

export function canonicalGraphClaimId({ workspaceId, claimKey }) {
  assertWorkspace(workspaceId);
  if (typeof claimKey !== "string" || !claimKey.trim()) fail("graph_claim_key_invalid");
  return `clm_${hash(canonicalJson({ workspace_id: workspaceId, claim_key: claimKey }))}`;
}

export function canonicalGraphRelationId({ workspaceId, relationKey }) {
  assertWorkspace(workspaceId);
  if (typeof relationKey !== "string" || !relationKey.trim()) fail("graph_relation_key_invalid");
  return `rel_${hash(canonicalJson({ workspace_id: workspaceId, relation_key: relationKey }))}`;
}

export function validateGraphQueryAst(value, relationTypeValidator = assertCoreRelationType) {
  exactFields(value, new Set([
    "workspace_id", "entity_ids", "relation_types", "direction", "as_of", "max_hops", "limit"
  ]), "graph_query_shape_invalid");
  const workspaceId = assertWorkspace(value.workspace_id, "graph_query_scope_invalid");
  const entityIds = uniqueIds(value.entity_ids, ENTITY_ID, "graph_query_entity_invalid");
  if (!Array.isArray(value.relation_types) || value.relation_types.length === 0) {
    fail("graph_query_relation_invalid");
  }
  const relationTypes = [...new Set(value.relation_types)].sort();
  for (const relationType of relationTypes) relationTypeValidator(relationType);
  const direction = value.direction ?? "both";
  if (!["outbound", "inbound", "both"].includes(direction)) fail("graph_query_direction_invalid");
  const maxHops = value.max_hops ?? 3;
  if (!Number.isSafeInteger(maxHops) || maxHops < 1 || maxHops > 5) fail("graph_query_hops_invalid");
  const limit = value.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail("graph_query_limit_invalid");
  const asOf = value.as_of ?? new Date().toISOString();
  assertTimestamp(asOf, "graph_query_time_invalid");
  return {
    workspace_id: workspaceId,
    entity_ids: entityIds,
    relation_types: relationTypes,
    direction,
    as_of: asOf,
    max_hops: maxHops,
    limit
  };
}

function traverseCandidates(records, query) {
  const relations = records.relations.filter((relation) => (
    relation.workspace_id === query.workspace_id && query.relation_types.includes(relation.predicate)
  ));
  const paths = [];
  let frontier = query.entity_ids.map((entityId) => ({ entity_ids: [entityId], relation_ids: [] }));
  for (let hop = 0; hop < query.max_hops; hop += 1) {
    const next = [];
    for (const candidate of frontier) {
      const current = candidate.entity_ids.at(-1);
      for (const relation of relations) {
        const outbound = relation.subject_entity_id === current;
        const inbound = relation.object_entity_id === current;
        if (query.direction === "outbound" && !outbound) continue;
        if (query.direction === "inbound" && !inbound) continue;
        if (query.direction === "both" && !outbound && !inbound) continue;
        const adjacent = outbound ? relation.object_entity_id : relation.subject_entity_id;
        if (candidate.entity_ids.includes(adjacent)) continue;
        const extended = {
          entity_ids: [...candidate.entity_ids, adjacent],
          relation_ids: [...candidate.relation_ids, relation.relation_id]
        };
        paths.push(extended);
        next.push(extended);
        if (paths.length >= query.limit * query.max_hops * 4) return { paths };
      }
    }
    frontier = next;
  }
  return { paths };
}

export function createInMemoryGraphEngine() {
  let projection = { entities: [], claims: [], relations: [], tombstones: [] };
  return {
    kind: "deterministic-memory",
    reset(records) {
      projection = JSON.parse(canonicalJson(records));
      return { ok: true, projection_hash: contentHash(projection) };
    },
    clear() {
      projection = { entities: [], claims: [], relations: [], tombstones: [] };
    },
    query(request) {
      return traverseCandidates(projection, request.parameters);
    },
    snapshotHash() {
      return contentHash(projection);
    },
    snapshot() {
      return JSON.parse(canonicalJson(projection));
    }
  };
}

export function createKnowledgeGraphAdapter({
  vaultRoot,
  encryptionKey,
  workspaceId: boundWorkspaceId,
  provenanceResolver,
  engine = createInMemoryGraphEngine(),
  remoteBackend = null,
  clock = () => new Date().toISOString(),
  faultInjector = null,
  ontologyRegistry = createOntologyRegistry()
} = {}) {
  assertKey(encryptionKey);
  const authorizedWorkspace = assertWorkspace(boundWorkspaceId, "graph_scope_required");
  if (typeof provenanceResolver !== "function") fail("graph_provenance_resolver_required");
  if (!engine || typeof engine.reset !== "function" || typeof engine.query !== "function") {
    fail("graph_engine_invalid");
  }
  if (
    !ontologyRegistry || typeof ontologyRegistry.validateEntity !== "function" ||
    typeof ontologyRegistry.validateRelation !== "function" ||
    typeof ontologyRegistry.hasRelationType !== "function"
  ) fail("graph_ontology_registry_invalid");
  if (remoteBackend && (typeof remoteBackend.query !== "function" || typeof remoteBackend.project !== "function")) {
    fail("graph_backend_invalid");
  }
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const graphRootRelative = "20_professional/memory-fabric";
  const inject = (point, value) => {
    if (typeof faultInjector === "function") faultInjector(point, value);
  };
  const authorizeWorkspace = (value) => {
    const workspaceId = assertWorkspace(value, "graph_unknown");
    if (workspaceId !== authorizedWorkspace) fail("graph_unknown");
    return workspaceId;
  };
  const workspaceRoot = (workspaceId, create = false) => {
    assertWorkspace(workspaceId, "graph_unknown");
    const relative = `${graphRootRelative}/${workspaceId}/graph`;
    return create ? ensureDirectory(vault, relative) : path.join(vault, relative);
  };
  const kindRoot = (workspaceId, kind, create = false) => {
    if (!RECORD_KINDS.includes(kind)) fail("graph_record_kind_invalid");
    const relative = `${graphRootRelative}/${workspaceId}/graph/${kind}`;
    return create ? ensureDirectory(vault, relative) : path.join(workspaceRoot(workspaceId), kind);
  };
  const recordAad = (workspaceId, kind, id, revision) => (
    `supermemory.graph-record.v1.${workspaceId}.${kind}.${id}.${revision}`
  );
  const recordFiles = (workspaceId, kind) => {
    const directory = kindRoot(workspaceId, kind);
    if (!fs.existsSync(directory)) return [];
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("graph_record_corrupt");
    return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
      if (entry.isSymbolicLink() || !entry.isFile()) fail("graph_record_corrupt");
      const match = /^([A-Za-z]+_[A-Za-z0-9-]+)\.(\d{6})\.json\.aead$/.exec(entry.name);
      if (!match) fail("graph_record_corrupt");
      return { filePath: path.join(directory, entry.name), id: match[1], revision: Number(match[2]) };
    }).sort((left, right) => left.id.localeCompare(right.id) || left.revision - right.revision);
  };
  const openRecord = (workspaceId, kind, file) => {
    try {
      const record = openJsonAead(JSON.parse(fs.readFileSync(file.filePath, "utf8")), {
        encryptionKey,
        expectedAad: recordAad(workspaceId, kind, file.id, file.revision)
      });
      const unsigned = { ...record };
      delete unsigned.integrity_hash;
      if (
        record?.schema !== "supermemory.graph-record.v1" || record.workspace_id !== workspaceId ||
        record.record_kind !== kind || record.record_id !== file.id || record.revision !== file.revision ||
        record.integrity_hash !== contentHash(unsigned)
      ) fail("graph_record_corrupt");
      return record;
    } catch (error) {
      if (error?.code === "graph_record_corrupt") throw error;
      fail("graph_record_corrupt");
    }
  };
  const revisions = (workspaceId, kind, id = null) => recordFiles(workspaceId, kind)
    .filter((file) => id === null || file.id === id)
    .map((file) => openRecord(workspaceId, kind, file));
  const latestRecords = (workspaceId, kind) => {
    const latest = new Map();
    for (const record of revisions(workspaceId, kind)) latest.set(record.record_id, record);
    return [...latest.values()].sort((left, right) => left.record_id.localeCompare(right.record_id));
  };
  const appendRevision = (workspaceId, kind, id, body, { batchId = null, deduplicate = true } = {}) => {
    const history = revisions(workspaceId, kind, id);
    const current = history.at(-1) ?? null;
    const normalizedBody = recordPayload(body);
    if (deduplicate && current && canonicalJson(recordPayload(current)) === canonicalJson(normalizedBody)) return current;
    const revision = (current?.revision ?? 0) + 1;
    const unsigned = {
      schema: "supermemory.graph-record.v1",
      workspace_id: workspaceId,
      record_kind: kind,
      record_id: id,
      revision,
      ...(batchId ? { batch_id: batchId } : {}),
      ...normalizedBody
    };
    const record = { ...unsigned, integrity_hash: contentHash(unsigned) };
    const directory = kindRoot(workspaceId, kind, true);
    const filePath = path.join(directory, `${id}.${String(revision).padStart(6, "0")}.json.aead`);
    if (fs.existsSync(filePath)) fail("graph_record_collision");
    atomicWrite(filePath, `${JSON.stringify(sealJsonAead(record, {
      encryptionKey,
      aad: recordAad(workspaceId, kind, id, revision)
    }))}\n`);
    const reopened = openRecord(workspaceId, kind, { filePath, id, revision });
    if (canonicalJson(reopened) !== canonicalJson(record)) fail("graph_record_reopen_failed");
    return reopened;
  };

  const canonicalRecords = (workspaceId) => {
    const available = new Map();
    for (const kind of CANONICAL_KINDS) {
      for (const record of revisions(workspaceId, kind)) {
        available.set(`${kind}\0${record.record_id}\0${record.revision}\0${record.integrity_hash}`, record);
      }
    }
    const visible = new Map(CANONICAL_KINDS.map((kind) => [kind, new Map()]));
    for (const commit of revisions(workspaceId, "commits")) {
      const body = recordPayload(commit);
      if (
        body.commit_id !== commit.record_id ||
        body.status !== "committed" || !Array.isArray(body.records) || body.records.length === 0
      ) fail("graph_commit_corrupt");
      for (const reference of body.records) {
        exactFields(reference, new Set(["kind", "record_id", "revision", "integrity_hash"]), "graph_commit_corrupt");
        if (!CANONICAL_KINDS.includes(reference.kind) || !Number.isSafeInteger(reference.revision)) {
          fail("graph_commit_corrupt");
        }
        const key = `${reference.kind}\0${reference.record_id}\0${reference.revision}\0${reference.integrity_hash}`;
        const record = available.get(key);
        if (!record || record.batch_id !== commit.record_id) fail("graph_commit_corrupt");
        const current = visible.get(reference.kind).get(record.record_id);
        if (!current || record.revision > current.revision) visible.get(reference.kind).set(record.record_id, record);
      }
    }
    return Object.fromEntries(CANONICAL_KINDS.map((kind) => [
      kind,
      [...visible.get(kind).values()].sort((left, right) => left.record_id.localeCompare(right.record_id))
    ]));
  };
  const canonicalState = (workspaceId) => {
    const records = canonicalRecords(workspaceId);
    return Object.fromEntries(CANONICAL_KINDS.map((kind) => [
      kind,
      records[kind].map((record) => ({ workspace_id: workspaceId, ...recordPayload(record) }))
    ]));
  };
  const commitBatch = (workspaceId, entries, purpose) => {
    if (entries.length === 0) return null;
    const batchId = `bat_${hash(canonicalJson({
      workspace_id: workspaceId,
      purpose,
      entries: entries.map(({ kind, id, body }) => ({ kind, id, body: recordPayload(body) }))
    }))}`;
    if (latestRecords(workspaceId, "commits").some((record) => record.record_id === batchId)) return batchId;
    const staged = [];
    for (const entry of entries) {
      const record = appendRevision(workspaceId, entry.kind, entry.id, entry.body, {
        batchId,
        deduplicate: false
      });
      staged.push({
        kind: entry.kind,
        record_id: record.record_id,
        revision: record.revision,
        integrity_hash: record.integrity_hash
      });
      inject("after_staged_record", { workspaceId, batchId, staged_count: staged.length });
    }
    inject("before_batch_commit", { workspaceId, batchId, record_count: staged.length });
    appendRevision(workspaceId, "commits", batchId, {
      commit_id: batchId,
      purpose,
      records: staged,
      status: "committed",
      committed_at: clock()
    }, { deduplicate: false });
    inject("after_batch_commit", { workspaceId, batchId, record_count: staged.length });
    return batchId;
  };

  const tombstoneSets = (state) => ({
    episodes: new Set(state.tombstones.filter((item) => item.tombstone_type === "episode").map((item) => item.target_id)),
    admissions: new Set(state.tombstones.filter((item) => item.tombstone_type === "admission").map((item) => item.target_id))
  });
  const provenanceActive = (workspaceId, episodeIds, evidenceIds) => {
    try {
      return provenanceResolver({ workspaceId, episodeIds, evidenceIds }) === true;
    } catch {
      return false;
    }
  };
  const claimAuthorized = (claim, state, asOf) => {
    if (!claim || claim.status !== "active") return false;
    if (["superseded", "revoked", "expired"].includes(claim.authority?.state)) return false;
    if (claim.authority?.valid_until && Date.parse(asOf) >= Date.parse(claim.authority.valid_until)) return false;
    const tombstones = tombstoneSets(state);
    if (tombstones.admissions.has(claim.admission.admission_id)) return false;
    if (claim.episode_ids.some((id) => tombstones.episodes.has(id))) return false;
    if (!provenanceActive(claim.workspace_id, claim.episode_ids, claim.evidence_ids)) return false;
    if (!verifyAdmissionDecision(claim.admission, {
      candidateId: claim.claim_id,
      workspaceId: claim.workspace_id,
      evidenceIds: claim.evidence_ids
    })) return false;
    if (!["auto_activate", "activate_ttl"].includes(claim.admission.decision)) return false;
    const authorityAt = Date.parse(clock());
    if (Date.parse(claim.admission.decided_at) > authorityAt) return false;
    if (claim.admission.decision === "activate_ttl" && Date.parse(claim.admission.expires_at) <= authorityAt) {
      return false;
    }
    return true;
  };
  const authorizedState = (workspaceId, asOf = clock()) => {
    const state = canonicalState(workspaceId);
    const claims = state.claims.filter((claim) => claimAuthorized(claim, state, asOf));
    const claimIds = new Set(claims.map((claim) => claim.claim_id));
    const relations = state.relations.filter((relation) => (
      claimIds.has(relation.claim_id) && validAt(relation, asOf) &&
      !["tombstoned", "revoked"].includes(relation.status)
    ));
    const entityIds = new Set(relations.flatMap((relation) => [
      relation.subject_entity_id,
      relation.object_entity_id
    ]));
    const entities = state.entities.filter((entity) => (
      entity.status === "active" && entityIds.has(entity.entity_id)
    ));
    return { workspace_id: workspaceId, as_of: asOf, entities, claims, relations, tombstones: state.tombstones };
  };

  const projectionMaterial = (state) => ({
    entities: state.entities,
    claims: state.claims,
    relations: state.relations,
    tombstones: state.tombstones
  });
  const backendRequest = (operation, workspaceId, parameters) => ({
    schema: "supermemory.graphd-request.v2",
    contract_version: "2.0.0",
    operation,
    workspace_id: workspaceId,
    statement_id: operation === "query" ? "bounded_path_v2" : "replace_workspace_projection_v2",
    parameters
  });
  const project = (workspaceId, state) => {
    const material = projectionMaterial(state);
    const projectionHash = contentHash(material);
    const backend = "deterministic-memory";
    engine.reset(material);
    const existing = latestRecords(workspaceId, "checkpoints");
    const checkpointId = `chk_${hash(canonicalJson({ projection_hash: projectionHash, sequence: existing.length + 1 }))}`;
    appendRevision(workspaceId, "checkpoints", checkpointId, {
      checkpoint_id: checkpointId,
      projection_hash: projectionHash,
      backend,
      status: "complete",
      projected_at: clock()
    });
    return { projected: true, backend, projection_hash: projectionHash };
  };
  const bestEffortProject = (workspaceId) => {
    try {
      return project(workspaceId, canonicalState(workspaceId));
    } catch (error) {
      return { projected: false, backend: "unavailable", error: error?.code ?? "graph_projection_failed" };
    }
  };

  const validateClaim = (workspaceId, value, evidenceIds, episodeIds, admission) => {
    exactFields(value, new Set(["claim_id", "claim_key", "text", "observed_at", "event_time"]), "graph_claim_shape_invalid");
    const claimId = assertId(value.claim_id, CLAIM_ID, "graph_claim_id_invalid");
    if (claimId !== canonicalGraphClaimId({ workspaceId, claimKey: value.claim_key })) {
      fail("graph_claim_key_invalid");
    }
    if (typeof value.text !== "string" || !value.text.trim()) fail("graph_claim_text_invalid");
    const observedAt = assertTimestamp(value.observed_at, "graph_claim_time_invalid");
    const eventTime = value.event_time
      ? validateEventTime(value.event_time)
      : legacyObservedEventTime(observedAt);
    if (!verifyAdmissionDecision(admission, {
      candidateId: claimId,
      workspaceId,
      evidenceIds
    }) || !["auto_activate", "activate_ttl"].includes(admission.decision)) {
      fail("graph_admission_invalid");
    }
    if (!provenanceActive(workspaceId, episodeIds, evidenceIds)) fail("graph_provenance_invalid");
    return { claimId, claimKey: value.claim_key, observedAt, eventTime, text: value.text };
  };

  const upsertEpisodeGraph = (input) => withVaultMutationLock(vault, () => {
    const workspaceId = authorizeWorkspace(input?.workspaceId ?? input?.workspace_id);
    exactFields(input, new Set([
      "workspaceId", "workspace_id", "episodeId", "episode_id", "evidenceIds", "evidence_ids",
      "claim", "admission", "authorityState", "authority_state", "authorityTransitions", "authority_transitions",
      "entities", "relations"
    ]), "graph_mutation_shape_invalid");
    const episodeId = assertId(input.episodeId ?? input.episode_id, EPISODE_ID, "graph_episode_id_invalid");
    const evidenceIds = uniqueIds(input.evidenceIds ?? input.evidence_ids, EVIDENCE_ID, "graph_evidence_invalid");
    const episodeIds = [episodeId];
    const { claimId, claimKey, observedAt, eventTime, text } = validateClaim(
      workspaceId,
      input.claim,
      evidenceIds,
      episodeIds,
      input.admission
    );
    if (!Array.isArray(input.entities) || input.entities.length === 0) fail("graph_entities_missing");
    if (!Array.isArray(input.relations) || input.relations.length === 0) fail("graph_relations_missing");
    const entities = input.entities.map((value) => ontologyRegistry.validateEntity(value));
    const relations = input.relations.map((value) => ontologyRegistry.validateRelation({
      ...value,
      event_time: value.event_time ?? eventTime
    }));
    const ontologyVersion = ontologyRegistry.activeVersion?.().version_id ?? CORE_ONTOLOGY_V1.version;
    const authorityState = input.authorityState ?? input.authority_state ?? {
      schema: "supermemory.authority-state.v1",
      claim_id: claimId,
      state: "current",
      revision: 0,
      policy_version: "admission-compatibility-v1",
      valid_from: observedAt,
      valid_until: null,
      supersedes: [],
      evidence_ids: evidenceIds,
      reason_codes: ["legacy_admission_authority"]
    };
    if (
      authorityState.schema !== "supermemory.authority-state.v1" || authorityState.claim_id !== claimId ||
      !["current", "provisional", "disputed", "superseded", "revoked", "expired"].includes(authorityState.state) ||
      !Number.isSafeInteger(authorityState.revision) || authorityState.revision < 0
    ) fail("graph_authority_state_invalid");
    const entityIds = new Set(entities.map((entity) => entity.entity_id));
    if (entityIds.size !== entities.length) fail("graph_entity_duplicate");
    for (const entity of entities) {
      if (entity.entity_id !== canonicalGraphEntityId({ workspaceId, bindingId: entity.binding_id })) {
        fail("graph_entity_binding_invalid");
      }
    }
    for (const relation of relations) {
      if (relation.relation_id !== canonicalGraphRelationId({ workspaceId, relationKey: relation.relation_key })) {
        fail("graph_relation_key_invalid");
      }
      if (!entityIds.has(relation.subject_entity_id) || !entityIds.has(relation.object_entity_id)) {
        fail("graph_relation_entity_unknown");
      }
    }
    if (new Set(relations.map((relation) => relation.relation_id)).size !== relations.length) {
      fail("graph_relation_duplicate");
    }

    const current = canonicalState(workspaceId);
    const currentClaims = new Map(current.claims.map((claim) => [claim.claim_id, claim]));
    const existingClaim = currentClaims.get(claimId);
    const claimBody = {
      claim_id: claimId,
      claim_key: claimKey,
      claim_text: text,
      observed_at: observedAt,
      event_time: eventTime,
      evidence_ids: evidenceIds,
      episode_ids: episodeIds,
      admission: input.admission,
      authority: authorityState,
      ontology_version: ontologyVersion,
      status: "active",
      content_hash: contentHash({ text, evidence_ids: evidenceIds, episode_ids: episodeIds })
    };
    if (existingClaim && canonicalJson(recordPayload(existingClaim)) !== canonicalJson(claimBody)) fail("graph_claim_id_collision");
    const entries = [];
    for (const transition of input.authorityTransitions ?? input.authority_transitions ?? []) {
      if (transition?.schema !== "supermemory.authority-state.v1") fail("graph_authority_state_invalid");
      const priorClaim = currentClaims.get(transition.claim_id);
      if (!priorClaim) continue;
      entries.push({ kind: "claims", id: priorClaim.claim_id, body: { ...priorClaim, authority: transition } });
      for (const priorRelation of current.relations.filter((item) => item.claim_id === priorClaim.claim_id)) {
        entries.push({
          kind: "relations",
          id: priorRelation.relation_id,
          body: {
            ...priorRelation,
            authority_state: transition.state,
            authority_revision: transition.revision
          }
        });
      }
    }
    if (!existingClaim) entries.push({ kind: "claims", id: claimId, body: claimBody });

    const currentEntities = new Map(current.entities.map((entity) => [entity.entity_id, entity]));
    for (const entity of entities) {
      const existing = currentEntities.get(entity.entity_id);
      if (existing && (
        existing.binding_id !== entity.binding_id || existing.entity_type !== entity.entity_type ||
        existing.canonical_name !== entity.canonical_name
      )) fail("graph_entity_binding_conflict");
      const body = {
        entity_id: entity.entity_id,
        binding_id: entity.binding_id,
        canonical_name: entity.canonical_name,
        entity_type: entity.entity_type,
        aliases: [...new Set([...(existing?.aliases ?? []), ...entity.aliases])].sort(),
        claim_ids: [...new Set([...(existing?.claim_ids ?? []), claimId])].sort(),
        evidence_ids: [...new Set([...(existing?.evidence_ids ?? []), ...evidenceIds])].sort(),
        episode_ids: [...new Set([...(existing?.episode_ids ?? []), ...episodeIds])].sort(),
        admission_ids: [...new Set([...(existing?.admission_ids ?? []), input.admission.admission_id])].sort(),
        ontology_version: ontologyVersion,
        observed_at: existing?.observed_at ?? observedAt,
        last_observed_at: observedAt,
        status: "active"
      };
      if (!existing || canonicalJson(recordPayload(existing)) !== canonicalJson(body)) {
        entries.push({ kind: "entities", id: entity.entity_id, body });
      }
    }

    const relationState = new Map(current.relations.map((relation) => [relation.relation_id, relation]));
    const relationEntries = new Map();
    for (const relation of relations) {
      const ambiguousClosures = relation.supersedes_relation_ids.filter((targetId) => (
        relation.contradicts_relation_ids.includes(targetId)
      ));
      if (ambiguousClosures.length > 0) fail("graph_relation_closure_ambiguous");
      for (const targetId of [...relation.supersedes_relation_ids, ...relation.contradicts_relation_ids]) {
        assertId(targetId, RELATION_ID, "graph_relation_unknown");
        const target = relationState.get(targetId);
        if (!target || target.workspace_id && target.workspace_id !== workspaceId) fail("graph_relation_unknown");
        if (targetId !== canonicalGraphRelationId({ workspaceId, relationKey: target.relation_key })) {
          fail("graph_relation_unknown");
        }
        if (
          ["tombstoned", "revoked"].includes(target.status) ||
          Date.parse(relation.valid_from) <= Date.parse(target.valid_from)
        ) fail("graph_relation_window_invalid");
        const closureStatus = relation.contradicts_relation_ids.includes(targetId) ? "contradicted" : "superseded";
        if (target.valid_to) {
          if (
            target.valid_to !== relation.valid_from || target.status !== closureStatus ||
            target.closed_by_relation_id !== relation.relation_id
          ) fail("graph_relation_already_closed");
          continue;
        }
        const closed = {
          ...target,
          valid_to: relation.valid_from,
          status: closureStatus,
          closed_by_relation_id: relation.relation_id
        };
        relationEntries.set(targetId, { kind: "relations", id: targetId, body: closed });
        relationState.set(targetId, closed);
      }
      const body = {
        relation_id: relation.relation_id,
        relation_key: relation.relation_key,
        subject_entity_id: relation.subject_entity_id,
        predicate: relation.predicate,
        object_entity_id: relation.object_entity_id,
        claim_id: claimId,
        claim_text: text,
        valid_from: relation.valid_from,
        valid_to: relation.valid_to,
        event_time: relation.event_time,
        observed_at: observedAt,
        evidence_ids: evidenceIds,
        episode_ids: episodeIds,
        admission_id: input.admission.admission_id,
        authority_state: authorityState.state,
        authority_revision: authorityState.revision,
        ontology_version: ontologyVersion,
        supersedes_relation_ids: relation.supersedes_relation_ids,
        contradicts_relation_ids: relation.contradicts_relation_ids,
        status: "active",
        closed_by_relation_id: null
      };
      const existing = relationState.get(relation.relation_id);
      if (existing && canonicalJson(recordPayload(existing)) !== canonicalJson(body)) fail("graph_relation_id_collision");
      if (!existing) relationEntries.set(relation.relation_id, {
        kind: "relations", id: relation.relation_id, body
      });
      relationState.set(relation.relation_id, body);
    }
    entries.push(...relationEntries.values());
    commitBatch(workspaceId, entries, `upsert:${claimId}`);
    inject("after_canonical_commit", { workspaceId, claimId });
    const projection = bestEffortProject(workspaceId);
    return {
      status: "canonical",
      workspace_id: workspaceId,
      claim_id: claimId,
      entity_ids: entities.map((entity) => entity.entity_id),
      relation_ids: relations.map((relation) => relation.relation_id),
      projection
    };
  });

  const tombstoneRecord = (workspaceId, tombstoneType, targetId, recordedAt) => {
    const tombstoneId = `tmb_${hash(canonicalJson({ workspace_id: workspaceId, type: tombstoneType, target_id: targetId }))}`;
    const existing = canonicalState(workspaceId).tombstones.find((item) => item.tombstone_id === tombstoneId);
    if (existing) return existing;
    const body = {
      tombstone_id: tombstoneId,
      tombstone_type: tombstoneType,
      target_id: targetId,
      recorded_at: recordedAt,
      status: "active"
    };
    commitBatch(workspaceId, [{ kind: "tombstones", id: tombstoneId, body }], `authority:${tombstoneId}`);
    return body;
  };

  const requalify = (workspaceId, type, targetId, at) => {
    let state = canonicalState(workspaceId);
    const affectedClaims = state.claims.filter((claim) => (
      type === "episode" ? claim.episode_ids.includes(targetId) : claim.admission.admission_id === targetId
    ));
    const affectedClaimIds = new Set(affectedClaims.map((claim) => claim.claim_id));
    const authorityEntries = [];
    for (const claim of affectedClaims) authorityEntries.push({ kind: "claims", id: claim.claim_id, body: {
      ...claim,
      status: type === "episode" ? "tombstoned" : "revoked",
      authority_removed_at: at
    } });
    for (const relation of state.relations.filter((item) => affectedClaimIds.has(item.claim_id))) {
      authorityEntries.push({ kind: "relations", id: relation.relation_id, body: {
        ...relation,
        valid_to: relation.valid_to && Date.parse(relation.valid_to) < Date.parse(at) ? relation.valid_to : at,
        status: type === "episode" ? "tombstoned" : "revoked",
        authority_removed_at: at
      } });
    }
    commitBatch(workspaceId, authorityEntries, `requalify:${type}:${targetId}`);
    state = canonicalState(workspaceId);
    const entityEntries = [];
    for (const entity of state.entities) {
      const hasAuthority = entity.claim_ids.some((claimId) => {
        const claim = state.claims.find((item) => item.claim_id === claimId);
        return claimAuthorized(claim, state, at);
      });
      if (!hasAuthority && entity.status !== "tombstoned") entityEntries.push({ kind: "entities", id: entity.entity_id, body: {
        ...entity,
        status: "tombstoned",
        authority_removed_at: at
      } });
    }
    commitBatch(workspaceId, entityEntries, `requalify-entities:${type}:${targetId}`);
  };

  const removeAuthority = (workspaceId, type, targetId) => withVaultMutationLock(vault, () => {
    const state = canonicalState(workspaceId);
    const known = type === "episode"
      ? state.claims.some((claim) => claim.episode_ids.includes(targetId))
      : state.claims.some((claim) => claim.admission.admission_id === targetId);
    if (!known) fail(type === "episode" ? "graph_episode_unknown" : "graph_admission_unknown");
    const at = clock();
    tombstoneRecord(workspaceId, type, targetId, at);
    inject("after_authority_removal", { workspaceId, type, targetId });
    requalify(workspaceId, type, targetId, at);
    return {
      status: "authority_removed",
      workspace_id: workspaceId,
      target_id: targetId,
      projection: bestEffortProject(workspaceId)
    };
  });

  const canonicalizePath = (candidate, query, state) => {
    if (
      !candidate || !Array.isArray(candidate.entity_ids) || !Array.isArray(candidate.relation_ids) ||
      candidate.entity_ids.length !== candidate.relation_ids.length + 1 ||
      candidate.relation_ids.length < 1 || candidate.relation_ids.length > query.max_hops ||
      !query.entity_ids.includes(candidate.entity_ids[0])
    ) return null;
    const entities = new Map(state.entities.map((entity) => [entity.entity_id, entity]));
    const claims = new Map(state.claims.map((claim) => [claim.claim_id, claim]));
    const relations = new Map(state.relations.map((relation) => [relation.relation_id, relation]));
    const nodeRecords = candidate.entity_ids.map((id) => entities.get(id));
    if (nodeRecords.some((entity) => !entity || entity.status !== "active")) return null;
    const edges = [];
    for (let index = 0; index < candidate.relation_ids.length; index += 1) {
      const relation = relations.get(candidate.relation_ids[index]);
      if (!relation || relation.workspace_id && relation.workspace_id !== query.workspace_id) return null;
      const claim = claims.get(relation.claim_id);
      if (!claimAuthorized(claim, state, query.as_of)) return null;
      if (
        !query.relation_types.includes(relation.predicate) || !validAt(relation, query.as_of) ||
        relation.admission_id !== claim.admission.admission_id ||
        canonicalJson(relation.evidence_ids) !== canonicalJson(claim.evidence_ids) ||
        canonicalJson(relation.episode_ids) !== canonicalJson(claim.episode_ids)
      ) return null;
      const left = candidate.entity_ids[index];
      const right = candidate.entity_ids[index + 1];
      const outbound = relation.subject_entity_id === left && relation.object_entity_id === right;
      const inbound = relation.object_entity_id === left && relation.subject_entity_id === right;
      if (query.direction === "outbound" && !outbound) return null;
      if (query.direction === "inbound" && !inbound) return null;
      if (query.direction === "both" && !outbound && !inbound) return null;
      edges.push({
        relation_id: relation.relation_id,
        predicate: relation.predicate,
        subject_entity_id: relation.subject_entity_id,
        object_entity_id: relation.object_entity_id,
        valid_from: relation.valid_from,
        valid_to: relation.valid_to,
        event_time: relation.event_time,
        observed_at: relation.observed_at,
        claim_id: claim.claim_id,
        claim_text: claim.claim_text,
        admission_id: relation.admission_id,
        authority_state: relation.authority_state ?? claim.authority?.state ?? "current",
        authority_revision: relation.authority_revision ?? claim.authority?.revision ?? 0,
        evidence_ids: relation.evidence_ids,
        episode_ids: relation.episode_ids
      });
    }
    const material = { workspace_id: query.workspace_id, entity_ids: candidate.entity_ids, edges };
    return {
      path_id: `path_${hash(canonicalJson(material))}`,
      ...material,
      entities: nodeRecords.map((entity) => ({
        entity_id: entity.entity_id,
        canonical_name: entity.canonical_name,
        entity_type: entity.entity_type,
        aliases: entity.aliases
      }))
    };
  };

  const query = (candidate) => {
    const normalized = validateGraphQueryAst(candidate, (relationType) => {
      if (!ontologyRegistry.hasRelationType(relationType)) fail("ontology_relation_type_forbidden");
      return relationType;
    });
    authorizeWorkspace(normalized.workspace_id);
    const state = canonicalState(normalized.workspace_id);
    const authorizedEntityIds = new Set(state.entities.filter((entity) => (
      entity.status === "active" && entity.claim_ids.some((claimId) => (
        claimAuthorized(state.claims.find((claim) => claim.claim_id === claimId), state, normalized.as_of)
      ))
    )).map((entity) => entity.entity_id));
    if (normalized.entity_ids.some((id) => !authorizedEntityIds.has(id))) {
      return { workspace_id: normalized.workspace_id, query: normalized, paths: [], backend: "none" };
    }
    const request = backendRequest("query", normalized.workspace_id, normalized);
    const backend = "deterministic-memory";
    const candidates = engine.query(request);
    if (!candidates || !Array.isArray(candidates.paths)) fail("graph_backend_response_invalid");
    const paths = [];
    const seen = new Set();
    for (const pathCandidate of candidates.paths) {
      const canonical = canonicalizePath(pathCandidate, normalized, state);
      if (!canonical || seen.has(canonical.path_id)) continue;
      seen.add(canonical.path_id);
      paths.push(canonical);
      if (paths.length >= normalized.limit) break;
    }
    return { workspace_id: normalized.workspace_id, query: normalized, paths, backend };
  };

  const queryAsync = async (candidate) => {
    if (!remoteBackend) return query(candidate);
    const normalized = validateGraphQueryAst(candidate, (relationType) => {
      if (!ontologyRegistry.hasRelationType(relationType)) fail("ontology_relation_type_forbidden");
      return relationType;
    });
    authorizeWorkspace(normalized.workspace_id);
    const state = canonicalState(normalized.workspace_id);
    const authorizedEntityIds = new Set(state.entities.filter((entity) => (
      entity.status === "active" && entity.claim_ids.some((claimId) => (
        claimAuthorized(state.claims.find((claim) => claim.claim_id === claimId), state, normalized.as_of)
      ))
    )).map((entity) => entity.entity_id));
    if (normalized.entity_ids.some((id) => !authorizedEntityIds.has(id))) {
      return { workspace_id: normalized.workspace_id, query: normalized, paths: [], backend: "none" };
    }
    const request = backendRequest("query", normalized.workspace_id, normalized);
    const candidates = await remoteBackend.query(request);
    if (!candidates || !Array.isArray(candidates.paths)) fail("graph_backend_response_invalid");
    const paths = [];
    const seen = new Set();
    for (const pathCandidate of candidates.paths) {
      const canonical = canonicalizePath(pathCandidate, normalized, state);
      if (!canonical || seen.has(canonical.path_id)) continue;
      seen.add(canonical.path_id);
      paths.push(canonical);
      if (paths.length >= normalized.limit) break;
    }
    return { workspace_id: normalized.workspace_id, query: normalized, paths, backend: "graphd-neo4j" };
  };

  const rebuildProjection = ({ workspaceId, workspace_id: snakeWorkspaceId } = {}) => {
    const workspace = authorizeWorkspace(workspaceId ?? snakeWorkspaceId);
    return withVaultMutationLock(vault, () => project(workspace, canonicalState(workspace)));
  };

  const queryEvents = ({
    workspaceId,
    workspace_id: snakeWorkspaceId,
    start = null,
    end = null,
    asOf = null,
    as_of: snakeAsOf = null,
    limit = 1_000,
    cursor = 0
  } = {}) => {
    const workspace = authorizeWorkspace(workspaceId ?? snakeWorkspaceId);
    if (start !== null) assertTimestamp(start, "graph_event_window_invalid");
    if (end !== null) assertTimestamp(end, "graph_event_window_invalid");
    if (start && end && Date.parse(start) > Date.parse(end)) fail("graph_event_window_invalid");
    const pageLimit = boundedInteger(limit, 1_000, 1, 10_000, "graph_event_limit_invalid");
    const offset = boundedInteger(cursor, 0, 0, Number.MAX_SAFE_INTEGER, "graph_event_cursor_invalid");
    const at = asOf ?? snakeAsOf ?? clock();
    assertTimestamp(at, "graph_query_time_invalid");
    const state = authorizedState(workspace, at);
    const temporal = state.relations.map((relation) => ({
      relation,
      event_time: relation.event_time ?? legacyObservedEventTime(relation.observed_at)
    }));
    const unresolved = temporal.filter((item) => item.event_time.earliest === null).length;
    const records = temporal.filter((item) => (
      (!start && !end) || eventTimeOverlaps(item.event_time, { start, end })
    )).map((item) => ({ ...item.relation, event_time: item.event_time }))
      .sort((left, right) => {
        const time = Date.parse(left.event_time.earliest) - Date.parse(right.event_time.earliest);
        return time || left.relation_id.localeCompare(right.relation_id);
      });
    const page = records.slice(offset, offset + pageLimit);
    const next = offset + page.length;
    return {
      schema: "supermemory.temporal-events.v1",
      workspace_id: workspace,
      window: { start, end, as_of: at },
      results: page,
      pagination: {
        cursor: offset,
        next_cursor: next < records.length ? next : null,
        complete: next >= records.length,
        total: records.length,
        unresolved_event_time_count: unresolved,
        coverage_complete: next >= records.length && ((!start && !end) || unresolved === 0)
      }
    };
  };

  const migrateTemporalAuthority = ({
    workspaceId,
    workspace_id: snakeWorkspaceId,
    authorityResolver = null
  } = {}) => withVaultMutationLock(vault, () => {
    const workspace = authorizeWorkspace(workspaceId ?? snakeWorkspaceId);
    const state = canonicalState(workspace);
    const resolved = new Map();
    const entries = [];
    for (const claim of [...state.claims].sort((left, right) => (
      left.observed_at.localeCompare(right.observed_at) || left.claim_id.localeCompare(right.claim_id)
    ))) {
      const eventTime = claim.event_time ?? legacyObservedEventTime(claim.observed_at);
      const authorityResult = authorityResolver?.({ ...claim, event_time: eventTime }) ?? null;
      const authority = authorityResult?.state ?? authorityResult ?? claim.authority ?? {
        schema: "supermemory.authority-state.v1",
        claim_id: claim.claim_id,
        state: "current",
        revision: 0,
        policy_version: "legacy-migration-v1",
        valid_from: claim.observed_at,
        valid_until: null,
        supersedes: [],
        evidence_ids: claim.evidence_ids,
        reason_codes: ["legacy_admission_authority"]
      };
      for (const transition of authorityResult?.transitions ?? []) resolved.set(transition.claim_id, transition);
      resolved.set(claim.claim_id, authority);
    }
    for (const claim of state.claims) {
      const authority = resolved.get(claim.claim_id);
      if (!authority) continue;
      const body = { ...claim, event_time: claim.event_time ?? legacyObservedEventTime(claim.observed_at), authority };
      if (canonicalJson(recordPayload(claim)) !== canonicalJson(recordPayload(body))) {
        entries.push({ kind: "claims", id: claim.claim_id, body });
      }
    }
    for (const relation of state.relations) {
      const authority = resolved.get(relation.claim_id) ?? null;
      const body = {
        ...relation,
        event_time: relation.event_time ?? legacyObservedEventTime(relation.observed_at),
        authority_state: authority?.state ?? relation.authority_state ?? "current",
        authority_revision: authority?.revision ?? relation.authority_revision ?? 0
      };
      if (canonicalJson(recordPayload(relation)) !== canonicalJson(recordPayload(body))) {
        entries.push({ kind: "relations", id: relation.relation_id, body });
      }
    }
    const batchId = commitBatch(workspace, entries, "migration:temporal-authority-v1");
    return {
      schema: "supermemory.temporal-authority-migration.v1",
      workspace_id: workspace,
      claims: state.claims.length,
      relations: state.relations.length,
      migrated_records: entries.length,
      batch_id: batchId,
      projection: entries.length > 0 ? bestEffortProject(workspace) : { projected: false, status: "unchanged" }
    };
  });

  const rebuildProjectionAsync = async ({ workspaceId, workspace_id: snakeWorkspaceId } = {}) => {
    const workspace = authorizeWorkspace(workspaceId ?? snakeWorkspaceId);
    if (!remoteBackend) return rebuildProjection({ workspaceId: workspace });
    const before = canonicalState(workspace);
    const material = projectionMaterial(before);
    const projectionHash = contentHash(material);
    const acknowledgement = await remoteBackend.project(backendRequest("replace", workspace, {
      workspace_id: workspace,
      projection_hash: projectionHash,
      records: material
    }));
    if (acknowledgement?.ok !== true || acknowledgement.projection_hash !== projectionHash) {
      fail("graph_backend_response_invalid");
    }
    return withVaultMutationLock(vault, () => {
      if (contentHash(projectionMaterial(canonicalState(workspace))) !== projectionHash) {
        fail("graph_projection_stale");
      }
      const existing = latestRecords(workspace, "checkpoints");
      const checkpointId = `chk_${hash(canonicalJson({ projection_hash: projectionHash, sequence: existing.length + 1 }))}`;
      appendRevision(workspace, "checkpoints", checkpointId, {
        checkpoint_id: checkpointId,
        projection_hash: projectionHash,
        backend: "graphd-neo4j",
        status: "complete",
        projected_at: clock()
      });
      return { projected: true, backend: "graphd-neo4j", projection_hash: projectionHash };
    });
  };

  return {
    root: path.join(vault, graphRootRelative),
    engine,
    upsertEpisodeGraph,
    tombstoneEpisode: ({ workspaceId, workspace_id: snake, episodeId, episode_id: episodeSnake }) => (
      removeAuthority(authorizeWorkspace(workspaceId ?? snake), "episode", assertId(episodeId ?? episodeSnake, EPISODE_ID, "graph_episode_unknown"))
    ),
    revokeAdmission: ({ workspaceId, workspace_id: snake, admissionId, admission_id: admissionSnake }) => (
      removeAuthority(authorizeWorkspace(workspaceId ?? snake), "admission", assertId(admissionId ?? admissionSnake, ADMISSION_ID, "graph_admission_unknown"))
    ),
    query,
    queryAsync,
    queryEvents,
    migrateTemporalAuthority,
    rebuildProjection,
    rebuildProjectionAsync,
    projectionHash: ({ workspaceId, workspace_id: snake }) => contentHash(
      projectionMaterial(canonicalState(authorizeWorkspace(workspaceId ?? snake)))
    ),
    readCanonicalState: ({ workspaceId, workspace_id: snake }) => canonicalState(
      authorizeWorkspace(workspaceId ?? snake)
    ),
    readAuthorizedState: ({ workspaceId, workspace_id: snake, asOf, as_of: snakeAsOf } = {}) => {
      const workspace = authorizeWorkspace(workspaceId ?? snake);
      const at = asOf ?? snakeAsOf ?? clock();
      assertTimestamp(at, "graph_query_time_invalid");
      return authorizedState(workspace, at);
    },
    resolveAuthorizedClaims: ({ workspaceId, workspace_id: snake, claimIds, claim_ids: snakeIds, asOf, as_of: snakeAsOf } = {}) => {
      const workspace = authorizeWorkspace(workspaceId ?? snake);
      const ids = uniqueIds(claimIds ?? snakeIds, CLAIM_ID, "graph_claim_id_invalid");
      const state = authorizedState(workspace, asOf ?? snakeAsOf ?? clock());
      const byId = new Map(state.claims.map((claim) => [claim.claim_id, claim]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    }
  };
}
