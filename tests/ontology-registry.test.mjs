import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, openJsonAead } from "../scripts/lib/codex-redaction.mjs";
import { createMemoryAdmissionPolicy } from "../scripts/lib/memory-admission-policy.mjs";
import {
  CORE_ONTOLOGY_V1,
  createOntologySupportAttestation,
  createOntologyRegistry,
  createWorkspaceOntologyRegistry,
  validateCoreEntity,
  validateCoreRelation
} from "../scripts/lib/ontology-registry.mjs";

const WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789ac";
const KEY = Buffer.alloc(32, 0x62);
const RETRIEVAL_CORPUS = JSON.parse(fs.readFileSync("tests/fixtures/memory-improve-worker/corpus.v1.json", "utf8"));

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function supportAttestation(claim, { kind, name, integrity = true } = {}) {
  const attestation = createOntologySupportAttestation({
    workspaceId: WORKSPACE,
    claim,
    proposal: { kind, name }
  });
  return integrity ? attestation : { ...attestation, integrity_hash: sha256("forged") };
}

function supportClaim(number, { temporary = false, evidenceId: evidenceOverride = null, episodeId: episodeOverride = null } = {}) {
  const claimId = `clm_${String(number).padStart(64, "0")}`;
  const evidenceId = evidenceOverride ?? `wev_018f1234-5678-7abc-8def-${String(number).padStart(12, "0")}`;
  const episodeId = episodeOverride ?? `epi_018f1234-5678-7abc-8def-${String(number).padStart(12, "0")}`;
  const admission = createMemoryAdmissionPolicy({ clock: () => "2026-08-04T10:00:00.000Z" }).evaluate({
    candidate: {
      candidate_id: claimId,
      workspace_id: WORKSPACE,
      evidence_ids: [evidenceId],
      sensitivity: "standard",
      extractor: { provider: "fixture", model: "extractor", prompt_version: "v1" }
    },
    verification: {
      status: "verified",
      verifier: { provider: "fixture", model: "verifier", prompt_version: "v2", independent: true },
      signals: {
        evidence_entailment: 0.99, source_trust: 0.99, extraction_agreement: 0.99,
        temporal_consistency: 0.99, scope_valid: true, ontology_compatible: true, temporary
      }
    }
  }).admission;
  return {
    workspace_id: WORKSPACE,
    claim_id: claimId,
    status: "active",
    evidence_ids: [evidenceId],
    episode_ids: [episodeId],
    admission
  };
}

test("core ontology v1 is deeply immutable and contains only approved types", () => {
  const registry = createOntologyRegistry();
  assert.equal(registry.version, 1);
  assert.equal(Object.isFrozen(CORE_ONTOLOGY_V1), true);
  assert.equal(Object.isFrozen(CORE_ONTOLOGY_V1.entity_types), true);
  assert.deepEqual(CORE_ONTOLOGY_V1.entity_types, [
    "Person", "Organization", "Project", "Workspace", "Session", "Agent",
    "Document", "File", "Tool", "Requirement", "Decision", "Preference",
    "Procedure", "Event", "Error", "Topic", "Claim", "Evidence"
  ]);
  assert.equal(registry.hasRelationType("DEPENDS_ON"), true);
  assert.equal(registry.hasRelationType("LEARNS_FROM"), false);
  assert.equal("activateExtension" in registry, false);
  assert.throws(() => CORE_ONTOLOGY_V1.entity_types.push("Learned"), TypeError);
});

test("shape validators reject unknown fields, forbidden types, and invalid windows", () => {
  assert.deepEqual(validateCoreEntity({
    entity_id: "ent_x", binding_id: "project:x", canonical_name: "X",
    entity_type: "Project", aliases: ["x", "x"]
  }).aliases, ["x"]);
  assert.throws(() => validateCoreEntity({
    entity_id: "ent_x", binding_id: "x", canonical_name: "X",
    entity_type: "Learned", aliases: []
  }), /ontology_entity_type_forbidden/);
  assert.throws(() => validateCoreEntity({
    entity_id: "ent_x", binding_id: "x", canonical_name: "X",
    entity_type: "Project", aliases: [], shadow: true
  }), /ontology_entity_shape_invalid/);
  assert.throws(() => validateCoreRelation({
    relation_id: "rel_x", relation_key: "x", subject_entity_id: "ent_a", predicate: "RAW_EDGE",
    object_entity_id: "ent_b", valid_from: "2026-01-01T00:00:00.000Z", valid_to: null
  }), /ontology_relation_type_forbidden/);
  assert.throws(() => validateCoreRelation({
    relation_id: "rel_x", relation_key: "x", subject_entity_id: "ent_a", predicate: "DEPENDS_ON",
    object_entity_id: "ent_b", valid_from: "2026-02-01T00:00:00.000Z",
    valid_to: "2026-01-01T00:00:00.000Z"
  }), /ontology_relation_window_invalid/);
});

test("GraphD v2 contract forbids raw Cypher and has no runtime fallback", () => {
  const contract = JSON.parse(fs.readFileSync("services/supermemory-graphd/contract.v2.json", "utf8"));
  assert.equal(contract.schema, "supermemory.graphd-contract.v2");
  assert.equal(contract.transport.authentication, "workspace-scoped-bearer");
  assert.equal(contract.transport.raw_cypher_accepted, false);
  assert.equal(contract.operations.query.default_max_hops, 3);
  assert.equal(contract.operations.query.hard_max_hops, 5);
  assert.deepEqual(contract.operations.replace.acknowledgement_required, ["ok", "projection_hash"]);
  assert.equal(contract.operations.replace.projection_hash_match, "exact");
  assert.equal(contract.fallback.primary, "graphd-neo4j");
  assert.equal(contract.fallback.runtime_fallback, null);
  assert.equal(contract.authority.backend_may_decide.length, 0);
});

test("KG-AC10/11: workspace ontology promotion is encrypted, additive, gated, immutable, and destructive-safe", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ontology-registry-"));
  const vault = path.join(temporary, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const claims = [supportClaim(1), supportClaim(2), supportClaim(3), supportClaim(4)];
  const claimsById = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const authorized = new Set(claims.map((claim) => claim.claim_id));
  const registry = createWorkspaceOntologyRegistry({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    claimAuthorityResolver: ({ workspaceId, claimIds }) => workspaceId === WORKSPACE
      ? claimIds.filter((id) => authorized.has(id)).map((id) => claimsById.get(id))
      : [],
    retrievalCorpus: RETRIEVAL_CORPUS,
    clock: () => "2026-08-04T10:00:00.000Z"
  });
  const customerRisk = { kind: "add_entity_type", name: "CustomerRisk" };
  let shadow = registry.proposeChange({
    ...customerRisk,
    sourceClaimId: claims[0].claim_id,
    supportAttestation: supportAttestation(claims[0], customerRisk)
  });
  assert.equal(shadow.state, "shadow");
  assert.equal(registry.hasEntityType("CustomerRisk"), false);
  assert.throws(() => registry.promoteChange({
    changeId: shadow.change_id,
    supportClaims: [supportClaim(1), supportClaim(2), supportClaim(3)],
    gates: { structural_compatible: true, evaluation: { baseline: 0, candidate: 1 } }
  }), /ontology_support_override_forbidden/);
  assert.equal(registry.hasEntityType("CustomerRisk"), false);
  for (const claim of claims.slice(1, 3)) shadow = registry.proposeChange({
    ...customerRisk,
    sourceClaimId: claim.claim_id,
    supportAttestation: supportAttestation(claim, customerRisk)
  });
  const promoted = registry.promoteChange({ changeId: shadow.change_id });
  assert.equal(promoted.change.state, "active");
  assert.equal(registry.hasEntityType("CustomerRisk"), true);
  assert.equal(registry.promoteChange({ changeId: shadow.change_id }).version.version_id, promoted.version.version_id);
  assert.equal(registry.listVersions().find((item) => item.state === "core").entity_types.includes("CustomerRisk"), false);
  assert.equal(registry.validateEntity({
    entity_id: "ent_x", binding_id: "risk:x", canonical_name: "X",
    entity_type: "CustomerRisk", aliases: []
  }).ontology_version, promoted.version.version_id);

  const blockedBy = { kind: "add_relation_type", name: "BLOCKED_BY" };
  let invalid = registry.proposeChange({
    ...blockedBy,
    sourceClaimId: claims[0].claim_id,
    supportAttestation: supportAttestation(claims[0], blockedBy)
  });
  for (const claim of claims.slice(1, 3)) invalid = registry.proposeChange({
    ...blockedBy,
    sourceClaimId: claim.claim_id,
    supportAttestation: supportAttestation(claim, blockedBy)
  });
  authorized.delete(claims[2].claim_id);
  assert.throws(() => registry.promoteChange({ changeId: invalid.change_id }), /ontology_support_invalid/);
  assert.equal(registry.hasRelationType("BLOCKED_BY"), false);

  const destructiveProposal = { kind: "rename", name: "ProjectV2" };
  const destructive = registry.proposeChange({
    ...destructiveProposal,
    sourceClaimId: claims[3].claim_id,
    supportAttestation: supportAttestation(claims[3], destructiveProposal)
  });
  assert.equal(destructive.state, "quarantined");
  assert.throws(() => registry.promoteChange({ changeId: destructive.change_id }), /ontology_change_not_promotable/);
  assert.equal(registry.activeVersion().version_id, promoted.version.version_id);
  const ciphertext = fs.readFileSync(path.join(registry.root, "changes", `${shadow.artifact_id}.json.aead`), "utf8");
  assert.doesNotMatch(ciphertext, /CustomerRisk|add_entity_type/);
});

test("red_test: forged or stale ontology support creates zero proposal artifacts", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ontology-forged-proposal-"));
  const vault = path.join(temporary, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const claim = supportClaim(31);
  const registry = createWorkspaceOntologyRegistry({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    claimAuthorityResolver: () => [],
    retrievalCorpus: RETRIEVAL_CORPUS,
    clock: () => "2026-08-04T10:00:00.000Z"
  });

  assert.throws(() => registry.proposeChange({
    kind: "add_entity_type",
    name: "ForgedCustomer",
    sourceClaimId: claim.claim_id,
    supportAttestation: supportAttestation(claim, {
      kind: "add_entity_type",
      name: "ForgedCustomer"
    })
  }), /ontology_support_invalid/);
  assert.deepEqual(registry.listChanges(), []);
});

test("red_test: promotion cannot substitute unrelated authorized support for the attested proposal set", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ontology-support-substitution-"));
  const vault = path.join(temporary, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const claims = [supportClaim(41), supportClaim(42), supportClaim(43), supportClaim(44)];
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const registry = createWorkspaceOntologyRegistry({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    claimAuthorityResolver: ({ claimIds }) => claimIds.map((id) => byId.get(id)).filter(Boolean),
    retrievalCorpus: RETRIEVAL_CORPUS,
    clock: () => "2026-08-04T10:00:00.000Z"
  });
  const proposal = { kind: "add_entity_type", name: "AttestedCustomer" };
  const shadow = registry.proposeChange({
    ...proposal,
    sourceClaimId: claims[0].claim_id,
    supportAttestation: supportAttestation(claims[0], proposal)
  });

  assert.throws(() => registry.promoteChange({
    changeId: shadow.change_id,
    supportClaimIds: claims.slice(1).map((claim) => claim.claim_id)
  }), /ontology_support_override_forbidden/);
  assert.equal(registry.hasEntityType("AttestedCustomer"), false);
});

test("red_test: retrieval promotion evaluates the versioned corpus and rejects evaluator self-authorization", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ontology-corpus-evaluation-"));
  const vault = path.join(temporary, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const claims = [supportClaim(51), supportClaim(52), supportClaim(53)];
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const proposal = { kind: "add_entity_type", name: "MeasuredCustomer" };
  const registry = createWorkspaceOntologyRegistry({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    claimAuthorityResolver: ({ claimIds }) => claimIds.map((id) => byId.get(id)).filter(Boolean),
    retrievalCorpus: RETRIEVAL_CORPUS,
    clock: () => "2026-08-04T10:00:00.000Z"
  });
  let shadow;
  for (const claim of claims) {
    shadow = registry.proposeChange({
      ...proposal,
      sourceClaimId: claim.claim_id,
      supportAttestation: supportAttestation(claim, proposal)
    });
  }
  const promoted = registry.promoteChange({ changeId: shadow.change_id });
  const evaluationId = promoted.version.gates.evaluation_id;
  const encrypted = JSON.parse(fs.readFileSync(
    path.join(registry.root, "evaluations", `${evaluationId}.json.aead`),
    "utf8"
  ));
  const evaluation = openJsonAead(encrypted, {
    encryptionKey: KEY,
    expectedAad: `supermemory.ontology-artifact.v1.${WORKSPACE}.evaluations.${evaluationId}`
  });
  assert.equal(evaluation.cases_hash, sha256(canonicalJson(RETRIEVAL_CORPUS)));
  assert.deepEqual(
    evaluation.case_results.map((item) => item.case_id),
    RETRIEVAL_CORPUS.cases.map((item) => item.id)
  );
  assert.equal(evaluation.case_results.some((item) => item.candidate_score > item.baseline_score), true);
  assert.equal(evaluation.case_results.every((item) => item.candidate_score >= item.baseline_score), true);

  const untrustedVault = path.join(temporary, "untrusted-vault");
  fs.mkdirSync(untrustedVault);
  const untrusted = createWorkspaceOntologyRegistry({
    vaultRoot: untrustedVault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    claimAuthorityResolver: ({ claimIds }) => claimIds.map((id) => byId.get(id)).filter(Boolean),
    retrievalCorpus: RETRIEVAL_CORPUS,
    retrievalEvaluator: {
      identity: { provider: "attacker", version: "v1", trusted: true },
      evaluate: () => ({
        schema: "supermemory.ontology-evaluation.v1",
        evaluator_version: "attacker-v1",
        cases_hash: sha256(canonicalJson(RETRIEVAL_CORPUS)),
        baseline: 0,
        candidate: 1,
        regressions: 0
      })
    },
    clock: () => "2026-08-04T10:00:00.000Z"
  });
  let untrustedShadow;
  for (const claim of claims) {
    untrustedShadow = untrusted.proposeChange({
      ...proposal,
      sourceClaimId: claim.claim_id,
      supportAttestation: supportAttestation(claim, proposal)
    });
  }
  assert.throws(
    () => untrusted.promoteChange({ changeId: untrustedShadow.change_id }),
    /ontology_evaluator_untrusted/
  );
});

test("promotion re-resolves expiry and rejects duplicate or cross-workspace authority", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ontology-stale-support-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  let now = "2026-08-04T10:00:00.000Z";
  const expiringClaims = [61, 62, 63].map((number) => supportClaim(number, { temporary: true }));
  const expiringById = new Map(expiringClaims.map((claim) => [claim.claim_id, claim]));
  const expiringVault = path.join(temporary, "expiry");
  fs.mkdirSync(expiringVault);
  const expiring = createWorkspaceOntologyRegistry({
    vaultRoot: expiringVault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    claimAuthorityResolver: ({ claimIds }) => claimIds.map((id) => expiringById.get(id)).filter(Boolean),
    retrievalCorpus: RETRIEVAL_CORPUS,
    clock: () => now
  });
  const expiringProposal = { kind: "add_entity_type", name: "ExpiredSupport" };
  let expiringShadow;
  for (const claim of expiringClaims) {
    expiringShadow = expiring.proposeChange({
      ...expiringProposal,
      sourceClaimId: claim.claim_id,
      supportAttestation: supportAttestation(claim, expiringProposal)
    });
  }
  now = "2026-08-12T10:00:00.000Z";
  assert.throws(() => expiring.promoteChange({ changeId: expiringShadow.change_id }), /ontology_support_invalid/);

  const sharedEvidence = "wev_018f1234-5678-7abc-8def-000000000071";
  const sharedEpisode = "epi_018f1234-5678-7abc-8def-000000000071";
  const duplicateClaims = [71, 72, 73].map((number) => supportClaim(number, {
    evidenceId: number === 73 ? sharedEvidence : null,
    episodeId: number === 73 ? sharedEpisode : null
  }));
  duplicateClaims[0] = supportClaim(71, { evidenceId: sharedEvidence, episodeId: sharedEpisode });
  const duplicateById = new Map(duplicateClaims.map((claim) => [claim.claim_id, claim]));
  const duplicateVault = path.join(temporary, "duplicates");
  fs.mkdirSync(duplicateVault);
  const duplicate = createWorkspaceOntologyRegistry({
    vaultRoot: duplicateVault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    claimAuthorityResolver: ({ claimIds }) => claimIds.map((id) => duplicateById.get(id)).filter(Boolean),
    retrievalCorpus: RETRIEVAL_CORPUS,
    clock: () => "2026-08-04T10:00:00.000Z"
  });
  const duplicateProposal = { kind: "add_relation_type", name: "DUPLICATE_SUPPORT" };
  let duplicateShadow;
  for (const claim of duplicateClaims) {
    duplicateShadow = duplicate.proposeChange({
      ...duplicateProposal,
      sourceClaimId: claim.claim_id,
      supportAttestation: supportAttestation(claim, duplicateProposal)
    });
  }
  assert.throws(
    () => duplicate.promoteChange({ changeId: duplicateShadow.change_id }),
    /ontology_support_not_independent/
  );

  duplicateById.set(duplicateClaims[2].claim_id, {
    ...duplicateClaims[2],
    workspace_id: "ws_018f1234-5678-7abc-8def-0123456789ff"
  });
  assert.throws(
    () => duplicate.promoteChange({ changeId: duplicateShadow.change_id }),
    /ontology_support_invalid/
  );
});

test("constructor-pinned evaluators cannot hide corpus regressions", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ontology-pinned-evaluator-"));
  const vault = path.join(temporary, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const claims = [supportClaim(81), supportClaim(82), supportClaim(83)];
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const casesHash = sha256(canonicalJson(RETRIEVAL_CORPUS));
  const registry = createWorkspaceOntologyRegistry({
    vaultRoot: vault,
    encryptionKey: KEY,
    workspaceId: WORKSPACE,
    claimAuthorityResolver: ({ claimIds }) => claimIds.map((id) => byId.get(id)).filter(Boolean),
    retrievalCorpus: RETRIEVAL_CORPUS,
    retrievalEvaluatorPin: { provider: "fixture", version: "eval-v1", cases_hash: casesHash },
    retrievalEvaluator: {
      identity: { provider: "fixture", version: "eval-v1" },
      evaluate: ({ corpus }) => ({
        schema: "supermemory.ontology-evaluation.v1",
        evaluator_version: "eval-v1",
        cases_hash: casesHash,
        case_results: corpus.cases.map((item, index) => ({
          case_id: item.id,
          baseline_score: index === 0 ? 0 : 1,
          candidate_score: index === 1 ? 0 : 1
        }))
      })
    },
    clock: () => "2026-08-04T10:00:00.000Z"
  });
  const proposal = { kind: "add_entity_type", name: "RegressiveCustomer" };
  let shadow;
  for (const claim of claims) {
    shadow = registry.proposeChange({
      ...proposal,
      sourceClaimId: claim.claim_id,
      supportAttestation: supportAttestation(claim, proposal)
    });
  }
  assert.throws(() => registry.promoteChange({ changeId: shadow.change_id }), /ontology_evaluation_failed/);
});
