import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createCodexArchiveStore } from "./codex-archive-store.mjs";
import { validateCodexEventEnvelope } from "./codex-event-envelope.mjs";
import { canonicalJson } from "./codex-redaction.mjs";
import { createCodexWorkspaceStore } from "./codex-workspace-store.mjs";

const EVENT_ID = /^evt_[0-9a-f]{64}$/;
const TURN_SNAPSHOT_ID = /^tsnap_[0-9a-f]{64}$/;
const FILE_SNAPSHOT_ID = /^snap_[0-9a-f]{64}$/;

export class CodexMemoryGovernanceError extends Error {
  constructor(code) {
    super(code);
    this.name = "CodexMemoryGovernanceError";
    this.code = code;
  }
}

function fail(code) {
  throw new CodexMemoryGovernanceError(code);
}

function safeWalk(root, select) {
  if (!fs.existsSync(root)) return [];
  const results = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("evidence_path_invalid");
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && select(target, entry.name)) results.push(target);
    }
  };
  visit(root);
  return results;
}

function readJson(filePath, code) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail(code);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof CodexMemoryGovernanceError) throw error;
    fail(code);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function defaultEvidenceResolver(vaultRoot, workspaceId) {
  const eventRoot = path.join(vaultRoot, "00_inbox", "codex-events");
  const snapshotRoot = path.join(vaultRoot, "00_inbox", "snapshots");

  const eventIndex = () => {
    const found = new Map();
    for (const filePath of safeWalk(eventRoot, (_target, name) => name === "events.jsonl")) {
      const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          fail("evidence_journal_invalid");
        }
        if (
          record?.schema !== "supermemory.codex-journal-record.v1" ||
          record.applied !== true ||
          record.durable !== true
        ) fail("evidence_journal_invalid");
        let envelope;
        try {
          envelope = validateCodexEventEnvelope(record.envelope);
        } catch {
          fail("evidence_journal_invalid");
        }
        if (envelope?.workspace_id === workspaceId && EVENT_ID.test(String(envelope.event_id))) {
          found.set(envelope.event_id, envelope);
        }
      }
    }
    return found;
  };

  const turnSnapshot = (turnSnapshotId) => {
    const hash = turnSnapshotId.slice("tsnap_".length);
    const target = path.join(snapshotRoot, "turns", hash.slice(0, 2), `${turnSnapshotId}.json`);
    if (!fs.existsSync(target)) return null;
    const value = readJson(target, "turn_snapshot_invalid");
    const manifest = { ...value };
    delete manifest.turn_snapshot_id;
    delete manifest.manifest_hash;
    const expectedHash = `sha256:${sha256(canonicalJson(manifest))}`;
    if (
      value.workspace_id !== workspaceId ||
      value.turn_snapshot_id !== turnSnapshotId ||
      value.manifest_hash !== expectedHash ||
      turnSnapshotId !== `tsnap_${expectedHash.slice("sha256:".length)}`
    ) return null;
    return value;
  };

  const fileSnapshot = (snapshotId) => {
    const hash = snapshotId.slice("snap_".length);
    const target = path.join(snapshotRoot, "files", hash.slice(0, 2), `${snapshotId}.json`);
    if (!fs.existsSync(target)) return null;
    const value = readJson(target, "source_snapshot_invalid");
    const body = { ...value };
    delete body.snapshot_id;
    if (
      value.workspace_id !== workspaceId ||
      value.snapshot_id !== snapshotId ||
      snapshotId !== `snap_${sha256(canonicalJson(body))}`
    ) return null;
    return value;
  };

  return {
    verify({ eventIds, turnSnapshotId, sourceSnapshotIds }) {
      const events = eventIndex();
      const missing = [];
      for (const eventId of eventIds) {
        if (!EVENT_ID.test(String(eventId)) || !events.has(eventId)) missing.push(eventId);
      }
      if (
        !TURN_SNAPSHOT_ID.test(String(turnSnapshotId)) ||
        !turnSnapshot(turnSnapshotId)
      ) missing.push(turnSnapshotId);
      for (const snapshotId of sourceSnapshotIds) {
        if (!FILE_SNAPSHOT_ID.test(String(snapshotId)) || !fileSnapshot(snapshotId)) {
          missing.push(snapshotId);
        }
      }
      return { valid: missing.length === 0, missing };
    }
  };
}

export function createCodexMemoryGovernance({
  vaultRoot,
  workspaceId,
  projectId,
  encryptionKey,
  projection = null,
  evidenceResolver = null,
  admissionMode = "legacy_manual",
  admissionPolicy = null,
  clock = () => new Date().toISOString()
} = {}) {
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const archives = createCodexArchiveStore({
    vaultRoot: vault,
    workspaceId,
    projectId,
    encryptionKey,
    clock
  });
  const workspace = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId,
    projectId,
    projection,
    admissionMode,
    admissionPolicy,
    clock
  });
  const evidence = evidenceResolver ?? defaultEvidenceResolver(vault, workspaceId);

  const verifyEvidence = ({ eventIds, turnSnapshotId, sourceSnapshotIds = [] }) => {
    if (!Array.isArray(eventIds) || eventIds.length === 0 || !Array.isArray(sourceSnapshotIds)) {
      fail("candidate_missing_evidence");
    }
    const verified = evidence.verify({ eventIds, turnSnapshotId, sourceSnapshotIds });
    if (!verified?.valid) {
      const error = new CodexMemoryGovernanceError("candidate_missing_evidence");
      error.missing = verified?.missing ?? [];
      throw error;
    }
    return true;
  };

  const archiveTurn = ({
    sessionId,
    turnId,
    visibleMessages,
    toolEventIds,
    turnSnapshotId,
    classification,
    retentionClass,
    expiresAt
  } = {}) => {
    verifyEvidence({
      eventIds: toolEventIds,
      turnSnapshotId,
      sourceSnapshotIds: []
    });
    return archives.createArchive({
      sessionId,
      turnId,
      visibleMessages,
      toolEvents: toolEventIds,
      turnSnapshotId,
      classification,
      retentionClass,
      expiresAt
    });
  };

  const createCandidate = ({
    archiveId,
    eventIds,
    turnSnapshotId,
    sourceSnapshotIds = [],
    title,
    proposedText,
    type = "durable_fact",
    confidence,
    uncertainty = "",
    sensitivity = "standard",
    extractor,
    dedupeKey = null
  } = {}) => {
    const archive = archives.getMetadata(archiveId);
    verifyEvidence({ eventIds, turnSnapshotId, sourceSnapshotIds });
    if (archive.turn_snapshot_id !== turnSnapshotId) fail("candidate_archive_evidence_mismatch");
    const archiveEvents = new Set(archive.tool_event_ids);
    if (eventIds.some((eventId) => !archiveEvents.has(eventId))) {
      fail("candidate_archive_evidence_mismatch");
    }
    return workspace.createCandidate({
      workspace_id: workspaceId,
      project_id: projectId,
      archive_id: archiveId,
      event_ids: eventIds,
      turn_snapshot_id: turnSnapshotId,
      source_snapshot_ids: sourceSnapshotIds,
      title,
      proposed_text: proposedText,
      type,
      confidence,
      uncertainty,
      sensitivity,
      extractor,
      dedupe_key: dedupeKey
    });
  };

  return {
    workspaceId,
    projectId,
    archives,
    workspace,
    workspace,
    verifyEvidence,
    archiveTurn,
    createCandidate,
    admitCandidate: workspace.admitCandidate,
    listCandidates: workspace.listCandidates,
    reviewCandidate: workspace.reviewCandidate,
    listActiveMemories: workspace.listActiveMemories,
    getMemory: workspace.getMemory,
    revokeMemory: workspace.revokeMemory,
    invalidateEvidence: workspace.invalidateEvidence,
    legacyCompatibility: workspace.legacyCompatibility
  };
}
