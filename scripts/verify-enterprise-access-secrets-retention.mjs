#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/enterprise-access-secrets-retention");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(caseRoot, relativePath), "utf8"));
}

function list(input, key) {
  return Array.isArray(input?.[key]) ? input[key] : [];
}

function mapBy(items, key) {
  return new Map(items.map((item) => [item[key], item]).filter(([value]) => Boolean(value)));
}

function hasValue(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function includesAll(actual, required) {
  return required.every((item) => actual.includes(item));
}

function serialized(items) {
  return JSON.stringify(items ?? []);
}

function containsSecretLikeValue(value) {
  return /(?:sk-(?:live|test)[-_][A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key\s*[:=]\s*[A-Za-z0-9._-]{12,})/i.test(
    String(value ?? "")
  );
}

function validateEnterpriseAccess(input) {
  const errors = new Set();
  const memories = mapBy(list(input, "enterprise_memories"), "memory_id");

  checkEnterpriseMemoryMetadata(input, errors);
  checkPromotionMetadata(input, memories, errors);
  checkSecretRedaction(input, memories, errors);
  checkRestrictedDrafts(input, memories, errors);
  checkLegalHold(input, errors);

  return [...errors];
}

function checkEnterpriseMemoryMetadata(input, errors) {
  for (const memory of list(input, "enterprise_memories")) {
    if (!hasValue(memory.workspace_id)) errors.add("enterprise_memory_missing_workspace");
    if (!hasValue(memory.access_policy)) errors.add("enterprise_memory_missing_access_policy");
    if (!hasValue(memory.data_owner)) errors.add("enterprise_memory_missing_data_owner");
    if (!Array.isArray(memory.allowed_consumers) || memory.allowed_consumers.length === 0) {
      errors.add("enterprise_memory_missing_access_policy");
    }
  }
}

function checkPromotionMetadata(input, memories, errors) {
  for (const promotion of list(input, "promotion_payloads")) {
    const memory = memories.get(promotion.memory_id);
    if (!hasValue(promotion.workspace_id) || promotion.workspace_id !== memory?.workspace_id) {
      errors.add("enterprise_memory_missing_workspace");
    }
    if (!hasValue(promotion.access_policy) || promotion.access_policy !== memory?.access_policy) {
      errors.add("enterprise_memory_missing_access_policy");
    }
    if (!hasValue(promotion.data_owner) || promotion.data_owner !== memory?.data_owner) {
      errors.add("promotion_missing_data_owner");
    }
    if (!Array.isArray(promotion.allowed_consumers) || promotion.allowed_consumers.length === 0) {
      errors.add("enterprise_memory_missing_access_policy");
    }
  }
}

function checkSecretRedaction(input, memories, errors) {
  const secretValues = list(input, "enterprise_memories").flatMap((memory) =>
    Array.isArray(memory.secret_values) ? memory.secret_values : []
  );
  const exposed = `${serialized(list(input, "promotion_payloads"))}\n${serialized(list(input, "drafts"))}`;
  if (containsSecretLikeValue(exposed)) {
    errors.add("secret_leaked_to_promotion_or_draft");
  }
  for (const secret of secretValues) {
    if (hasValue(secret) && exposed.includes(secret)) {
      errors.add("secret_leaked_to_promotion_or_draft");
    }
  }

  for (const promotion of list(input, "promotion_payloads")) {
    const memory = memories.get(promotion.memory_id);
    if ((memory?.secret_values ?? []).length > 0 && promotion.redaction_state !== "secret_redacted") {
      errors.add("secret_leaked_to_promotion_or_draft");
    }
  }
}

function checkRestrictedDrafts(input, memories, errors) {
  for (const draft of list(input, "drafts")) {
    const sourceMemories = (draft.source_memory_ids ?? []).map((memoryId) => memories.get(memoryId)).filter(Boolean);
    const restrictedFields = sourceMemories.flatMap((memory) =>
      Array.isArray(memory.restricted_fields) ? memory.restricted_fields : []
    );
    const restrictedValues = sourceMemories.flatMap((memory) =>
      Array.isArray(memory.restricted_values) ? memory.restricted_values : []
    );
    if (restrictedFields.length === 0 && restrictedValues.length === 0) continue;

    const withheldFields = Array.isArray(draft.withheld_fields) ? draft.withheld_fields : [];
    const content = String(draft.content ?? "");
    const leakedValue = restrictedValues.some((value) => hasValue(value) && content.includes(value));
    if (!includesAll(withheldFields, restrictedFields) || leakedValue) {
      errors.add("restricted_field_leaked_to_draft");
    }
  }
}

function checkLegalHold(input, errors) {
  const retentionBySource = mapBy(list(input, "retention_records"), "source_id");
  for (const source of list(input, "captured_sources")) {
    if (source.legal_hold !== true) continue;
    const record = retentionBySource.get(source.source_id);
    if (
      !record ||
      record.legal_hold !== true ||
      !hasValue(record.retention_policy) ||
      record.vault_proof_retained !== true ||
      record.active_hindsight_excluded !== true
    ) {
      errors.add("legal_hold_proof_not_retained");
    }
  }
}

function verifyExpectedOutputs(fixture, assertions) {
  const expected = readJson("expected/answer-evidence.json");
  const valid = fixture.valid;
  const memories = mapBy(list(valid, "enterprise_memories"), "memory_id");
  const promotions = mapBy(list(valid, "promotion_payloads"), "promotion_id");
  const drafts = mapBy(list(valid, "drafts"), "draft_id");
  const retention = mapBy(list(valid, "retention_records"), "retention_id");

  for (const memoryId of assertions.required_memory_ids ?? []) {
    if (!memories.has(memoryId)) fail(`missing required enterprise memory: ${memoryId}`);
  }
  for (const promotionId of assertions.required_promotion_ids ?? []) {
    if (!promotions.has(promotionId)) fail(`missing required promotion payload: ${promotionId}`);
  }
  for (const draftId of assertions.required_draft_ids ?? []) {
    if (!drafts.has(draftId)) fail(`missing required draft: ${draftId}`);
  }
  if (!list(valid, "captured_sources").some((source) => source.source_id === assertions.required_legal_hold_source_id)) {
    fail(`missing required legal-hold source: ${assertions.required_legal_hold_source_id}`);
  }

  for (const output of expected.enterprise_outputs ?? []) {
    const actual = promotions.get(output.id) || drafts.get(output.id) || retention.get(output.id);
    if (!actual) {
      fail(`missing expected enterprise output: ${output.id}`);
      continue;
    }
    for (const [key, expectedValue] of Object.entries(output)) {
      if (key === "id") continue;
      if (JSON.stringify(actual[key]) !== JSON.stringify(expectedValue)) {
        fail(`${output.id} ${key} mismatch`);
      }
    }
  }
}

const fixture = readJson("input/fixture.json");
const assertions = readJson("expected/assertions.json");

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
  const errors = validateEnterpriseAccess(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateEnterpriseAccess(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: enterprise access secrets retention contract is valid`);
}
