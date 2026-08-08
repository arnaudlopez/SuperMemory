import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexCaptureStore } from "../scripts/lib/codex-capture-store.mjs";
import { createCodexArchiveStore } from "../scripts/lib/codex-archive-store.mjs";
import { createCodexMemoryGovernance } from "../scripts/lib/codex-memory-governance.mjs";
import { createTurnSnapshotStore } from "../scripts/lib/codex-turn-snapshot.mjs";

const KEY = Buffer.alloc(32, 0x51);
const OTHER_KEY = Buffer.alloc(32, 0x52);
const BINDING = {
  projectId: "prj_018f1234-5678-7abc-8def-0123456789ab",
  workspaceId: "ws_018f1234-5678-7abc-8def-0123456789ac",
  checkoutId: "co_018f1234-5678-7abc-8def-0123456789ad"
};
const NOW = "2026-07-24T16:00:00.000Z";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-governance-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault };
}

function findFile(root, suffix) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(target, suffix);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return target;
    }
  }
  return null;
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

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function evidence(vault) {
  const capture = createCodexCaptureStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    clock: () => NOW
  });
  const captured = capture.ingest({
    adapter: "app_server",
    adapter_version: "codex-cli 0.125.0",
    external_event_id: "fixture-item-1",
    project_id: BINDING.projectId,
    workspace_id: BINDING.workspaceId,
    checkout_id: BINDING.checkoutId,
    session_id: "ses_app_server:fixture",
    thread_id: "fixture",
    turn_id: "turn_app_server:fixture",
    item_id: "item-1",
    event_type: "assistant.completed",
    occurred_at: NOW,
    capture_level: "rich",
    sequence: 0,
    payload: { text: "Décision visible", authoritative: true }
  });
  const snapshots = createTurnSnapshotStore({
    vaultRoot: vault,
    fingerprintKey: KEY
  });
  const fileSnapshot = snapshots.createFileSnapshot({
    workspaceId: BINDING.workspaceId,
    turnId: "fixture",
    itemId: "item-1",
    filePath: "/private/project/architecture.md",
    beforeHash: null,
    afterHash: `sha256:${"a".repeat(64)}`
  });
  const turnSnapshot = snapshots.createTurnSnapshot({
    workspaceId: BINDING.workspaceId,
    turnId: "fixture",
    eventIds: [captured.eventId],
    fileSnapshotIds: [fileSnapshot.snapshotId],
    completion: "complete",
    completedAt: NOW
  });
  return {
    eventId: captured.eventId,
    fileSnapshotId: fileSnapshot.snapshotId,
    turnSnapshotId: turnSnapshot.turnSnapshotId
  };
}

test("archives are AEAD-only and creating one never activates memory", (t) => {
  const { vault } = fixture(t);
  const refs = evidence(vault);
  const governance = createCodexMemoryGovernance({
    vaultRoot: vault,
    workspaceId: BINDING.workspaceId,
    projectId: BINDING.projectId,
    encryptionKey: KEY,
    clock: () => NOW
  });
  const archive = governance.archiveTurn({
    sessionId: "fixture",
    turnId: "fixture",
    visibleMessages: [{ role: "assistant", text: "TOP SECRET VISIBLE FIXTURE" }],
    toolEventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId,
    classification: "restricted",
    retentionClass: "short"
  });
  assert.match(archive.archive_id, /^arc_/);
  assert.deepEqual(governance.listActiveMemories(), []);

  const archiveTree = path.join(vault, "00_inbox", "codex-archives", BINDING.workspaceId);
  const ciphertextPath = findFile(archiveTree, `${archive.archive_id}.json.aead`);
  assert.ok(ciphertextPath);
  const serialized = fs.readFileSync(ciphertextPath, "utf8");
  assert.equal(serialized.includes("TOP SECRET VISIBLE FIXTURE"), false);
  assert.equal(governance.archives.openArchive(archive.archive_id).content.visible_messages[0].text,
    "TOP SECRET VISIBLE FIXTURE");

  const wrongKeyStore = createCodexArchiveStore({
    vaultRoot: vault,
    workspaceId: BINDING.workspaceId,
    projectId: BINDING.projectId,
    encryptionKey: OTHER_KEY
  });
  assert.throws(() => wrongKeyStore.openArchive(archive.archive_id));
});

test("candidates require workspace-local evidence and rejected candidates never project", async (t) => {
  const { vault } = fixture(t);
  const refs = evidence(vault);
  let projected = 0;
  const governance = createCodexMemoryGovernance({
    vaultRoot: vault,
    workspaceId: BINDING.workspaceId,
    projectId: BINDING.projectId,
    encryptionKey: KEY,
    projection: {
      async project() {
        projected += 1;
        return { status: "synced" };
      }
    },
    clock: () => NOW
  });
  const archive = governance.archiveTurn({
    sessionId: "fixture",
    turnId: "fixture",
    visibleMessages: [{ role: "assistant", text: "Use PostgreSQL." }],
    toolEventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId
  });
  assert.throws(() => governance.createCandidate({
    archiveId: archive.archive_id,
    eventIds: [`evt_${"f".repeat(64)}`],
    turnSnapshotId: refs.turnSnapshotId,
    sourceSnapshotIds: [],
    title: "No proof",
    proposedText: "This must fail.",
    confidence: 0.9,
    extractor: { model: "fixture", prompt_version: "v1" }
  }), (error) => error.code === "candidate_missing_evidence");

  const candidate = governance.createCandidate({
    archiveId: archive.archive_id,
    eventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId,
    sourceSnapshotIds: [refs.fileSnapshotId],
    title: "Database decision",
    proposedText: "Use PostgreSQL for durable state.",
    confidence: 0.91,
    uncertainty: "Deployment sizing remains open.",
    extractor: { model: "fixture-extractor", prompt_version: "v1" }
  });
  assert.equal(candidate.status, "pending");
  assert.deepEqual(governance.listActiveMemories(), []);
  const rejected = await governance.reviewCandidate(candidate.candidate_id, { action: "reject" });
  assert.equal(rejected.status, "rejected");
  assert.equal(projected, 0);
  assert.deepEqual(governance.listActiveMemories(), []);
});

test("tampered content-addressed evidence cannot create a candidate", (t) => {
  const { vault } = fixture(t);
  const refs = evidence(vault);
  const governance = createCodexMemoryGovernance({
    vaultRoot: vault,
    workspaceId: BINDING.workspaceId,
    projectId: BINDING.projectId,
    encryptionKey: KEY,
    clock: () => NOW
  });
  const archive = governance.archiveTurn({
    sessionId: "fixture",
    turnId: "fixture",
    visibleMessages: [{ role: "assistant", text: "Visible." }],
    toolEventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId
  });
  const hash = refs.fileSnapshotId.slice("snap_".length);
  const target = path.join(
    vault,
    "00_inbox",
    "snapshots",
    "files",
    hash.slice(0, 2),
    `${refs.fileSnapshotId}.json`
  );
  const tampered = JSON.parse(fs.readFileSync(target, "utf8"));
  tampered.reason = "tampered";
  fs.writeFileSync(target, `${JSON.stringify(tampered)}\n`);
  assert.throws(() => governance.createCandidate({
    archiveId: archive.archive_id,
    eventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId,
    sourceSnapshotIds: [refs.fileSnapshotId],
    title: "Tampered",
    proposedText: "Must not pass.",
    confidence: 0.9,
    extractor: { model: "fixture", prompt_version: "v1" }
  }), (error) => error.code === "candidate_missing_evidence");
});

test("approval fsyncs canonical memory before projection and revocation blocks recall first", async (t) => {
  const { vault } = fixture(t);
  const refs = evidence(vault);
  let governance;
  let canonicalExistedDuringProjection = false;
  let absentDuringDeletion = false;
  const projection = {
    async project(memory) {
      const target = path.join(
        vault,
        "20_professional",
        "product-memories",
        BINDING.workspaceId,
        `${memory.memory_id}.json`
      );
      canonicalExistedDuringProjection = fs.existsSync(target);
      return { status: "synced", documentId: memory.memory_id };
    },
    async delete(memory) {
      absentDuringDeletion = governance.listActiveMemories()
        .every((entry) => entry.memory_id !== memory.memory_id);
      return { status: "deleted" };
    }
  };
  governance = createCodexMemoryGovernance({
    vaultRoot: vault,
    workspaceId: BINDING.workspaceId,
    projectId: BINDING.projectId,
    encryptionKey: KEY,
    projection,
    clock: () => NOW
  });
  const archive = governance.archiveTurn({
    sessionId: "fixture",
    turnId: "fixture",
    visibleMessages: [{ role: "assistant", text: "Use an append-only audit." }],
    toolEventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId
  });
  const candidate = governance.createCandidate({
    archiveId: archive.archive_id,
    eventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId,
    sourceSnapshotIds: [refs.fileSnapshotId],
    title: "Audit design",
    proposedText: "Keep the governance audit append-only.",
    confidence: 0.95,
    extractor: { model: "fixture-extractor", prompt_version: "v1" }
  });
  const approved = await governance.reviewCandidate(candidate.candidate_id, { action: "approve" });
  assert.equal(approved.status, "approved");
  assert.equal(canonicalExistedDuringProjection, true);
  assert.equal(approved.memory.status, "active");
  assert.equal(approved.memory.projection.status, "synced");
  assert.equal(governance.listActiveMemories({ consumer: "codex" }).length, 1);

  const revoked = await governance.revokeMemory(approved.memory.memory_id, {
    reason: "Owner superseded the decision."
  });
  assert.equal(revoked.status, "revoked");
  assert.equal(absentDuringDeletion, true);
  assert.deepEqual(governance.listActiveMemories({ consumer: "codex" }), []);
});

test("source invalidation supersedes candidates and excludes stale memory before projection retry", async (t) => {
  const { vault } = fixture(t);
  const refs = evidence(vault);
  let deletionAttempts = 0;
  const governance = createCodexMemoryGovernance({
    vaultRoot: vault,
    workspaceId: BINDING.workspaceId,
    projectId: BINDING.projectId,
    encryptionKey: KEY,
    projection: {
      async project(memory) {
        return { status: "synced", documentId: memory.memory_id };
      },
      async delete() {
        deletionAttempts += 1;
        const error = new Error("offline");
        error.code = "hindsight_unavailable";
        throw error;
      }
    },
    clock: () => NOW
  });
  const archive = governance.archiveTurn({
    sessionId: "fixture",
    turnId: "fixture",
    visibleMessages: [{ role: "assistant", text: "Versioned decision." }],
    toolEventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId
  });
  const candidate = governance.createCandidate({
    archiveId: archive.archive_id,
    eventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId,
    sourceSnapshotIds: [refs.fileSnapshotId],
    title: "Versioned decision",
    proposedText: "Use version one.",
    confidence: 0.9,
    extractor: { model: "fixture", prompt_version: "v1" }
  });
  const approved = await governance.reviewCandidate(candidate.candidate_id, {
    action: "approve"
  });
  const invalidated = await governance.invalidateEvidence({
    snapshotIds: [refs.fileSnapshotId]
  });
  assert.equal(invalidated.stale_memories, 1);
  assert.equal(invalidated.recall_allowed, false);
  assert.equal(deletionAttempts, 1);
  assert.deepEqual(governance.listActiveMemories({ consumer: "codex" }), []);
  assert.equal(
    governance.getMemory(approved.memory.memory_id, { includeInactive: true }).status,
    "stale"
  );
  assert.equal(governance.workspace.getCandidate(candidate.candidate_id).status, "superseded");
  assert.equal(
    governance.workspace.memoryEntry(approved.memory.memory_id).projection.status,
    "revocation_pending"
  );
});

test("automatic admission activates only independently verified candidates and is idempotent", async (t) => {
  const { vault } = fixture(t);
  const refs = evidence(vault);
  const projected = [];
  const governance = createCodexMemoryGovernance({
    vaultRoot: vault,
    workspaceId: BINDING.workspaceId,
    projectId: BINDING.projectId,
    encryptionKey: KEY,
    admissionMode: "automatic",
    projection: {
      async project(memory) {
        projected.push(memory.memory_id);
        return { status: "synced", documentId: memory.memory_id };
      }
    },
    clock: () => NOW
  });
  const archive = governance.archiveTurn({
    sessionId: "automatic",
    turnId: "fixture",
    visibleMessages: [{ role: "user", text: "Always require rollback evidence." }],
    toolEventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId
  });
  const candidate = governance.createCandidate({
    archiveId: archive.archive_id,
    eventIds: [refs.eventId],
    turnSnapshotId: refs.turnSnapshotId,
    sourceSnapshotIds: [refs.fileSnapshotId],
    title: "Rollback evidence",
    proposedText: "Production releases require rollback evidence.",
    confidence: 0.01,
    extractor: { model: "extractor-v1", prompt_version: "extract-v1" }
  });
  const outage = await governance.admitCandidate(candidate.candidate_id, {
    verification: { status: "unavailable" }
  });
  assert.equal(outage.status, "pending_verification");
  assert.deepEqual(governance.listActiveMemories(), []);
  await assert.rejects(
    () => governance.reviewCandidate(candidate.candidate_id, { action: "approve" }),
    (error) => error.code === "review_reserved_for_quarantine"
  );

  const verification = {
    status: "verified",
    verifier: {
      provider: "fixture",
      model: "independent-verifier-v1",
      prompt_version: "verify-v1",
      independent: true
    },
    signals: {
      evidence_entailment: 0.99,
      source_trust: 0.98,
      extraction_agreement: 0.95,
      scope_valid: true,
      ontology_compatible: true,
      contradiction_risk: 0
    }
  };
  const admitted = await governance.admitCandidate(candidate.candidate_id, { verification });
  const replay = await governance.admitCandidate(candidate.candidate_id, { verification });
  assert.equal(admitted.status, "auto_activate");
  assert.equal(admitted.memory.admission_id, admitted.admission.admission_id);
  assert.equal(replay.memory.memory_id, admitted.memory.memory_id);
  assert.equal(projected.length, 1);
  assert.equal(governance.listActiveMemories({ consumer: "codex" }).length, 1);
  assert.ok(fs.existsSync(path.join(
    governance.workspace.paths.admissionRoot,
    `${admitted.admission.admission_id}.json`
  )));

  const forgedMaterial = { ...admitted.admission, claim_id: "candidate:forged" };
  delete forgedMaterial.integrity_hash;
  delete forgedMaterial.admission_id;
  const forgedId = `adm_${digest(canonicalJson(forgedMaterial))}`;
  const forgedUnsigned = { ...forgedMaterial, admission_id: forgedId };
  const forged = {
    ...forgedUnsigned,
    integrity_hash: `sha256:${digest(canonicalJson(forgedUnsigned))}`
  };
  fs.writeFileSync(
    path.join(governance.workspace.paths.admissionRoot, `${forgedId}.json`),
    `${JSON.stringify(forged)}\n`,
    { mode: 0o600 }
  );
  const state = JSON.parse(fs.readFileSync(governance.workspace.paths.statePath, "utf8"));
  state.candidates[candidate.candidate_id].admission_id = forgedId;
  fs.writeFileSync(governance.workspace.paths.statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await assert.rejects(
    governance.admitCandidate(candidate.candidate_id, { verification }),
    (error) => error.code === "admission_artifact_invalid"
  );
});
