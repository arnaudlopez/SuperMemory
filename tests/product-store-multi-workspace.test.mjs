import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexWorkspaceStore } from "../scripts/lib/codex-workspace-store.mjs";
import { createProductStore } from "../scripts/lib/product-store.mjs";
import { createMemoryAdmissionPolicy } from "../scripts/lib/memory-admission-policy.mjs";

const PROJECT_A = "prj_018f1234-5678-7abc-8def-0123456789a1";
const PROJECT_B = "prj_018f1234-5678-7abc-8def-0123456789b1";
const WORKSPACE_A = "ws_018f1234-5678-7abc-8def-0123456789a2";
const WORKSPACE_B = "ws_018f1234-5678-7abc-8def-0123456789b2";
const EVENT_ID = `evt_${"1".repeat(64)}`;
const TURN_SNAPSHOT_ID = `tsnap_${"2".repeat(64)}`;
const FILE_SNAPSHOT_ID = `snap_${"3".repeat(64)}`;
const NOW = "2026-07-24T17:00:00.000Z";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-multi-workspace-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault };
}

function input(workspaceId, projectId, suffix) {
  return {
    workspace_id: workspaceId,
    project_id: projectId,
    archive_id: `arc_018f1234-5678-7abc-8def-0123456789${suffix}`,
    event_ids: [EVENT_ID],
    turn_snapshot_id: TURN_SNAPSHOT_ID,
    source_snapshot_ids: [FILE_SNAPSHOT_ID],
    title: "Shared-looking decision",
    proposed_text: "The same text must stay scoped.",
    type: "decision",
    confidence: 0.9,
    uncertainty: "",
    sensitivity: "standard",
    extractor: { model: "fixture", prompt_version: "v1" }
  };
}

test("workspace stores are physically isolated and reject cross-workspace identifiers", async (t) => {
  const { vault } = fixture(t);
  const a = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_A,
    projectId: PROJECT_A,
    clock: () => NOW
  });
  const b = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_B,
    projectId: PROJECT_B,
    clock: () => NOW
  });
  const candidateA = a.createCandidate(input(WORKSPACE_A, PROJECT_A, "a3"));
  const candidateB = b.createCandidate(input(WORKSPACE_B, PROJECT_B, "b3"));
  assert.notEqual(candidateA.candidate_id, candidateB.candidate_id);

  const approved = await a.reviewCandidate(candidateA.candidate_id, { action: "approve" });
  assert.equal(a.listActiveMemories({ consumer: "codex" }).length, 1);
  assert.deepEqual(b.listActiveMemories({ consumer: "codex" }), []);
  assert.throws(() => b.getCandidate(candidateA.candidate_id), (error) => (
    error.code === "candidate_not_found"
  ));
  assert.throws(() => b.getMemory(approved.memory.memory_id), (error) => (
    error.code === "memory_not_active"
  ));
  assert.ok(a.paths.statePath.includes(WORKSPACE_A));
  assert.ok(b.paths.statePath.includes(WORKSPACE_B));
  assert.notEqual(a.paths.candidateRoot, b.paths.candidateRoot);
  assert.notEqual(a.paths.memoryRoot, b.paths.memoryRoot);
});

test("legacy v1 product state is detected and byte-for-byte preserved", (t) => {
  const { vault } = fixture(t);
  const legacyRoot = path.join(vault, "00_inbox", "supermemory-product");
  fs.mkdirSync(legacyRoot, { recursive: true });
  const legacyPath = path.join(legacyRoot, "state.json");
  const legacyBytes = Buffer.from(`${JSON.stringify({
    version: 1,
    workspace: {
      workspaceId: "workspace:local",
      folderName: "legacy",
      createdAt: NOW,
      updatedAt: NOW
    },
    sources: [],
    snapshots: [],
    candidates: [],
    memories: [],
    deletions: []
  }, null, 2)}\n`);
  fs.writeFileSync(legacyPath, legacyBytes, { mode: 0o600 });
  const before = crypto.createHash("sha256").update(fs.readFileSync(legacyPath)).digest("hex");
  const store = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_A,
    projectId: PROJECT_A,
    clock: () => NOW
  });
  const compatibility = store.legacyCompatibility();
  const after = crypto.createHash("sha256").update(fs.readFileSync(legacyPath)).digest("hex");
  assert.equal(compatibility.status, "preserved_v1");
  assert.equal(compatibility.workspace_id, "workspace:local");
  assert.equal(compatibility.mutated, false);
  assert.equal(before, after);
});

test("new Codex stores require explicit opaque project and workspace scope", (t) => {
  const { vault } = fixture(t);
  assert.throws(() => createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: "workspace:local",
    projectId: PROJECT_A
  }), (error) => error.code === "scope_unresolved");
  assert.throws(() => createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_A
  }), (error) => error.code === "project_scope_invalid");
});

test("product automatic mode admits verified blocks without review and isolates pending outages", async (t) => {
  const { vault } = fixture(t);
  let available = true;
  const store = createProductStore({
    vaultRoot: vault,
    workspaceId: "workspace:automatic",
    admissionMode: "automatic",
    clock: () => NOW,
    verifier: {
      async verify({ workspaceId }) {
        if (!available) throw new Error("offline");
        return {
          status: "verified",
          verifier: { provider: "fixture", model: "verifier-v1", prompt_version: "verify-v1", independent: true },
          signals: {
            evidence_entailment: 0.99,
            source_trust: 0.98,
            extraction_agreement: 0.96,
            scope_valid: workspaceId === "workspace:automatic",
            ontology_compatible: true,
            contradiction_risk: 0
          }
        };
      }
    }
  });
  const first = await store.ingest({
    folderName: "Automatic",
    files: [{ relativePath: "Automatic/decision.md", text: "# Decision\nUse verified rollback plans." }]
  });
  assert.equal(first.summary.admission.auto_activate, 1);
  assert.equal(store.listMemories().length, 1);
  assert.equal(store.listCandidates("auto_activate").length, 1);
  const candidate = store.listCandidates("auto_activate")[0];
  const replay = await store.admitCandidate(candidate.candidateId, { verification: null });
  assert.equal(replay.memory.memoryId, store.listMemories()[0].memoryId);
  assert.equal(store.listMemories().length, 1);

  available = false;
  const second = await store.ingest({
    folderName: "Automatic",
    files: [{ relativePath: "Automatic/outage.md", text: "# Outage\nThis waits for verification." }]
  });
  assert.equal(second.summary.admission.pending_verification, 1);
  assert.equal(store.listCandidates("pending_verification").length, 1);
  assert.equal(store.listMemories().length, 1);
  await assert.rejects(
    store.reviewCandidate(store.listCandidates("pending_verification")[0].candidateId, { action: "approve" }),
    (error) => error.code === "review_reserved_for_quarantine"
  );
});

test("TTL admissions expire from recall automatically", async (t) => {
  const { vault } = fixture(t);
  let now = "2026-07-24T17:00:00.000Z";
  const store = createProductStore({
    vaultRoot: vault,
    workspaceId: "workspace:ttl",
    admissionMode: "automatic",
    clock: () => now,
    admissionPolicy: createMemoryAdmissionPolicy({
      clock: () => now,
      thresholds: { ttl_ms: 1_000 }
    }),
    verifier: {
      async verify() {
        return {
          status: "verified",
          verifier: { provider: "fixture", model: "verifier-v1", prompt_version: "verify-v1", independent: true },
          signals: {
            evidence_entailment: 0.85,
            source_trust: 0.8,
            extraction_agreement: 0.9,
            scope_valid: true,
            ontology_compatible: true,
            contradiction_risk: 0,
            temporary: true
          }
        };
      }
    }
  });
  const ingested = await store.ingest({
    folderName: "TTL",
    files: [{ relativePath: "TTL/status.md", text: "# Status\nTemporary launch status is amber." }]
  });
  assert.equal(ingested.summary.admission.activate_ttl, 1);
  assert.equal((await store.search("launch status")).results.length, 1);
  now = "2026-07-24T17:00:02.000Z";
  assert.equal((await store.search("launch status")).results.length, 0);
  assert.equal(store.listMemories()[0].status, "expired");
});
