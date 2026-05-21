#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const caseRoot = path.join(root, "identity-vault/90_evals/cases/hindsight-adapter-minimal");

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

function hasTagWithPrefix(tags, prefix) {
  return tags.some((tag) => typeof tag === "string" && tag.startsWith(prefix));
}

function hasRequiredRecallScope(policy) {
  const requiredTags = Array.isArray(policy.required_tags) ? policy.required_tags : [];
  return (
    policy.fail_closed === true &&
    hasTagWithPrefix(requiredTags, "workspace:") &&
    hasTagWithPrefix(requiredTags, "access_policy:") &&
    requiredTags.includes("status:active")
  );
}

const requiredPromotionMetadata = [
  "source_id",
  "snapshot_id",
  "observation_id",
  "interpretation_id",
  "memory_id"
];

function promotionHasProvenance(payload) {
  const metadata = payload.metadata ?? {};
  return requiredPromotionMetadata.every((key) => Boolean(metadata[key]));
}

function isDoNotUse(item) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return item.status === "do_not_use" || tags.includes("status:do_not_use");
}

function validateAdapterContract(input) {
  const errors = new Set();

  checkPromotionPayloads(input, errors);
  checkRecallPolicies(input, errors);
  checkDoNotUseRecall(input, errors);
  checkGlobalAutoRetain(input, errors);
  checkRecallTraces(input, errors);
  checkRawLlmRetain(input, errors);

  return [...errors];
}

function checkPromotionPayloads(input, errors) {
  for (const payload of list(input, "promotion_payloads")) {
    if (payload.status !== "active") continue;
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    const hasActiveTag = tags.includes("status:active");
    const hasScopedTags = hasTagWithPrefix(tags, "workspace:") && hasTagWithPrefix(tags, "access_policy:");
    if (!payload.document_id || !payload.memory_id || !payload.text || !hasActiveTag || !hasScopedTags) {
      errors.add("adapter_promotion_missing_provenance");
      continue;
    }
    if (!promotionHasProvenance(payload)) {
      errors.add("adapter_promotion_missing_provenance");
    }
  }
}

function checkRecallPolicies(input, errors) {
  for (const policy of list(input, "recall_policies")) {
    if (!hasRequiredRecallScope(policy)) {
      errors.add("unsafe_adapter_recall_policy");
    }
  }
}

function checkDoNotUseRecall(input, errors) {
  const doNotUseDocumentIds = new Set(
    list(input, "adapter_documents")
      .filter(isDoNotUse)
      .map((document) => document.document_id)
      .filter(Boolean)
  );

  for (const result of list(input, "recall_results")) {
    const recalledDocumentIds = Array.isArray(result.document_ids) ? result.document_ids : [];
    if (recalledDocumentIds.some((documentId) => doNotUseDocumentIds.has(documentId))) {
      errors.add("do_not_use_recalled");
    }
  }
}

function checkGlobalAutoRetain(input, errors) {
  const promotedDocumentIds = new Set(
    list(input, "promotion_payloads")
      .map((payload) => payload.document_id)
      .filter(Boolean)
  );
  const vaultDocumentIds = new Set(
    list(input, "vault_items")
      .map((item) => item.document_id)
      .filter(Boolean)
  );

  for (const document of list(input, "adapter_documents")) {
    if (vaultDocumentIds.has(document.document_id) && !promotedDocumentIds.has(document.document_id)) {
      errors.add("global_auto_retain_detected");
    }
  }
}

function checkRecallTraces(input, errors) {
  const inputAlreadyRepresentsAdapterState =
    Object.hasOwn(input ?? {}, "adapter_documents") || Object.hasOwn(input ?? {}, "recall_traces");
  if (!inputAlreadyRepresentsAdapterState) return;

  const tracePolicyIds = new Set(
    list(input, "recall_traces")
      .map((trace) => trace.policy_id)
      .filter(Boolean)
  );
  const resultPolicyIds = new Set(
    list(input, "recall_results")
      .map((result) => result.policy_id)
      .filter(Boolean)
  );

  for (const policy of list(input, "recall_policies")) {
    if (!hasRequiredRecallScope(policy)) continue;
    if (!tracePolicyIds.has(policy.policy_id) && !resultPolicyIds.has(policy.policy_id)) {
      errors.add("missing_recall_trace");
    }
  }
}

function checkRawLlmRetain(input, errors) {
  for (const document of list(input, "adapter_documents")) {
    if (document.status === "active" && document.source_kind === "raw_llm_conclusion") {
      errors.add("raw_llm_conclusion_retained");
    }
  }
}

function simulateAdapter(input) {
  const documents = new Map();
  const deletedDocumentIds = new Set();
  const traces = [];

  for (const payload of list(input, "promotion_payloads")) {
    if (payload.status === "active") {
      documents.set(payload.document_id, {
        document_id: payload.document_id,
        memory_id: payload.memory_id,
        status: payload.status,
        text: payload.text,
        tags: payload.tags ?? [],
        metadata: payload.metadata ?? {}
      });
      deletedDocumentIds.delete(payload.document_id);
      traces.push({
        trace_id: `trace-retain-${payload.document_id}`,
        operation: "retain",
        document_id: payload.document_id,
        memory_id: payload.memory_id
      });
      continue;
    }

    if (isDoNotUse(payload)) {
      documents.delete(payload.document_id);
      deletedDocumentIds.add(payload.document_id);
      traces.push({
        trace_id: `trace-delete-${payload.document_id}`,
        operation: "delete",
        document_id: payload.document_id,
        memory_id: payload.memory_id
      });
    }
  }

  const recallResults = [];
  for (const policy of list(input, "recall_policies")) {
    if (!hasRequiredRecallScope(policy)) continue;

    const requiredTags = policy.required_tags ?? [];
    const matchedDocuments = [...documents.values()].filter((document) => {
      if (document.status !== "active") return false;
      const tags = Array.isArray(document.tags) ? document.tags : [];
      return requiredTags.every((tag) => tags.includes(tag));
    });

    const trace = {
      trace_id: `trace-${policy.policy_id}`,
      operation: "recall",
      policy_id: policy.policy_id,
      matched_document_ids: matchedDocuments.map((document) => document.document_id)
    };
    if (matchedDocuments.length === 0) {
      trace.diagnostic = "no documents matched all required tags";
    }
    traces.push(trace);

    const result = {
      policy_id: policy.policy_id,
      document_ids: matchedDocuments.map((document) => document.document_id),
      trace_id: trace.trace_id
    };
    if (trace.diagnostic) {
      result.diagnostic = trace.diagnostic;
    }
    recallResults.push(result);
  }

  return {
    documents: [...documents.values()],
    deleted_document_ids: [...deletedDocumentIds],
    recall_results: recallResults,
    traces
  };
}

function requireEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function requireIncludesAll(actualValues, requiredValues, message) {
  for (const value of requiredValues) {
    if (!actualValues.includes(value)) {
      fail(`${message}: ${value}`);
    }
  }
}

function stripDocumentForExpected(document) {
  return {
    document_id: document.document_id,
    memory_id: document.memory_id,
    status: document.status,
    text: document.text,
    metadata: Object.fromEntries(
      requiredPromotionMetadata.map((key) => [key, document.metadata?.[key]])
    )
  };
}

function verifyExpectedOutputs(fixture, assertions) {
  const expectedState = readJson("expected/adapter-state.json");
  const expectedEvidence = readJson("expected/answer-evidence.json");
  const simulation = simulateAdapter(fixture.valid);

  requireEqual(
    simulation.documents.map(stripDocumentForExpected),
    expectedState.documents,
    "adapter document state mismatch"
  );
  requireEqual(simulation.deleted_document_ids, expectedState.deleted_document_ids, "deleted document ids mismatch");
  requireEqual(simulation.recall_results, expectedState.recall_results, "recall results mismatch");

  const document = simulation.documents.find((item) => item.document_id === assertions.required_document_id);
  if (!document) {
    fail(`missing required adapter document: ${assertions.required_document_id}`);
    return;
  }
  requireEqual(document.memory_id, assertions.required_memory_id, "required document memory_id mismatch");
  requireIncludesAll(document.tags ?? [], assertions.required_tags ?? [], "required adapter document missing tag");
  for (const [key, value] of Object.entries(assertions.required_metadata ?? {})) {
    requireEqual(document.metadata?.[key], value, `required adapter document metadata ${key} mismatch`);
  }

  const activeDocumentIds = new Set(simulation.documents.map((item) => item.document_id));
  for (const forbiddenDocumentId of assertions.forbidden_document_ids ?? []) {
    if (activeDocumentIds.has(forbiddenDocumentId)) {
      fail(`forbidden document still active in adapter: ${forbiddenDocumentId}`);
    }
  }

  const traceIds = simulation.traces.map((trace) => trace.trace_id);
  requireIncludesAll(traceIds, assertions.required_trace_ids ?? [], "missing adapter trace");

  const evidence = list(fixture.valid, "answer_evidence").find((item) => item.answer_id === expectedEvidence.answer_id);
  if (!evidence) {
    fail(`missing expected answer evidence: ${expectedEvidence.answer_id}`);
    return;
  }
  requireEqual(evidence, expectedEvidence, "answer evidence mismatch");

  const recallResult = simulation.recall_results.find((item) => item.policy_id === evidence.policy_id);
  if (!recallResult) {
    fail(`missing recall result for answer evidence policy: ${evidence.policy_id}`);
    return;
  }
  requireIncludesAll(recallResult.document_ids ?? [], evidence.used_document_ids ?? [], "answer evidence used unreturned document");
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
  const errors = validateAdapterContract(invalidCase.input);
  if (errors.length !== 1 || errors[0] !== invalidCase.expected_error) {
    fail(`${invalidCase.id} expected ${invalidCase.expected_error}, got ${errors.length ? errors.join(",") : "no_error"}`);
  }
}

const validErrors = validateAdapterContract(fixture.valid);
if (validErrors.length > 0) {
  fail(`valid case failed: ${validErrors.join(",")}`);
}

verifyExpectedOutputs(fixture, assertions);

if (!process.exitCode) {
  console.log(`PASS ${fixture.case_id}: minimal Hindsight adapter contract is valid`);
}
