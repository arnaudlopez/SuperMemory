import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ADMISSION_POLICY_VERSION,
  CALIBRATED_ADMISSION_THRESHOLDS,
  createMemoryAdmissionPolicy,
  measureAdmissionCorpus,
  verifyAdmissionDecision
} from "../scripts/lib/memory-admission-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const now = "2026-08-04T10:00:00.000Z";
const policy = createMemoryAdmissionPolicy({ clock: () => now });

function candidate(overrides = {}) {
  return {
    candidate_id: "candidate:test",
    workspace_id: "workspace:test",
    sensitivity: "standard",
    confidence: 0.01,
    evidence_ids: ["evidence:test"],
    extractor: { provider: "fixture", model: "extractor-v1", prompt_version: "extract-v1" },
    ...overrides
  };
}

function verified(signals = {}, verifier = {}) {
  return {
    status: "verified",
    verifier: {
      provider: "fixture",
      model: "independent-verifier-v1",
      prompt_version: "verify-v1",
      independent: true,
      ...verifier
    },
    signals: {
      evidence_entailment: 0.98,
      source_trust: 0.96,
      extraction_agreement: 0.93,
      scope_valid: true,
      ontology_compatible: true,
      contradiction_risk: 0,
      ...signals
    }
  };
}

test("AD-AC01 strongly proved standard claims auto-activate with a hash attestation", () => {
  const result = policy.evaluate({ candidate: candidate(), verification: verified() });
  assert.equal(result.decision, "auto_activate");
  assert.equal(result.recall_allowed, true);
  assert.equal(result.admission.policy_version, ADMISSION_POLICY_VERSION);
  assert.equal(result.admission.decided_by, `policy:${ADMISSION_POLICY_VERSION}`);
  assert.ok(verifyAdmissionDecision(result.admission, {
    candidateId: "candidate:test",
    workspaceId: "workspace:test",
    evidenceIds: ["evidence:test"]
  }));
});

test("AD-AC02 unproved claims discard and AD-AC03 temporary claims receive TTL", () => {
  const discarded = policy.evaluate({
    candidate: candidate(),
    verification: verified({ evidence_entailment: 0.2 })
  });
  assert.equal(discarded.decision, "discard");
  assert.equal(discarded.recall_allowed, false);

  const temporary = policy.evaluate({
    candidate: candidate(),
    verification: verified({ temporary: true, evidence_entailment: 0.85, source_trust: 0.8 })
  });
  assert.equal(temporary.decision, "activate_ttl");
  assert.ok(Date.parse(temporary.admission.expires_at) > Date.parse(now));
});

test("AD-AC04 high-impact conflicts quarantine and AD-AC05 outages stay pending", () => {
  const conflict = policy.evaluate({
    candidate: candidate(),
    verification: verified({ high_impact: true, contradiction_risk: 0.9 })
  });
  assert.equal(conflict.decision, "quarantine");
  assert.equal(conflict.recall_allowed, false);
  assert.deepEqual(
    policy.evaluate({ candidate: candidate(), verification: { status: "unavailable" } }),
    { status: "pending_verification", decision: null, admission: null, recall_allowed: false }
  );
});

test("AD-AC06 extractor self-confidence cannot affect policy and verifier must be independent", () => {
  const low = policy.evaluate({ candidate: candidate({ confidence: 0 }), verification: verified() });
  const high = policy.evaluate({ candidate: candidate({ confidence: 1 }), verification: verified() });
  assert.equal(low.decision, high.decision);
  assert.deepEqual(low.admission.signals, high.admission.signals);
  assert.throws(
    () => policy.evaluate({
      candidate: candidate(),
      verification: verified({}, { model: "extractor-v1", prompt_version: "extract-v1" })
    }),
    (error) => error.code === "admission_verifier_not_independent"
  );
});

test("AD-AC07 versioned holdout exceeds precision and exception targets", () => {
  const calibration = JSON.parse(fs.readFileSync(
    path.join(here, "fixtures/memory-admission-policy/calibration.v1.json"),
    "utf8"
  ));
  const corpus = JSON.parse(fs.readFileSync(
    path.join(here, "fixtures/memory-admission-policy/corpus.v1.json"),
    "utf8"
  ));
  assert.equal(calibration.split, "calibration");
  assert.equal(corpus.split, "holdout");
  assert.notDeepEqual(
    calibration.cases.map((item) => item.id),
    corpus.cases.map((item) => item.id)
  );
  assert.deepEqual(calibration.threshold_profile.thresholds, CALIBRATED_ADMISSION_THRESHOLDS);
  assert.deepEqual(corpus.threshold_profile, calibration.threshold_profile);
  const calibrationReport = measureAdmissionCorpus(calibration, policy);
  const report = measureAdmissionCorpus(corpus, policy);
  assert.equal(calibrationReport.automatic_mode_eligible, false);
  assert.deepEqual(report.threshold_profile, CALIBRATED_ADMISSION_THRESHOLDS);
  assert.equal(new Set(corpus.cases.map((item) => JSON.stringify(item.verification.signals))).size,
    corpus.cases.length);
  assert.deepEqual(
    new Set(corpus.cases.map((item) => item.expected)),
    new Set(["auto_activate", "activate_ttl", "discard", "quarantine", "pending_verification"])
  );
  assert.equal(report.corpus_version, "holdout-v1.0.0");
  assert.deepEqual(report.mismatches, []);
  assert.ok(report.auto_activation_precision >= 0.95, JSON.stringify(report));
  assert.ok(report.human_exception_rate < 0.05, JSON.stringify(report));
  assert.equal(report.automatic_mode_eligible, true);

  const imperfect = structuredClone(corpus);
  imperfect.cases[0].expected = "discard";
  const imperfectReport = measureAdmissionCorpus(imperfect, policy);
  assert.deepEqual(imperfectReport.mismatches, [{
    id: imperfect.cases[0].id,
    expected: "discard",
    actual: "auto_activate"
  }]);
  assert.equal(imperfectReport.confusion.discard.auto_activate, 1);
});

test("attestation verification recomputes IDs and binds candidate, workspace, policy, evidence and TTL", () => {
  const admitted = policy.evaluate({ candidate: candidate(), verification: verified() }).admission;
  for (const mutation of [
    { admission_id: `adm_${"0".repeat(64)}` },
    { claim_id: "candidate:forged" },
    { workspace_id: "workspace:forged" },
    { policy_version: "admission-v9" },
    { evidence_ids: ["evidence:forged"] },
    { expires_at: "2026-08-05T10:00:00.000Z" }
  ]) {
    assert.equal(verifyAdmissionDecision({ ...admitted, ...mutation }), false);
  }
  const ttl = policy.evaluate({
    candidate: candidate(),
    verification: verified({ temporary: true, evidence_entailment: 0.85, source_trust: 0.8 })
  }).admission;
  assert.ok(verifyAdmissionDecision(ttl, {
    candidateId: "candidate:test",
    workspaceId: "workspace:test",
    evidenceIds: ["evidence:test"]
  }));
  assert.equal(verifyAdmissionDecision({ ...ttl, expires_at: ttl.decided_at }), false);
});
