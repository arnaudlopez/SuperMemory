import crypto from "node:crypto";

export function canonicalClaimMemoryId(claimId) {
  return `memory:${crypto.createHash("sha256").update(String(claimId)).digest("hex")}`;
}

export function createHindsightLearnedPlane({ gateway, graphAdapter, consumer = "codex" } = {}) {
  if (!gateway?.project || !gateway?.consolidate || !graphAdapter?.readAuthorizedState) {
    throw Object.assign(new Error("hindsight_learned_plane_invalid"), { code: "hindsight_learned_plane_invalid" });
  }
  const projectCanonicalClaim = async ({ workspaceId, claim, source }) => gateway.project({
    schema_version: "canonical-claim-v1",
    workspace_id: workspaceId,
    project_id: source.episode.project_id,
    memory_id: canonicalClaimMemoryId(claim.claim_id),
    candidate_id: claim.claim_id,
    admission_id: claim.admission.admission_id,
    status: "active",
    allowed_consumers: [consumer],
    sensitivity: source.episode.sensitivity ?? "standard",
    domain: "project",
    title: "Canonical claim",
    text: claim.claim_text,
    observed_at: claim.observed_at,
    evidence_ids: claim.evidence_ids,
    entities: graphAdapter.readAuthorizedState({ workspaceId }).entities
      .filter((entity) => entity.claim_ids.includes(claim.claim_id))
      .map((entity) => ({ text: entity.canonical_name, type: entity.entity_type.toUpperCase() }))
  });
  const scopes = [["consumer:codex", "sensitivity:standard", "domain:project"]];
  return Object.freeze({
    projectCanonicalClaim,
    consolidateSession: () => gateway.consolidate(scopes),
    reconcileRevocations: async () => ({ status: "authority_removed_locally", cleanup: "best_effort" }),
    status: () => gateway.status(),
    preflight: (options) => gateway.preflight(options)
  });
}
