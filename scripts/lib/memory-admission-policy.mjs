import crypto from "node:crypto";

export const ADMISSION_POLICY_VERSION = "admission-v1.0.0";
export const ADMISSION_SCHEMA = "supermemory.admission-decision.v1";
export const ADMISSION_DECISIONS = Object.freeze([
  "auto_activate",
  "activate_ttl",
  "quarantine",
  "discard"
]);

export const CALIBRATED_ADMISSION_THRESHOLDS = Object.freeze({
  auto_entailment: 0.95,
  auto_source_trust: 0.9,
  auto_agreement: 0.85,
  max_contradiction_risk: 0.05,
  ttl_entailment: 0.8,
  ttl_source_trust: 0.65,
  discard_entailment: 0.5,
  ttl_ms: 7 * 24 * 60 * 60 * 1000
});

export class MemoryAdmissionPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "MemoryAdmissionPolicyError";
    this.code = code;
  }
}

function fail(code) {
  throw new MemoryAdmissionPolicyError(code);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function evidenceIds(candidate) {
  const explicit = Array.isArray(candidate?.evidence_ids) ? candidate.evidence_ids : [
    ...(Array.isArray(candidate?.event_ids) ? candidate.event_ids : []),
    candidate?.turn_snapshot_id,
    ...(Array.isArray(candidate?.source_snapshot_ids) ? candidate.source_snapshot_ids : []),
    candidate?.snapshotId,
    candidate?.snapshot_id
  ];
  return [...new Set(explicit.filter((value) => typeof value === "string" && value.trim()))].sort();
}

function score(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) fail(`admission_signal_${name}_invalid`);
  return number;
}

function normalizeSignals(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("admission_signals_invalid");
  }
  return {
    evidence_entailment: score(value.evidence_entailment, "evidence_entailment"),
    source_trust: score(value.source_trust, "source_trust"),
    extraction_agreement: score(value.extraction_agreement, "extraction_agreement"),
    entity_resolution_confidence: score(
      value.entity_resolution_confidence ?? 1,
      "entity_resolution_confidence"
    ),
    temporal_consistency: score(value.temporal_consistency ?? 1, "temporal_consistency"),
    independent_support: score(value.independent_support ?? 0, "independent_support"),
    contradiction_risk: score(value.contradiction_risk ?? 0, "contradiction_risk"),
    scope_valid: value.scope_valid === true,
    ontology_compatible: value.ontology_compatible === true,
    temporary: value.temporary === true,
    duplicate: value.duplicate === true,
    fragment: value.fragment === true,
    high_impact: value.high_impact === true,
    permission_risk: value.permission_risk === true,
    destructive_ontology_change: value.destructive_ontology_change === true
  };
}

function verifierIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("admission_verifier_invalid");
  }
  const verifier = {
    provider: String(value.provider ?? "").trim(),
    model: String(value.model ?? "").trim(),
    prompt_version: String(value.prompt_version ?? "").trim(),
    independent: value.independent === true
  };
  if (!verifier.provider || !verifier.model || !verifier.prompt_version || !verifier.independent) {
    fail("admission_verifier_not_independent");
  }
  return verifier;
}

function extractorIdentity(candidate) {
  return {
    provider: String(candidate?.extractor?.provider ?? "configured"),
    model: String(candidate?.extractor?.model ?? "unknown"),
    prompt_version: String(candidate?.extractor?.prompt_version ?? "unknown")
  };
}

function reasonedDecision(candidate, signals, thresholds) {
  if (!signals.scope_valid) return ["discard", ["scope_invalid"]];
  if (signals.duplicate || signals.fragment || signals.evidence_entailment < thresholds.discard_entailment) {
    return ["discard", [
      signals.duplicate ? "exact_duplicate" : null,
      signals.fragment ? "fragment" : null,
      signals.evidence_entailment < thresholds.discard_entailment ? "insufficient_entailment" : null
    ].filter(Boolean)];
  }
  if (
    candidate?.sensitivity === "restricted" ||
    candidate?.sensitivity === "restricted_review" ||
    signals.high_impact ||
    signals.permission_risk ||
    signals.destructive_ontology_change ||
    signals.contradiction_risk > thresholds.max_contradiction_risk ||
    !signals.ontology_compatible
  ) {
    return ["quarantine", [
      candidate?.sensitivity !== "standard" ? "restricted_content" : null,
      signals.high_impact ? "high_impact_fact" : null,
      signals.permission_risk ? "restricted_permission" : null,
      signals.destructive_ontology_change ? "destructive_ontology_change" : null,
      signals.contradiction_risk > thresholds.max_contradiction_risk ? "active_conflict" : null,
      !signals.ontology_compatible ? "ontology_incompatible" : null
    ].filter(Boolean)];
  }
  if (
    signals.temporary &&
    signals.evidence_entailment >= thresholds.ttl_entailment &&
    signals.source_trust >= thresholds.ttl_source_trust
  ) return ["activate_ttl", ["temporary_claim", "verified_evidence", "low_risk"]];
  if (
    signals.evidence_entailment >= thresholds.auto_entailment &&
    signals.source_trust >= thresholds.auto_source_trust &&
    signals.extraction_agreement >= thresholds.auto_agreement &&
    signals.temporal_consistency >= thresholds.auto_agreement
  ) return ["auto_activate", ["exact_evidence", "trusted_source", "no_active_conflict"]];
  return ["discard", ["admission_threshold_not_met"]];
}

export function createMemoryAdmissionPolicy({
  policyVersion = ADMISSION_POLICY_VERSION,
  thresholds = {},
  clock = () => new Date().toISOString()
} = {}) {
  const calibrated = { ...CALIBRATED_ADMISSION_THRESHOLDS, ...thresholds };
  if (policyVersion !== ADMISSION_POLICY_VERSION) fail("admission_policy_uncalibrated");

  const evaluate = ({ candidate, verification } = {}) => {
    if (!candidate || typeof candidate !== "object") fail("admission_candidate_invalid");
    if (!verification || verification.status === "unavailable" || verification.status === "pending") {
      return { status: "pending_verification", decision: null, admission: null, recall_allowed: false };
    }
    if (verification.status !== "verified") fail("admission_verification_invalid");
    const verifier = verifierIdentity(verification.verifier);
    const extractor = extractorIdentity(candidate);
    if (verifier.model === extractor.model && verifier.prompt_version === extractor.prompt_version) {
      fail("admission_verifier_not_independent");
    }
    const signals = normalizeSignals(verification.signals);
    const claimId = candidate.candidate_id ?? candidate.candidateId;
    const workspaceId = candidate.workspace_id ?? candidate.workspaceId;
    const evidence = evidenceIds(candidate);
    if (!claimId || !workspaceId) fail("admission_candidate_binding_invalid");
    if (evidence.length === 0) fail("admission_candidate_evidence_missing");
    const [decision, reasonCodes] = reasonedDecision(candidate, signals, calibrated);
    const decidedAt = clock();
    let expiresAt = null;
    if (decision === "activate_ttl") {
      expiresAt = new Date(Date.parse(decidedAt) + calibrated.ttl_ms).toISOString();
    }
    const material = {
      schema: ADMISSION_SCHEMA,
      claim_id: claimId,
      workspace_id: workspaceId,
      evidence_ids: evidence,
      decision,
      policy_version: policyVersion,
      extractor,
      verifier,
      signals,
      reason_codes: reasonCodes,
      decided_by: `policy:${policyVersion}`,
      decided_at: decidedAt,
      expires_at: expiresAt
    };
    const admissionId = `adm_${sha256(canonicalJson(material))}`;
    const unsigned = { ...material, admission_id: admissionId };
    const admission = {
      ...unsigned,
      integrity_hash: `sha256:${sha256(canonicalJson(unsigned))}`
    };
    return {
      status: decision,
      decision,
      admission,
      recall_allowed: decision === "auto_activate" || decision === "activate_ttl"
    };
  };

  return { policyVersion, thresholds: Object.freeze({ ...calibrated }), evaluate };
}

export function verifyAdmissionDecision(value, {
  candidateId = null,
  workspaceId = null,
  policyVersion = ADMISSION_POLICY_VERSION,
  evidenceIds: expectedEvidenceIds = null
} = {}) {
  if (
    value?.schema !== ADMISSION_SCHEMA ||
    !ADMISSION_DECISIONS.includes(value.decision) ||
    value.policy_version !== policyVersion ||
    !value.admission_id?.startsWith("adm_")
  ) return false;
  if (!Array.isArray(value.evidence_ids) || value.evidence_ids.length === 0) return false;
  if (candidateId && value.claim_id !== candidateId) return false;
  if (workspaceId && value.workspace_id !== workspaceId) return false;
  if (expectedEvidenceIds) {
    const expected = [...new Set(expectedEvidenceIds)].sort();
    if (canonicalJson(value.evidence_ids) !== canonicalJson(expected)) return false;
  }
  if (value.decision === "activate_ttl") {
    if (!value.expires_at || Date.parse(value.expires_at) <= Date.parse(value.decided_at)) return false;
  } else if (value.expires_at !== null) return false;
  const material = { ...value };
  delete material.integrity_hash;
  delete material.admission_id;
  const expectedAdmissionId = `adm_${sha256(canonicalJson(material))}`;
  if (value.admission_id !== expectedAdmissionId) return false;
  const unsigned = { ...value };
  delete unsigned.integrity_hash;
  return value.integrity_hash === `sha256:${sha256(canonicalJson(unsigned))}`;
}

export function measureAdmissionCorpus(corpus, policy = createMemoryAdmissionPolicy({
  clock: () => "2026-08-04T10:00:00.000Z"
})) {
  if (corpus?.schema !== "supermemory.admission-calibration-corpus.v1" || !Array.isArray(corpus.cases)) {
    fail("admission_corpus_invalid");
  }
  const labels = [...ADMISSION_DECISIONS, "pending_verification"];
  const confusion = Object.fromEntries(labels.map((expected) => [
    expected,
    Object.fromEntries(labels.map((actual) => [actual, 0]))
  ]));
  const mismatches = [];
  let auto = 0;
  let correctAuto = 0;
  let humanExceptions = 0;
  let standard = 0;
  for (const item of corpus.cases) {
    const result = policy.evaluate({ candidate: item.candidate, verification: item.verification });
    const actual = result.status;
    if (!labels.includes(item.expected) || !labels.includes(actual)) fail("admission_corpus_label_invalid");
    confusion[item.expected][actual] += 1;
    if (item.candidate.sensitivity === "standard") {
      standard += 1;
      if (result.decision === "quarantine") humanExceptions += 1;
    }
    if (result.decision === "auto_activate") {
      auto += 1;
      if (item.expected === "auto_activate") correctAuto += 1;
    }
    if (actual !== item.expected) mismatches.push({ id: item.id, expected: item.expected, actual });
  }
  const precision = auto === 0 ? 0 : correctAuto / auto;
  const exceptionRate = standard === 0 ? 0 : humanExceptions / standard;
  return {
    corpus_version: corpus.version,
    split: corpus.split,
    policy_version: policy.policyVersion,
    threshold_profile: { ...policy.thresholds },
    cases: corpus.cases.length,
    confusion,
    mismatches,
    auto_activation_precision: precision,
    human_exception_rate: exceptionRate,
    automatic_mode_eligible: corpus.split === "holdout" && auto > 0 && precision >= 0.95 && exceptionRate < 0.05
  };
}
