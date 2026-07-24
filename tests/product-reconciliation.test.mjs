import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSuperMemoryServer } from "../scripts/supermemory-app.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function request(baseUrl, pathname, body = null, method = "POST") {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, body: await response.json() };
}

function textFile(relativePath, text) {
  return {
    relativePath,
    name: path.posix.basename(relativePath),
    text
  };
}

test("complete folder reconciliation suspends, restores, confirms purge, and retries Hindsight deletion", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-reconcile-"));
  const vaultRoot = path.join(tempRoot, "vault");
  let deleteAvailable = false;
  let recalledMemoryId = null;
  const deleteCalls = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith("/health")) return jsonResponse({ status: "healthy" });
    if (url.endsWith("/memories") && init.method === "POST") return jsonResponse({ success: true });
    if (url.includes("/documents/") && init.method === "GET") {
      return jsonResponse({ memory_unit_count: 1 });
    }
    if (url.includes("/documents/") && init.method === "DELETE") {
      deleteCalls.push(decodeURIComponent(url.split("/").at(-1)));
      if (!deleteAvailable) throw new Error("Hindsight unavailable");
      return jsonResponse({ success: true });
    }
    if (url.endsWith("/memories/recall")) {
      return jsonResponse({
        results: recalledMemoryId
          ? [{ relevance: 0.9, metadata: { memory_id: recalledMemoryId } }]
          : []
      });
    }
    return jsonResponse({});
  };
  const hindsightOptions = {
    bankId: "reconciliation-test",
    fetchImpl,
    timeoutMs: 500
  };
  let app = createSuperMemoryServer({ vaultRoot, hindsightOptions });
  let runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const removedText = "La preuve unique à purger indique un lancement mardi.";
  const keptText = "La source conservée indique un atelier vendredi.";
  const allFiles = [
    textFile("Equipe/a-supprimer.txt", removedText),
    textFile("Equipe/a-garder.txt", keptText)
  ];
  const initial = await request(runtime.url, "/api/ingest", {
    folderName: "Equipe",
    files: allFiles,
    inventoryComplete: true
  });
  assert.equal(initial.response.status, 201);
  assert.equal(initial.body.summary.inventoryComplete, true);
  assert.equal(initial.body.summary.createdSources, 2);

  const candidates = await request(runtime.url, "/api/candidates?status=pending", null, "GET");
  const removedCandidate = candidates.body.candidates.find((item) => item.text.includes("preuve unique"));
  const keptCandidate = candidates.body.candidates.find((item) => item.text.includes("atelier vendredi"));
  const removedApproval = await request(
    runtime.url,
    `/api/candidates/${encodeURIComponent(removedCandidate.candidateId)}/review`,
    { action: "approve" }
  );
  await request(
    runtime.url,
    `/api/candidates/${encodeURIComponent(keptCandidate.candidateId)}/review`,
    { action: "approve" }
  );
  recalledMemoryId = removedApproval.body.memory.memoryId;
  assert.equal(removedApproval.body.memory.projection.status, "synced");

  const statePath = path.join(vaultRoot, "00_inbox", "supermemory-product", "state.json");
  const beforeRemoval = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const removedMemoryPath = path.join(vaultRoot, removedApproval.body.memory.memoryPath);
  const removedSnapshots = beforeRemoval.snapshots.filter(
    (item) => item.sourceId === removedCandidate.sourceId
  );
  assert.equal(fs.existsSync(removedMemoryPath), true);
  assert.equal(removedSnapshots.length, 1);

  const failedInventory = await request(runtime.url, "/api/ingest", {
    folderName: "Equipe",
    files: [
      allFiles[1],
      {
        relativePath: "Equipe/casse.pdf",
        name: "casse.pdf",
        base64: Buffer.from("broken").toString("base64")
      }
    ],
    inventoryComplete: true
  });
  assert.equal(failedInventory.response.status, 422);
  const afterFailedInventory = await request(runtime.url, "/api/sources", null, "GET");
  assert.ok(afterFailedInventory.body.sources.every((source) => source.status === "active"));

  const missing = await request(runtime.url, "/api/ingest", {
    folderName: "Equipe",
    files: [allFiles[1]],
    inventoryComplete: true
  });
  assert.equal(missing.body.summary.missingSources, 1);
  const stagedSources = await request(runtime.url, "/api/sources", null, "GET");
  const staged = stagedSources.body.sources.find((source) => source.sourceId === removedCandidate.sourceId);
  assert.equal(staged.status, "pending_removal");
  assert.equal(staged.removalReason, "missing_from_inventory");
  const hiddenSearch = await request(runtime.url, "/api/search", { query: "preuve unique mardi" });
  assert.equal(hiddenSearch.body.results.length, 0);

  const restored = await request(runtime.url, "/api/ingest", {
    folderName: "Equipe",
    files: allFiles,
    inventoryComplete: true
  });
  assert.equal(restored.body.summary.restoredSources, 1);
  assert.equal(restored.body.summary.createdCandidates, 0);
  const restoredSearch = await request(runtime.url, "/api/search", { query: "preuve unique mardi" });
  assert.equal(restoredSearch.body.results[0].memoryId, recalledMemoryId);

  await request(runtime.url, "/api/ingest", {
    folderName: "Equipe",
    files: [allFiles[1]],
    inventoryComplete: true
  });
  const badConfirmation = await request(
    runtime.url,
    `/api/sources/${encodeURIComponent(removedCandidate.sourceId)}/removal`,
    { action: "confirm", confirmation: "wrong/path.txt" }
  );
  assert.equal(badConfirmation.response.status, 400);
  assert.equal(badConfirmation.body.error.code, "deletion_confirmation_invalid");
  assert.equal(fs.existsSync(removedMemoryPath), true);

  const confirmed = await request(
    runtime.url,
    `/api/sources/${encodeURIComponent(removedCandidate.sourceId)}/removal`,
    { action: "confirm", confirmation: "Equipe/a-supprimer.txt" }
  );
  assert.equal(confirmed.response.status, 200);
  assert.deepEqual(confirmed.body.purged, { candidates: 1, memories: 1, snapshots: 1 });
  assert.deepEqual(confirmed.body.hindsight, { deleted: 0, pending: 1 });
  assert.equal(fs.existsSync(removedMemoryPath), false);
  for (const snapshot of removedSnapshots) {
    assert.equal(fs.existsSync(path.join(vaultRoot, snapshot.artifactPath)), false);
  }
  const purgedStateText = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(purgedStateText, /preuve unique à purger/);
  const purgedState = JSON.parse(purgedStateText);
  assert.ok(purgedState.deletions.every((item) => !Object.hasOwn(item, "text")));
  assert.equal(purgedState.deletions[0].status, "pending");

  const afterDeleteSearch = await request(runtime.url, "/api/search", { query: "preuve unique mardi" });
  assert.equal(afterDeleteSearch.body.results.length, 0);

  await app.stop();
  app = createSuperMemoryServer({ vaultRoot, hindsightOptions });
  runtime = await app.start();
  const restartedStatus = await request(runtime.url, "/api/status", null, "GET");
  assert.equal(restartedStatus.body.counts.pendingHindsightDeletions, 1);
  assert.equal(restartedStatus.body.counts.approvedMemories, 1);

  deleteAvailable = true;
  const retried = await request(runtime.url, "/api/hindsight/retry", {});
  assert.equal(retried.body.deleted, 1);
  assert.equal(retried.body.deletionsRemaining, 0);
  const callsAfterRetry = deleteCalls.length;
  const idempotentRetry = await request(runtime.url, "/api/hindsight/retry", {});
  assert.equal(idempotentRetry.body.deletionsAttempted, 0);
  assert.equal(deleteCalls.length, callsAfterRetry);

  const emptyInventory = await request(runtime.url, "/api/ingest", {
    folderName: "Equipe",
    files: [],
    inventoryComplete: true
  });
  assert.equal(emptyInventory.response.status, 201);
  assert.equal(emptyInventory.body.summary.missingSources, 1);
});
test("canonical deletion preserves a shared snapshot until its final reference is removed", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-shared-snapshot-"));
  const vaultRoot = path.join(tempRoot, "vault");
  const app = createSuperMemoryServer({
    vaultRoot,
    hindsightOptions: { enabled: false }
  });
  const runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const sharedText = "Contenu identique partagé entre deux sources.";
  await request(runtime.url, "/api/ingest", {
    folderName: "Partage",
    files: [
      textFile("Partage/un.txt", sharedText),
      textFile("Partage/deux.txt", sharedText)
    ],
    inventoryComplete: true
  });
  const statePath = path.join(vaultRoot, "00_inbox", "supermemory-product", "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(new Set(state.snapshots.map((snapshot) => snapshot.artifactPath)).size, 1);
  const artifactPath = path.join(vaultRoot, state.snapshots[0].artifactPath);
  assert.equal(fs.existsSync(artifactPath), true);

  const sources = await request(runtime.url, "/api/sources", null, "GET");
  for (const [index, source] of sources.body.sources.entries()) {
    await request(
      runtime.url,
      `/api/sources/${encodeURIComponent(source.sourceId)}/removal`,
      { action: "stage" }
    );
    await request(
      runtime.url,
      `/api/sources/${encodeURIComponent(source.sourceId)}/removal`,
      { action: "confirm", confirmation: source.relativePath }
    );
    assert.equal(fs.existsSync(artifactPath), index === 0);
  }
});
