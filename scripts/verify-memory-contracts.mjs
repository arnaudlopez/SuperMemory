#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(
  root,
  "identity-vault/90_evals/cases/memory-contracts/input/contracts.fixture.json"
);
const assertionsPath = path.join(
  root,
  "identity-vault/90_evals/cases/memory-contracts/expected/assertions.json"
);

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateContracts(input) {
  const errors = new Set();

  checkSnapshotIdentity(input, errors);
  checkInterpretationCandidates(input, errors);
  checkMemoryCandidates(input, errors);
  checkValidatedMemories(input, errors);
  checkPromotionPayloads(input, errors);
  checkRecallPolicies(input, errors);
  checkAnswerEvidence(input, errors);
  checkRelations(input, errors);

  return [...errors];
}

function list(input, key) {
  return Array.isArray(input?.[key]) ? input[key] : [];
}

const knownUsePatterns = new Set([
  "external_draft",
  "internal_draft",
  "decision_support",
  "interaction_brief",
  "strategic_analysis",
  "audit_and_proof",
  "external_system_update"
]);

function checkSnapshotIdentity(input, errors) {
  const seen = new Map();

  for (const snapshot of list(input, "snapshots")) {
    if (!snapshot?.snapshot_id) continue;
    const previous = seen.get(snapshot.snapshot_id);
    if (previous && previous.content_hash !== snapshot.content_hash) {
      errors.add("snapshot_id_collision");
      continue;
    }
    seen.set(snapshot.snapshot_id, snapshot);
  }
}

function checkMemoryCandidates(input, errors) {
  for (const candidate of list(input, "memory_candidates")) {
    const wantsActive = candidate.proposed_status === "active" || candidate.status === "active";
    const admitted = (
      ["auto_activate", "activate_ttl"].includes(candidate.admission_decision) &&
      Boolean(candidate.admission_id) &&
      Boolean(candidate.admission_policy_version) &&
      candidate.verifier?.independent === true
    );
    if (wantsActive && candidate.review_status !== "approved" && !admitted) {
      errors.add("candidate_not_validated");
    }
    if (wantsActive && candidate.schema_status === "candidate") {
      errors.add("candidate_type_not_promotable");
    }
  }
}

function checkInterpretationCandidates(input, errors) {
  for (const interpretation of list(input, "interpretation_candidates")) {
    const proposedFrom = Array.isArray(interpretation.proposed_from) ? interpretation.proposed_from : [];
    const evidenceRefs = Array.isArray(interpretation.evidence_refs) ? interpretation.evidence_refs : [];
    if (proposedFrom.length === 0 && evidenceRefs.length === 0) {
      errors.add("interpretation_without_evidence");
    }
    if (!interpretation.confidence) {
      errors.add("interpretation_without_confidence");
    }
    if (typeof interpretation.uncertainty !== "string") {
      errors.add("interpretation_without_uncertainty");
    }
    if (!knownUsePatterns.has(interpretation.use_pattern)) {
      errors.add("interpretation_unknown_use_pattern");
    }
  }
}

function checkValidatedMemories(input, errors) {
  const interpretationsById = new Map(
    list(input, "interpretation_candidates")
      .map((interpretation) => [interpretation.interpretation_id, interpretation])
      .filter(([interpretationId]) => Boolean(interpretationId))
  );

  for (const memory of list(input, "validated_memories")) {
    const derivedFrom = Array.isArray(memory.derived_from) ? memory.derived_from : [];
    if (memory.status === "active" && !memory.snapshot_id && derivedFrom.length === 0) {
      errors.add("missing_snapshot_proof");
    }
    if (
      memory.status === "active" &&
      memory.admission_decision &&
      !["auto_activate", "activate_ttl"].includes(memory.admission_decision)
    ) errors.add("active_memory_not_admitted");
    if (
      memory.status === "active" &&
      derivedFrom.some((id) => {
        const interpretation = interpretationsById.get(id);
        return interpretation && interpretation.review_status !== "approved";
      })
    ) {
      errors.add("interpretation_not_reviewed_for_active_memory");
    }
  }
}

function checkPromotionPayloads(input, errors) {
  const activePayloadDocumentIds = new Set(
    list(input, "promotion_payloads")
      .filter((payload) => payload?.status === "active")
      .map((payload) => payload.document_id)
      .filter(Boolean)
  );

  for (const memory of list(input, "validated_memories")) {
    if (memory.status === "do_not_use" && activePayloadDocumentIds.has(memory.document_id)) {
      errors.add("do_not_use_not_promotable");
    }
  }

  for (const payload of list(input, "promotion_payloads")) {
    if (
      payload.status === "active" &&
      payload.metadata?.review_status === "admitted" &&
      (
        !payload.metadata.admission_id ||
        !["auto_activate", "activate_ttl"].includes(payload.metadata.admission_decision) ||
        !payload.metadata.admission_policy_version
      )
    ) errors.add("promotion_missing_admission");
  }

  if (list(input, "interpretation_candidates").length > 0) {
    for (const payload of list(input, "promotion_payloads")) {
      if (payload.status === "active" && !payload.metadata?.interpretation_id) {
        errors.add("promotion_missing_interpretation_provenance");
      }
    }
  }
}

function checkRecallPolicies(input, errors) {
  for (const policy of list(input, "recall_policies")) {
    const requiredTags = Array.isArray(policy.required_tags) ? policy.required_tags : [];
    const hasWorkspace = Boolean(policy.workspace_id) || requiredTags.some((tag) => tag.startsWith("workspace:"));
    const hasAccessPolicy =
      Boolean(policy.access_policy) || requiredTags.some((tag) => tag.startsWith("access_policy:"));
    const hasActiveStatus = requiredTags.includes("status:active");
    if (!policy.fail_closed || !hasWorkspace || !hasAccessPolicy || !hasActiveStatus) {
      errors.add("unsafe_recall_policy");
    }
  }
}

function checkAnswerEvidence(input, errors) {
  for (const evidence of list(input, "answer_evidence")) {
    const usedMemoryIds = Array.isArray(evidence.used_memory_ids) ? evidence.used_memory_ids : [];
    const citedSnapshotIds = Array.isArray(evidence.cited_snapshot_ids) ? evidence.cited_snapshot_ids : [];
    if (evidence.answer_state === "current" && (usedMemoryIds.length === 0 || citedSnapshotIds.length === 0)) {
      errors.add("missing_answer_evidence");
    }
  }
}

function checkRelations(input, errors) {
  const memoryIds = new Set(list(input, "validated_memories").map((memory) => memory.memory_id).filter(Boolean));
  const answerIds = new Set(list(input, "answer_evidence").map((evidence) => evidence.answer_id).filter(Boolean));

  for (const relation of list(input, "relations")) {
    if (relation.relation_type !== "supports_answer") continue;
    if (!memoryIds.has(relation.from) || !answerIds.has(relation.to)) {
      errors.add("invalid_relation_endpoints");
    }
  }
}

if (!fs.existsSync(fixturePath)) {
  fail(`missing fixture: ${fixturePath}`);
  process.exit();
}

if (!fs.existsSync(assertionsPath)) {
  fail(`missing assertions: ${assertionsPath}`);
  process.exit();
}

const fixture = readJson(fixturePath);
const assertions = readJson(assertionsPath);

for (const testId of assertions.required_test_ids ?? []) {
  const invalidCase = fixture.invalid_cases?.find((item) => item.id === testId);
  if (!invalidCase) {
    fail(`missing invalid case ${testId}`);
    continue;
  }
  if (invalidCase.expected_error !== assertions.expected_errors?.[testId]) {
    fail(`${testId} expected_error mismatch`);
  }
}

for (const invalidCase of fixture.invalid_cases ?? []) {
  const errors = validateContracts(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateContracts(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: memory contracts are valid`);
}
