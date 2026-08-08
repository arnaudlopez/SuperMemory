import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createProductHindsight,
  ProductHindsightError
} from "../scripts/lib/product-hindsight.mjs";
import { createSuperMemoryServer } from "../scripts/supermemory-app.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function jsonRequest(baseUrl, pathname, body = null, method = "POST") {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, body: await response.json() };
}

function approvedMemory() {
  return {
    memoryId: "memory:approved-1",
    candidateId: "candidate:reviewed-1",
    sourceId: "source:local-1",
    snapshotId: "snap:sha256-1",
    relativePath: "Dossier/notes.md",
    title: "Décision produit",
    text: "Le lancement est fixé à mardi.",
    sourceKind: "md",
    sensitivity: "standard",
    workspaceId: "workspace:local",
    locator: { kind: "text_lines", lineStart: 2, lineEnd: 2 },
    projection: { documentId: "memory:approved-1" }
  };
}

test("product Hindsight refuses remote endpoints and uses strict local provenance", async () => {
  assert.throws(
    () => createProductHindsight({ baseUrl: "https://api.hindsight.vectorize.io" }),
    (error) => error instanceof ProductHindsightError && error.code === "hindsight_remote_forbidden"
  );

  const calls = [];
  const adapter = createProductHindsight({
    baseUrl: "http://127.0.0.1:8888",
    bankId: "product-test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith("/health")) return jsonResponse({ status: "healthy" });
      if (url.endsWith("/memories/recall")) {
        return jsonResponse({
          results: [{
            text: "Le lancement est mardi.",
            relevance: 0.92,
            metadata: { memory_id: "memory:approved-1" }
          }]
        });
      }
      return jsonResponse({ success: true });
    }
  });

  const status = await adapter.status();
  assert.equal(status.available, true);
  const projected = await adapter.project(approvedMemory());
  assert.equal(projected.documentId, "memory:approved-1");

  const retain = calls.find((call) => call.url.endsWith("/memories"));
  const item = retain.body.items[0];
  assert.equal(item.document_id, "memory:approved-1");
  assert.ok(item.tags.includes("workspace:workspace:local"));
  assert.ok(item.tags.includes("status:active"));
  assert.ok(item.tags.includes("consumer:supermemory"));
  assert.equal(item.metadata.memory_id, "memory:approved-1");
  assert.equal(item.metadata.snapshot_id, "snap:sha256-1");
  assert.ok(Object.values(item.metadata).every((value) => typeof value === "string"));
  assert.equal(retain.init.headers.Authorization, undefined);

  const recalled = await adapter.recall("Quand est le lancement ?");
  assert.deepEqual(recalled.results, [{ memoryId: "memory:approved-1", score: 0.92 }]);
  assert.equal(recalled.trace.tagsMatch, "all_strict");
  const recallCalls = calls.filter((call) => call.url.endsWith("/memories/recall"));
  assert.equal(recallCalls.length, 2);
  for (const call of recallCalls) {
    assert.equal(call.body.tags_match, "all_strict");
    for (const prefix of [
      "visibility:",
      "sensitivity:",
      "domain:",
      "entity_type:",
      "schema_status:",
      "workspace:",
      "access_policy:",
      "consumer:"
    ]) {
      assert.ok(call.body.tags.some((tag) => tag.startsWith(prefix)));
    }
    assert.ok(call.body.tags.includes("status:active"));
  }

  const emptyAdapter = createProductHindsight({
    bankId: "product-empty-extraction",
    fetchImpl: async (url) => url.includes("/documents/")
      ? jsonResponse({ memory_unit_count: 0 })
      : jsonResponse({ success: true })
  });
  await assert.rejects(
    emptyAdapter.project(approvedMemory()),
    (error) => error.code === "hindsight_projection_empty"
  );
});

test("automatic admission metadata survives Hindsight projection", async () => {
  let retained;
  const adapter = createProductHindsight({
    bankId: "product-admission",
    fetchImpl: async (url, init) => {
      if (url.endsWith("/memories")) retained = JSON.parse(init.body).items[0];
      if (url.includes("/documents/")) return jsonResponse({ memory_unit_count: 1 });
      return jsonResponse({ success: true });
    }
  });
  await adapter.project({
    ...approvedMemory(),
    admissionId: "adm_fixture",
    admissionDecision: "activate_ttl",
    admissionPolicyVersion: "admission-v1.0.0",
    validUntil: "2026-08-11T10:00:00.000Z"
  });
  assert.equal(retained.metadata.review_status, "admitted");
  assert.equal(retained.metadata.admission_id, "adm_fixture");
  assert.equal(retained.metadata.admission_decision, "activate_ttl");
  assert.equal(retained.metadata.admission_policy_version, "admission-v1.0.0");
  assert.equal(retained.metadata.valid_until, "2026-08-11T10:00:00.000Z");
});

test("web approval is canonical before projection, retries idempotently, and recalls cited memory", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-hindsight-product-"));
  const vaultRoot = path.join(tempRoot, "vault");
  let available = false;
  let retainedMemoryId = null;
  const documentIds = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/health")) {
      return available
        ? jsonResponse({ status: "healthy" })
        : jsonResponse({ status: "unavailable" }, 503);
    }
    if (!available) throw new Error("local Hindsight unavailable");
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.endsWith("/memories")) {
      retainedMemoryId = body.items[0].metadata.memory_id;
      documentIds.push(body.items[0].document_id);
      return jsonResponse({ success: true });
    }
    if (url.endsWith("/memories/recall")) {
      return jsonResponse({
        results: retainedMemoryId
          ? [{ relevance: 0.88, metadata: { memory_id: retainedMemoryId } }]
          : []
      });
    }
    return jsonResponse({});
  };
  const hindsightOptions = {
    baseUrl: "http://127.0.0.1:8888",
    bankId: "product-integration",
    fetchImpl,
    timeoutMs: 500
  };
  let app = createSuperMemoryServer({ vaultRoot, hindsightOptions });
  let runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const ingest = await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Dossier",
    files: [{
      relativePath: "Dossier/decision.md",
      name: "decision.md",
      text: "# Décision\nLe lancement gouverné est fixé à mardi.\n"
    }]
  });
  assert.equal(ingest.response.status, 201);
  const pending = await jsonRequest(runtime.url, "/api/candidates?status=pending", null, "GET");
  const candidate = pending.body.candidates[0];
  const approval = await jsonRequest(
    runtime.url,
    `/api/candidates/${encodeURIComponent(candidate.candidateId)}/review`,
    { action: "approve" }
  );
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.memory.status, "active");
  assert.equal(approval.body.memory.projection.status, "queued");
  assert.equal(fs.existsSync(path.join(vaultRoot, approval.body.memory.memoryPath)), true);

  const fallback = await jsonRequest(runtime.url, "/api/search", { query: "lancement mardi" });
  assert.equal(fallback.body.mode, "deterministic-local-fallback");
  assert.equal(fallback.body.hindsightUsed, false);
  assert.equal(fallback.body.results[0].citation.relativePath, "Dossier/decision.md");

  available = true;
  const retry = await jsonRequest(runtime.url, "/api/hindsight/retry", {});
  assert.deepEqual(retry.body, {
    status: "synced",
    attempted: 1,
    synced: 1,
    remaining: 0,
    deletionsAttempted: 0,
    deleted: 0,
    deletionsRemaining: 0
  });
  const secondRetry = await jsonRequest(runtime.url, "/api/hindsight/retry", {});
  assert.equal(secondRetry.body.attempted, 0);
  assert.equal(documentIds.length, 1);

  const recalled = await jsonRequest(runtime.url, "/api/search", { query: "lancement mardi" });
  assert.equal(recalled.body.mode, "hindsight-governed-recall");
  assert.equal(recalled.body.hindsightUsed, true);
  assert.equal(recalled.body.trace.tagsMatch, "all_strict");
  assert.equal(recalled.body.results[0].memoryId, approval.body.memory.memoryId);
  assert.equal(recalled.body.results[0].citation.lineStart, 2);

  await app.stop();
  app = createSuperMemoryServer({ vaultRoot, hindsightOptions });
  runtime = await app.start();
  const restarted = await jsonRequest(runtime.url, "/api/status", null, "GET");
  assert.equal(restarted.body.counts.syncedMemories, 1);
  assert.equal(restarted.body.counts.pendingProjections, 0);
  assert.equal(restarted.body.hindsight.status, "ready");
});

test("an empty Hindsight recall falls back explicitly to active canonical memory", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-hindsight-empty-"));
  const vaultRoot = path.join(tempRoot, "vault");
  const fetchImpl = async (url) => {
    if (url.endsWith("/health")) return jsonResponse({ status: "healthy" });
    if (url.endsWith("/memories/recall")) return jsonResponse({ results: [] });
    return jsonResponse({ success: true });
  };
  const app = createSuperMemoryServer({
    vaultRoot,
    hindsightOptions: {
      bankId: "product-empty-recall",
      fetchImpl
    }
  });
  const runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Fallback",
    files: [{
      relativePath: "Fallback/note.txt",
      name: "note.txt",
      text: "Le contrôle du fallback est prévu mercredi."
    }]
  });
  const pending = await jsonRequest(runtime.url, "/api/candidates?status=pending", null, "GET");
  await jsonRequest(
    runtime.url,
    `/api/candidates/${encodeURIComponent(pending.body.candidates[0].candidateId)}/review`,
    { action: "approve" }
  );
  const search = await jsonRequest(runtime.url, "/api/search", { query: "fallback mercredi" });
  assert.equal(search.body.mode, "deterministic-local-fallback");
  assert.equal(search.body.fallbackReason, "hindsight_no_reconciled_results");
  assert.equal(search.body.hindsightUsed, false);
  assert.equal(search.body.trace.tagsMatch, "all_strict");
  assert.equal(search.body.results.length, 1);
  assert.equal(search.body.results[0].citation.relativePath, "Fallback/note.txt");
});
