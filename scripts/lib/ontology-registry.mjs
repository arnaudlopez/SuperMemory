const ENTITY_TYPES = [
  "Person", "Organization", "Project", "Workspace", "Session", "Agent",
  "Document", "File", "Tool", "Requirement", "Decision", "Preference",
  "Procedure", "Event", "Error", "Topic", "Claim", "Evidence"
];

const RELATION_TYPES = [
  "MENTIONS", "ABOUT", "ASSERTS", "SUPPORTS", "CONTRADICTS", "SUPERSEDES",
  "DERIVED_FROM", "OCCURRED_IN", "DEPENDS_ON", "CAUSES", "MODIFIES",
  "DECIDED_BY", "PREFERS", "AFFECTS", "PART_OF", "RELATED_TO"
];

export const ONTOLOGY_STATES = Object.freeze([
  "core", "shadow", "active", "deprecated", "quarantined", "rejected"
]);
const ADDITIVE_KINDS = new Set(["add_entity_type", "add_relation_type"]);
const DESTRUCTIVE_KINDS = new Set(["rename", "merge", "delete", "narrow"]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code);
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.trim().length === 0) fail(code);
  return value;
}

function stringArray(value, code) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) fail(code);
  return [...new Set(value)].sort();
}

function timestamp(value, code, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(code);
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashId(value) {
  return `sha256:${hash(value)}`;
}

function sameStringSet(left, right) {
  return canonicalJson(stringArray(left, "ontology_support_attestation_invalid")) ===
    canonicalJson(stringArray(right, "ontology_support_attestation_invalid"));
}

function normalizeRetrievalCorpus(value) {
  if (value === null || value === undefined) return null;
  if (
    value?.schema !== "supermemory.memory-improve-corpus.v1" ||
    !Number.isSafeInteger(value.version) || value.version < 1 ||
    !Array.isArray(value.cases) || value.cases.length === 0
  ) fail("ontology_evaluation_corpus_invalid");
  const seen = new Set();
  const allowedOperations = new Set([
    "candidate_type_retrieval", "core_entity_retrieval", "core_relation_retrieval"
  ]);
  for (const item of value.cases) {
    if (
      typeof item?.id !== "string" || !item.id || seen.has(item.id) ||
      typeof item.scenario !== "string" || !item.scenario ||
      !allowedOperations.has(item.evaluation?.operation)
    ) fail("ontology_evaluation_corpus_invalid");
    if (
      item.evaluation.operation !== "candidate_type_retrieval" &&
      (typeof item.evaluation.query !== "string" || !item.evaluation.query)
    ) fail("ontology_evaluation_corpus_invalid");
    seen.add(item.id);
  }
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

export function createOntologySupportAttestation({ workspaceId, workspace_id: snakeWorkspace, claim, proposal } = {}) {
  const workspace = assertWorkspace(workspaceId ?? snakeWorkspace);
  const kind = requiredString(proposal?.kind, "ontology_support_attestation_invalid");
  const name = requiredString(proposal?.name, "ontology_support_attestation_invalid");
  const claimId = requiredString(claim?.claim_id, "ontology_support_attestation_invalid");
  const admission = claim?.admission;
  const verifier = admission?.verifier;
  const extractor = admission?.extractor;
  if (
    claim?.workspace_id !== workspace || !/^clm_[0-9a-f]{64}$/.test(claimId) ||
    !admission?.admission_id || verifier?.independent !== true ||
    typeof verifier.provider !== "string" || !verifier.provider ||
    typeof verifier.model !== "string" || !verifier.model ||
    typeof verifier.prompt_version !== "string" || !verifier.prompt_version ||
    (verifier.model === extractor?.model && verifier.prompt_version === extractor?.prompt_version)
  ) fail("ontology_support_attestation_invalid");
  const unsigned = {
    schema: "supermemory.ontology-support-attestation.v1",
    workspace_id: workspace,
    claim_id: claimId,
    episode_ids: stringArray(claim.episode_ids, "ontology_support_attestation_invalid"),
    evidence_ids: stringArray(claim.evidence_ids, "ontology_support_attestation_invalid"),
    admission_id: admission.admission_id,
    proposal: { kind, name },
    verifier: {
      provider: verifier.provider,
      model: verifier.model,
      prompt_version: verifier.prompt_version,
      independent: true
    }
  };
  return deepFreeze({ ...unsigned, integrity_hash: hashId(canonicalJson(unsigned)) });
}

function assertWorkspace(value) {
  if (typeof value !== "string" || !/^ws_[A-Za-z0-9._:-]{8,}$/.test(value)) fail("ontology_scope_invalid");
  return value;
}

function assertKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) fail("ontology_encryption_key_invalid");
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    if (!/^[A-Za-z0-9._:-]+$/.test(segment)) fail("ontology_path_invalid");
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("ontology_path_invalid");
    } else fs.mkdirSync(next, { mode: 0o700 });
    current = fs.realpathSync(next);
    const remainder = path.relative(root, current);
    if (remainder.startsWith("..") || path.isAbsolute(remainder)) fail("ontology_scope_invalid");
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

export const CORE_ONTOLOGY_V1 = deepFreeze({
  schema: "supermemory.core-ontology.v1",
  version: 1,
  state: "core",
  entity_types: [...ENTITY_TYPES],
  relation_types: [...RELATION_TYPES]
});

function validateCoreEntityShape(value, allowedTypes) {
  exactFields(value, new Set([
    "entity_id", "binding_id", "canonical_name", "entity_type", "aliases"
  ]), "ontology_entity_shape_invalid");
  requiredString(value.entity_id, "ontology_entity_id_invalid");
  requiredString(value.binding_id, "ontology_entity_binding_invalid");
  requiredString(value.canonical_name, "ontology_entity_name_invalid");
  if (!allowedTypes.includes(value.entity_type)) fail("ontology_entity_type_forbidden");
  return {
    entity_id: value.entity_id,
    binding_id: value.binding_id,
    canonical_name: value.canonical_name,
    entity_type: value.entity_type,
    aliases: stringArray(value.aliases ?? [], "ontology_entity_aliases_invalid")
  };
}

export function validateCoreEntity(value) {
  return validateCoreEntityShape(value, ENTITY_TYPES);
}

function validateCoreRelationShape(value, allowedTypes) {
  exactFields(value, new Set([
    "relation_id", "relation_key", "subject_entity_id", "predicate", "object_entity_id",
    "valid_from", "valid_to", "supersedes_relation_ids", "contradicts_relation_ids"
  ]), "ontology_relation_shape_invalid");
  requiredString(value.relation_id, "ontology_relation_id_invalid");
  requiredString(value.relation_key, "ontology_relation_key_invalid");
  requiredString(value.subject_entity_id, "ontology_relation_subject_invalid");
  requiredString(value.object_entity_id, "ontology_relation_object_invalid");
  if (!allowedTypes.includes(value.predicate)) fail("ontology_relation_type_forbidden");
  const validFrom = timestamp(value.valid_from, "ontology_relation_time_invalid");
  const validTo = timestamp(value.valid_to ?? null, "ontology_relation_time_invalid", true);
  if (validTo && Date.parse(validTo) <= Date.parse(validFrom)) fail("ontology_relation_window_invalid");
  return {
    relation_id: value.relation_id,
    relation_key: value.relation_key,
    subject_entity_id: value.subject_entity_id,
    predicate: value.predicate,
    object_entity_id: value.object_entity_id,
    valid_from: validFrom,
    valid_to: validTo,
    supersedes_relation_ids: stringArray(
      value.supersedes_relation_ids ?? [],
      "ontology_relation_supersedes_invalid"
    ),
    contradicts_relation_ids: stringArray(
      value.contradicts_relation_ids ?? [],
      "ontology_relation_contradicts_invalid"
    )
  };
}

export function validateCoreRelation(value) {
  return validateCoreRelationShape(value, RELATION_TYPES);
}

export function assertCoreEntityType(value) {
  if (!ENTITY_TYPES.includes(value)) fail("ontology_entity_type_forbidden");
  return value;
}

export function assertCoreRelationType(value) {
  if (!RELATION_TYPES.includes(value)) fail("ontology_relation_type_forbidden");
  return value;
}

export function createOntologyRegistry() {
  return Object.freeze({
    schema: CORE_ONTOLOGY_V1.schema,
    version: CORE_ONTOLOGY_V1.version,
    ontology: CORE_ONTOLOGY_V1,
    validateEntity: validateCoreEntity,
    validateRelation: validateCoreRelation,
    hasEntityType: (value) => ENTITY_TYPES.includes(value),
    hasRelationType: (value) => RELATION_TYPES.includes(value)
  });
}

export function createWorkspaceOntologyRegistry({
  vaultRoot,
  encryptionKey,
  workspaceId: boundWorkspaceId,
  claimAuthorityResolver = null,
  retrievalEvaluator = null,
  retrievalEvaluatorPin = null,
  retrievalCorpus = null,
  minimumEvaluationDelta = 0.01,
  clock = () => new Date().toISOString()
} = {}) {
  assertKey(encryptionKey);
  const workspaceId = assertWorkspace(boundWorkspaceId);
  const evaluationCorpus = normalizeRetrievalCorpus(retrievalCorpus);
  const evaluationCasesHash = evaluationCorpus ? hashId(canonicalJson(evaluationCorpus)) : null;
  if (!Number.isFinite(minimumEvaluationDelta) || minimumEvaluationDelta <= 0 || minimumEvaluationDelta > 1) {
    fail("ontology_evaluation_delta_invalid");
  }
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const relativeRoot = `20_professional/memory-fabric/${workspaceId}/ontology`;
  const root = ensureDirectory(vault, relativeRoot);
  const aad = (kind, id) => `supermemory.ontology-artifact.v1.${workspaceId}.${kind}.${id}`;
  const artifactPath = (kind, id, create = false) => {
    const directory = create ? ensureDirectory(vault, `${relativeRoot}/${kind}`) : path.join(root, kind);
    return path.join(directory, `${id}.json.aead`);
  };
  const readArtifact = (kind, id) => {
    try {
      const value = openJsonAead(JSON.parse(fs.readFileSync(artifactPath(kind, id), "utf8")), {
        encryptionKey,
        expectedAad: aad(kind, id)
      });
      if (value?.workspace_id !== workspaceId || value.artifact_id !== id) fail("ontology_artifact_corrupt");
      return value;
    } catch (error) {
      if (error?.code === "ontology_artifact_corrupt") throw error;
      fail("ontology_artifact_corrupt");
    }
  };
  const writeArtifact = (kind, id, body) => {
    const filePath = artifactPath(kind, id, true);
    if (fs.existsSync(filePath)) {
      const existing = readArtifact(kind, id);
      if (canonicalJson(existing) !== canonicalJson(body)) fail("ontology_artifact_collision");
      return existing;
    }
    atomicWrite(filePath, `${JSON.stringify(sealJsonAead(body, { encryptionKey, aad: aad(kind, id) }))}\n`);
    const reopened = readArtifact(kind, id);
    if (canonicalJson(reopened) !== canonicalJson(body)) fail("ontology_artifact_corrupt");
    return reopened;
  };
  const listArtifacts = (kind) => {
    const directory = path.join(root, kind);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json.aead")) {
        fail("ontology_artifact_corrupt");
      }
      return readArtifact(kind, entry.name.slice(0, -10));
    }).sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  };
  const coreMaterial = {
    workspace_id: workspaceId,
    parent_version_id: null,
    state: "core",
    entity_types: [...ENTITY_TYPES],
    relation_types: [...RELATION_TYPES]
  };
  const coreVersionId = `ontv_${hash(canonicalJson(coreMaterial))}`;
  writeArtifact("versions", coreVersionId, {
    schema: "supermemory.ontology-version.v1",
    artifact_id: coreVersionId,
    version_id: coreVersionId,
    ...coreMaterial,
    created_at: "1970-01-01T00:00:00.000Z"
  });

  const changeState = (changeId) => {
    const states = listArtifacts("changes").filter((item) => item.change_id === changeId);
    return states.sort((left, right) => left.sequence - right.sequence || left.artifact_id.localeCompare(right.artifact_id)).at(-1) ?? null;
  };
  const activeVersion = () => {
    const activeChanges = new Set(listArtifacts("changes").filter((item) => item.state === "active").map((item) => item.version_id));
    const active = listArtifacts("versions").filter((item) => item.state === "active" && activeChanges.has(item.version_id));
    const parents = new Set(active.map((item) => item.parent_version_id));
    const leaves = active.filter((item) => !parents.has(item.version_id));
    if (leaves.length > 1) fail("ontology_version_fork");
    return leaves[0] ?? readArtifact("versions", coreVersionId);
  };
  const resolveAuthoritativeClaim = (claimId) => {
    if (typeof claimAuthorityResolver !== "function") fail("ontology_authority_resolver_required");
    const asOf = clock();
    const claims = claimAuthorityResolver({ workspaceId, claimIds: [claimId], asOf });
    if (!Array.isArray(claims) || claims.length !== 1 || claims[0]?.claim_id !== claimId) {
      fail("ontology_support_invalid");
    }
    const claim = claims[0];
    if (
      claim.workspace_id !== workspaceId || claim.status !== "active" ||
      !Array.isArray(claim.episode_ids) || claim.episode_ids.length === 0 ||
      !Array.isArray(claim.evidence_ids) || claim.evidence_ids.length === 0 ||
      !verifyAdmissionDecision(claim.admission, {
        candidateId: claim.claim_id,
        workspaceId,
        evidenceIds: claim.evidence_ids
      }) || !["auto_activate", "activate_ttl"].includes(claim.admission.decision) ||
      (claim.admission.expires_at && Date.parse(claim.admission.expires_at) <= Date.parse(asOf))
    ) fail("ontology_support_invalid");
    return claim;
  };
  const verifySupportAttestation = (value, claim, proposal) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("ontology_support_attestation_invalid");
    }
    const expected = createOntologySupportAttestation({ workspaceId, claim, proposal });
    if (
      value.schema !== expected.schema || value.workspace_id !== expected.workspace_id ||
      value.claim_id !== expected.claim_id || value.admission_id !== expected.admission_id ||
      value.proposal?.kind !== expected.proposal.kind || value.proposal?.name !== expected.proposal.name ||
      !sameStringSet(value.episode_ids, expected.episode_ids) ||
      !sameStringSet(value.evidence_ids, expected.evidence_ids) ||
      canonicalJson(value.verifier) !== canonicalJson(expected.verifier) ||
      value.integrity_hash !== expected.integrity_hash || canonicalJson(value) !== canonicalJson(expected)
    ) fail("ontology_support_attestation_invalid");
    return expected;
  };
  const proposeChange = (input = {}) => withVaultMutationLock(vault, () => {
    exactFields(input, new Set([
      "workspace_id", "workspaceId", "kind", "name", "sourceClaimId", "source_claim_id",
      "supportAttestation", "support_attestation"
    ]), "ontology_change_input_invalid");
    if (input.workspace_id && input.workspace_id !== workspaceId) fail("ontology_scope_invalid");
    if (input.workspaceId && input.workspaceId !== workspaceId) fail("ontology_scope_invalid");
    const kind = requiredString(input.kind, "ontology_change_kind_invalid");
    if (!ADDITIVE_KINDS.has(kind) && !DESTRUCTIVE_KINDS.has(kind)) fail("ontology_change_kind_invalid");
    const name = requiredString(input.name, "ontology_change_name_invalid");
    if (!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name)) fail("ontology_change_name_invalid");
    const sourceClaimId = requiredString(
      input.sourceClaimId ?? input.source_claim_id,
      "ontology_source_claim_required"
    );
    if (!/^clm_[0-9a-f]{64}$/.test(sourceClaimId)) fail("ontology_source_claim_invalid");
    const authoritativeClaim = resolveAuthoritativeClaim(sourceClaimId);
    const attestation = verifySupportAttestation(
      input.supportAttestation ?? input.support_attestation,
      authoritativeClaim,
      { kind, name }
    );
    const base = activeVersion();
    const alreadyActive = listArtifacts("changes").find((item) => (
      item.state === "active" && item.kind === kind && item.name.toLowerCase() === name.toLowerCase()
    ));
    if (alreadyActive) return alreadyActive;
    const changeId = `ontc_${hash(canonicalJson({ workspace_id: workspaceId, base_version_id: base.version_id, kind, name }))}`;
    const existing = changeState(changeId);
    if (existing?.state === "active" || existing?.source_claim_ids?.includes(sourceClaimId)) return existing;
    const state = ADDITIVE_KINDS.has(kind) ? "shadow" : "quarantined";
    const sourceClaimIds = [...new Set([...(existing?.source_claim_ids ?? []), sourceClaimId])].sort();
    const supportAttestations = [...(existing?.support_attestations ?? []), attestation]
      .filter((item, index, items) => items.findIndex((candidate) => candidate.claim_id === item.claim_id) === index)
      .sort((left, right) => left.claim_id.localeCompare(right.claim_id));
    const sequence = (existing?.sequence ?? 0) + 1;
    const artifactId = `onts_${hash(canonicalJson({
      change_id: changeId, state, sequence, source_claim_ids: sourceClaimIds,
      support_attestation_hashes: supportAttestations.map((item) => item.integrity_hash)
    }))}`;
    return writeArtifact("changes", artifactId, {
      schema: "supermemory.ontology-change.v1",
      artifact_id: artifactId,
      change_id: changeId,
      workspace_id: workspaceId,
      base_version_id: base.version_id,
      kind,
      name,
      state,
      sequence,
      source_claim_ids: sourceClaimIds,
      support_attestations: supportAttestations,
      reason_codes: state === "quarantined" ? ["destructive_change"] : [],
      version_id: null,
      recorded_at: existing?.recorded_at ?? clock()
    });
  });
  const builtinEvaluation = (change, base) => {
    if (!evaluationCorpus) fail("ontology_evaluation_corpus_required");
    const candidateEntities = change.kind === "add_entity_type"
      ? [...base.entity_types, change.name]
      : [...base.entity_types];
    const candidateRelations = change.kind === "add_relation_type"
      ? [...base.relation_types, change.name]
      : [...base.relation_types];
    const score = (item, candidate) => {
      if (item.evaluation.operation === "candidate_type_retrieval") {
        const values = change.kind === "add_entity_type"
          ? (candidate ? candidateEntities : base.entity_types)
          : (candidate ? candidateRelations : base.relation_types);
        return values.includes(change.name) ? 1 : 0;
      }
      if (item.evaluation.operation === "core_entity_retrieval") {
        return (candidate ? candidateEntities : base.entity_types).includes(item.evaluation.query) ? 1 : 0;
      }
      if (item.evaluation.operation === "core_relation_retrieval") {
        return (candidate ? candidateRelations : base.relation_types).includes(item.evaluation.query) ? 1 : 0;
      }
      fail("ontology_evaluation_corpus_invalid");
    };
    const caseResults = evaluationCorpus.cases.map((item) => ({
      case_id: item.id,
      baseline_score: score(item, false),
      candidate_score: score(item, true)
    }));
    return {
      schema: "supermemory.ontology-evaluation.v1",
      evaluator_version: `builtin-retrieval-corpus-v${evaluationCorpus.version}`,
      cases_hash: evaluationCasesHash,
      case_results: caseResults
    };
  };
  const normalizeEvaluation = (raw) => {
    if (!evaluationCorpus) fail("ontology_evaluation_corpus_required");
    if (
      raw?.schema !== "supermemory.ontology-evaluation.v1" ||
      typeof raw.evaluator_version !== "string" || !raw.evaluator_version ||
      raw.cases_hash !== evaluationCasesHash || !Array.isArray(raw.case_results)
    ) fail("ontology_evaluation_failed");
    const expectedIds = evaluationCorpus.cases.map((item) => item.id);
    if (
      raw.case_results.length !== expectedIds.length ||
      raw.case_results.some((item, index) => (
        item?.case_id !== expectedIds[index] ||
        !Number.isFinite(item.baseline_score) || !Number.isFinite(item.candidate_score) ||
        item.baseline_score < 0 || item.baseline_score > 1 ||
        item.candidate_score < 0 || item.candidate_score > 1
      ))
    ) fail("ontology_evaluation_failed");
    const baseline = raw.case_results.reduce((sum, item) => sum + item.baseline_score, 0) / expectedIds.length;
    const candidate = raw.case_results.reduce((sum, item) => sum + item.candidate_score, 0) / expectedIds.length;
    const regressions = raw.case_results.filter((item) => item.candidate_score < item.baseline_score).length;
    if (
      (raw.baseline !== undefined && raw.baseline !== baseline) ||
      (raw.candidate !== undefined && raw.candidate !== candidate) ||
      (raw.regressions !== undefined && raw.regressions !== regressions) ||
      regressions !== 0 || candidate - baseline < minimumEvaluationDelta
    ) fail("ontology_evaluation_failed");
    return {
      schema: raw.schema,
      evaluator_version: raw.evaluator_version,
      cases_hash: raw.cases_hash,
      corpus_version: evaluationCorpus.version,
      case_results: raw.case_results.map((item) => ({ ...item })),
      baseline,
      candidate,
      delta: candidate - baseline,
      minimum_delta: minimumEvaluationDelta,
      regressions
    };
  };
  const evaluateChange = (change, base, supportClaimIds) => {
    let result;
    if (retrievalEvaluator) {
      if (
        typeof retrievalEvaluator.evaluate !== "function" || !retrievalEvaluatorPin ||
        retrievalEvaluator.identity?.provider !== retrievalEvaluatorPin.provider ||
        retrievalEvaluator.identity?.version !== retrievalEvaluatorPin.version ||
        retrievalEvaluatorPin.cases_hash !== evaluationCasesHash
      ) {
        fail("ontology_evaluator_untrusted");
      }
      result = retrievalEvaluator.evaluate({
        workspaceId,
        change: { change_id: change.change_id, kind: change.kind, name: change.name },
        baseVersion: base,
        supportClaimIds,
        corpus: evaluationCorpus,
        casesHash: evaluationCasesHash
      });
    } else {
      result = builtinEvaluation(change, base);
    }
    const unsigned = normalizeEvaluation(result);
    delete unsigned.integrity_hash;
    const integrityHash = hashId(canonicalJson(unsigned));
    if (result.integrity_hash && result.integrity_hash !== integrityHash) fail("ontology_evaluation_corrupt");
    const evaluationId = `onte_${hash(canonicalJson({ workspace_id: workspaceId, change_id: change.change_id, evaluation: unsigned }))}`;
    return writeArtifact("evaluations", evaluationId, {
      artifact_id: evaluationId,
      evaluation_id: evaluationId,
      workspace_id: workspaceId,
      change_id: change.change_id,
      ...unsigned,
      integrity_hash: integrityHash
    });
  };
  const promoteChange = (input = {}) => withVaultMutationLock(vault, () => {
    const extra = Object.keys(input).filter((key) => !["changeId", "change_id"].includes(key));
    if (extra.length > 0) fail("ontology_support_override_forbidden");
    const { changeId, change_id: snakeId } = input;
    const id = changeId ?? snakeId;
    const change = changeState(id);
    if (!change) fail("ontology_change_unknown");
    if (change.state === "active") return { change, version: activeVersion() };
    if (change.state !== "shadow" || !ADDITIVE_KINDS.has(change.kind)) fail("ontology_change_not_promotable");
    const requestedIds = [...new Set(change.source_claim_ids ?? [])].sort();
    if (requestedIds.length < 3 || requestedIds.some((claimId) => !/^clm_[0-9a-f]{64}$/.test(claimId))) {
      fail("ontology_support_insufficient");
    }
    const attestations = change.support_attestations ?? [];
    if (
      attestations.length !== requestedIds.length ||
      attestations.some((item, index) => item.claim_id !== requestedIds[index])
    ) fail("ontology_support_invalid");
    const claims = requestedIds.map((claimId) => resolveAuthoritativeClaim(claimId));
    const claimIds = new Set();
    const authorityEpisodes = new Set();
    const authorityEvidence = new Set();
    for (const [index, claim] of claims.entries()) {
      verifySupportAttestation(attestations[index], claim, { kind: change.kind, name: change.name });
      claimIds.add(claim.claim_id);
      if (
        claim.episode_ids.some((id) => authorityEpisodes.has(id)) ||
        claim.evidence_ids.some((id) => authorityEvidence.has(id))
      ) fail("ontology_support_not_independent");
      for (const id of claim.episode_ids) authorityEpisodes.add(id);
      for (const id of claim.evidence_ids) authorityEvidence.add(id);
    }
    if (
      claimIds.size < 3 || authorityEpisodes.size < 3 || authorityEvidence.size < 3 ||
      requestedIds.some((claimId) => !claimIds.has(claimId))
    ) fail("ontology_support_insufficient");
    const base = activeVersion();
    const existingNames = new Set([...base.entity_types, ...base.relation_types].map((item) => item.toLowerCase()));
    if (existingNames.has(change.name.toLowerCase())) fail("ontology_collision");
    const evaluation = evaluateChange(change, base, requestedIds);
    const gates = {
      structural_compatible: ADDITIVE_KINDS.has(change.kind) && /^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(change.name),
      backward_compatible: ADDITIVE_KINDS.has(change.kind),
      scope_valid: claims.every((claim) => claim.workspace_id === workspaceId),
      collision_free: !existingNames.has(change.name.toLowerCase()),
      evaluation_id: evaluation.evaluation_id,
      evaluation_hash: evaluation.integrity_hash
    };
    if (!gates.structural_compatible || !gates.backward_compatible || !gates.scope_valid || !gates.collision_free) {
      fail("ontology_promotion_gates_failed");
    }
    const versionMaterial = {
      workspace_id: workspaceId,
      parent_version_id: base.version_id,
      change_id: change.change_id,
      entity_types: change.kind === "add_entity_type" ? [...base.entity_types, change.name].sort() : base.entity_types,
      relation_types: change.kind === "add_relation_type" ? [...base.relation_types, change.name].sort() : base.relation_types,
      support_claim_ids: [...claimIds].sort(),
      gates
    };
    const versionId = `ontv_${hash(canonicalJson(versionMaterial))}`;
    const version = writeArtifact("versions", versionId, {
      schema: "supermemory.ontology-version.v1",
      artifact_id: versionId,
      version_id: versionId,
      state: "active",
      ...versionMaterial,
      created_at: change.recorded_at
    });
    const artifactId = `onts_${hash(canonicalJson({ change_id: id, state: "active", version_id: versionId }))}`;
    const activated = writeArtifact("changes", artifactId, {
      ...change,
      artifact_id: artifactId,
      state: "active",
      sequence: change.sequence + 1,
      version_id: versionId,
      support_claim_ids: [...claimIds].sort(),
      gates,
      recorded_at: change.recorded_at
    });
    return { change: activated, version };
  });
  const reevaluateShadows = () => {
    const latest = new Map();
    for (const change of listArtifacts("changes")) {
      const current = latest.get(change.change_id);
      if (!current || change.sequence > current.sequence) latest.set(change.change_id, change);
    }
    const results = [];
    for (const change of [...latest.values()].filter((item) => item.state === "shadow")) {
      try {
        results.push({ change_id: change.change_id, status: "active", result: promoteChange({ changeId: change.change_id }) });
      } catch (error) {
        if ([
          "ontology_support_insufficient", "ontology_support_invalid", "ontology_evaluation_failed",
          "ontology_promotion_gates_failed", "ontology_collision"
        ].includes(error?.code)) {
          results.push({ change_id: change.change_id, status: "shadow", reason: error.code });
        } else throw error;
      }
    }
    return results;
  };
  const validateEntity = (value) => {
    const version = activeVersion();
    const normalized = validateCoreEntityShape(value, version.entity_types);
    return { ...normalized, ontology_version: version.version_id };
  };
  const validateRelation = (value) => {
    const version = activeVersion();
    const normalized = validateCoreRelationShape(value, version.relation_types);
    return { ...normalized, ontology_version: version.version_id };
  };
  return Object.freeze({
    schema: "supermemory.ontology-registry.v1",
    workspaceId,
    root,
    proposeChange,
    promoteChange,
    reevaluateShadows,
    activeVersion,
    listChanges: () => listArtifacts("changes"),
    listVersions: () => listArtifacts("versions"),
    validateEntity,
    validateRelation,
    hasEntityType: (value) => activeVersion().entity_types.includes(value),
    hasRelationType: (value) => activeVersion().relation_types.includes(value)
  });
}
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import { verifyAdmissionDecision } from "./memory-admission-policy.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";
