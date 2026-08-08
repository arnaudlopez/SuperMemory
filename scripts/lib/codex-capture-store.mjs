import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  assertPreparedCapture,
  createCodexEventEnvelope,
  payloadHash,
  validateCodexEventEnvelope
} from "./codex-event-envelope.mjs";
import {
  canonicalJson,
  openJsonAead,
  redactCodexPayload,
  sealJsonAead
} from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";
import { createCodexWorkingSetStore } from "./codex-working-set-store.mjs";
import { evaluateWorkingOffload } from "./codex-working-offload.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertKey(encryptionKey) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
    fail("capture_encryption_key_invalid");
  }
}

function realDirectory(requestedPath, code) {
  const resolved = path.resolve(requestedPath);
  if (!fs.existsSync(resolved)) fail(`${code}_missing`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${code}_invalid`);
  return fs.realpathSync(resolved);
}

function ensureSafeDirectory(root, relativeDirectory) {
  let current = root;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("capture_path_invalid");
    } else {
      fs.mkdirSync(next, { mode: 0o700 });
    }
    current = fs.realpathSync(next);
    const relative = path.relative(root, current);
    if (relative.startsWith("..") || path.isAbsolute(relative)) fail("capture_scope_escape");
    fs.chmodSync(current, 0o700);
  }
  return current;
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
    // File fsync + atomic rename is the portable durability baseline.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function atomicWrite(filePath, content) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("capture_path_invalid");
  }
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail("capture_journal_invalid");
  const content = fs.readFileSync(filePath, "utf8");
  return content.split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      fail("capture_journal_invalid");
    }
  });
}

function journalFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("capture_journal_invalid");
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name === "events.jsonl") result.push(entryPath);
    }
  };
  visit(root);
  return result.sort();
}

function validateJournalRecord(record) {
  if (record?.schema !== "supermemory.codex-journal-record.v1") fail("capture_journal_invalid");
  const envelope = validateCodexEventEnvelope(record.envelope);
  if (!["in_order", "gap", "out_of_order"].includes(record.order_status)) {
    fail("capture_journal_invalid");
  }
  if (!["rich", "standard", "partial"].includes(record.capture_coverage)) {
    fail("capture_journal_invalid");
  }
  if (record.applied !== true || record.durable !== true) fail("capture_journal_invalid");
  return { ...record, envelope };
}

function eventDatePath(root, occurredAt) {
  const date = new Date(occurredAt);
  if (!Number.isFinite(date.getTime())) fail("capture_timestamp_invalid");
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const directory = ensureSafeDirectory(root, `${year}/${month}/${day}`);
  return path.join(directory, "events.jsonl");
}

function computeOrder(records, envelope) {
  const sessionRecords = records.filter((record) => (
    record.envelope.workspace_id === envelope.workspace_id &&
    record.envelope.session_id === envelope.session_id
  ));
  if (sessionRecords.length === 0) return "in_order";
  const maximum = Math.max(...sessionRecords.map((record) => record.envelope.sequence));
  if (envelope.sequence === maximum + 1) return "in_order";
  if (envelope.sequence > maximum + 1) return "gap";
  return "out_of_order";
}

function captureCoverage(envelope, orderStatus) {
  if (orderStatus !== "in_order" || envelope.capture_level === "backfill") return "partial";
  return envelope.capture_level;
}

function safeRedactionSummary(redaction) {
  return {
    profile: "redaction.v1",
    secret_fields: Number(redaction.findings?.secret_fields ?? 0),
    secret_matches: Object.fromEntries(Object.entries(redaction.findings?.secret_matches ?? {})
      .map(([key, value]) => [key, Number(value)])),
    path_matches: Number(redaction.findings?.path_matches ?? 0),
    truncated_strings: Number(redaction.findings?.truncated_strings ?? 0)
  };
}

export function prepareCodexCapture(input, {
  encryptionKey,
  observedAt = new Date().toISOString()
} = {}) {
  assertKey(encryptionKey);
  const redaction = redactCodexPayload(input?.payload ?? {}, { encryptionKey });
  const envelope = createCodexEventEnvelope({
    ...input,
    payload: redaction.payload,
    redaction_profile: redaction.profile
  }, { observedAt });
  return {
    schema: "supermemory.prepared-capture.v1",
    envelope,
    payload: redaction.payload,
    redaction
  };
}

export function createCodexCaptureStore({
  vaultRoot,
  encryptionKey,
  clock = () => new Date().toISOString(),
  workingMemory = null,
  workingSetStore = null
} = {}) {
  assertKey(encryptionKey);
  const vault = realDirectory(vaultRoot, "capture_vault");
  const eventRoot = path.join(vault, "00_inbox", "codex-events");
  const workingEnabled = workingMemory?.enabled === true || workingSetStore !== null;
  const workingStore = workingEnabled
    ? workingSetStore ?? createCodexWorkingSetStore({
      vaultRoot: vault,
      encryptionKey,
      capacityTokens: workingMemory?.capacityTokens ?? workingMemory?.capacity_tokens ?? 100_000,
      maxCompleteEventBytes: workingMemory?.maxCompleteEventBytes ?? workingMemory?.max_complete_event_bytes,
      clock
    })
    : null;

  const allRecords = () => journalFiles(eventRoot)
    .flatMap((filePath) => readJsonLines(filePath))
    .map(validateJournalRecord);

  const writePayload = (prepared, blobRoot) => {
    const hash = prepared.envelope.payload_hash.slice("sha256:".length);
    const directory = ensureSafeDirectory(blobRoot, hash.slice(0, 2));
    const blobPath = path.join(directory, `${hash}.json.aead`);
    const aad = `supermemory.payload.${prepared.envelope.payload_hash}`;
    if (fs.existsSync(blobPath)) {
      const existing = openJsonAead(JSON.parse(fs.readFileSync(blobPath, "utf8")), {
        encryptionKey,
        expectedAad: aad
      });
      if (payloadHash(existing) !== prepared.envelope.payload_hash) fail("capture_blob_collision");
      return blobPath;
    }
    const sealed = sealJsonAead(prepared.payload, { encryptionKey, aad });
    atomicWrite(blobPath, `${JSON.stringify(sealed)}\n`);
    return blobPath;
  };

  const commitPrepared = (candidate) => {
    const prepared = assertPreparedCapture(candidate);
    const rerun = redactCodexPayload(prepared.payload, { encryptionKey });
    if (canonicalJson(rerun.payload) !== canonicalJson(prepared.payload)) {
      fail("prepared_capture_not_redacted");
    }
    return withVaultMutationLock(vault, () => {
      const normalizedRoot = ensureSafeDirectory(vault, "00_inbox/codex-events");
      const blobRoot = ensureSafeDirectory(normalizedRoot, "blobs");
      const records = allRecords();
      const duplicate = records.find((record) => (
        record.envelope.event_id === prepared.envelope.event_id
      ));
      if (duplicate) {
        if (
          duplicate.envelope.payload_hash !== prepared.envelope.payload_hash ||
          duplicate.envelope.workspace_id !== prepared.envelope.workspace_id
        ) {
          fail("capture_event_id_collision");
        }
        return {
          status: "duplicate",
          eventId: duplicate.envelope.event_id,
          workspaceId: duplicate.envelope.workspace_id,
          durable: true,
          applied: false,
          orderStatus: duplicate.order_status,
          captureCoverage: duplicate.capture_coverage
        };
      }

      writePayload(prepared, blobRoot);
      const envelope = validateCodexEventEnvelope({
        ...prepared.envelope,
        payload_ref: `blob:${prepared.envelope.payload_hash}`
      });
      const orderStatus = computeOrder(records, envelope);
      const journalPath = eventDatePath(normalizedRoot, envelope.occurred_at);
      const currentDay = readJsonLines(journalPath).map(validateJournalRecord);
      const record = validateJournalRecord({
        schema: "supermemory.codex-journal-record.v1",
        envelope,
        order_status: orderStatus,
        capture_coverage: captureCoverage(envelope, orderStatus),
        redaction: safeRedactionSummary(prepared.redaction),
        applied: true,
        durable: true
      });
      atomicWrite(
        journalPath,
        [...currentDay, record].map((entry) => JSON.stringify(entry)).join("\n") + "\n"
      );
      return {
        status: "applied",
        eventId: envelope.event_id,
        workspaceId: envelope.workspace_id,
        durable: true,
        applied: true,
        orderStatus,
        captureCoverage: record.capture_coverage
      };
    });
  };

  const projectWorkingMemory = (prepared, captureResult) => {
    if (!workingStore) return captureResult;
    try {
      const record = allRecords().find((item) => item.envelope.event_id === prepared.envelope.event_id);
      if (!record) fail("working_source_record_missing");
      const admitted = workingStore.admit({
        record,
        payload: prepared.payload,
        forkedFromWorkingSetId: workingMemory?.forkedFromWorkingSetId ?? workingMemory?.forked_from_working_set_id ?? null,
        forkedFromSessionId: workingMemory?.forkedFromSessionId ?? workingMemory?.forked_from_session_id ?? null,
        forkIdentity: workingMemory?.forkIdentity ?? workingMemory?.fork_identity ?? null
      });
      const entry = admitted.entry;
      let reopenVerified = false;
      if (entry) {
        const reopened = workingStore.openEvidence({
          workspaceId: prepared.envelope.workspace_id,
          projectId: prepared.envelope.project_id,
          sessionId: prepared.envelope.session_id,
          workingSetId: admitted.state.manifest.working_set_id,
          evidenceId: entry.evidence_id,
          captureStore: { readEvents }
        });
        const reopenedEpisode = workingStore.readEpisode({
          workspaceId: prepared.envelope.workspace_id,
          projectId: prepared.envelope.project_id,
          sessionId: prepared.envelope.session_id,
          workingSetId: admitted.state.manifest.working_set_id,
          evidenceId: entry.evidence_id,
          episodeId: admitted.episode.episode_id
        });
        reopenVerified = payloadHash(reopened.payload) === entry.content_hash &&
          reopenedEpisode.content_hash === entry.content_hash &&
          reopenedEpisode.evidence_ids.includes(entry.evidence_id);
      }
      const working = {
        working_set_id: admitted.state.manifest.working_set_id,
        evidence_id: entry?.evidence_id ?? null,
        episode_id: admitted.episode?.episode_id ?? null,
        admitted: entry?.status === "selected",
        durable: Boolean(entry && reopenVerified),
        complete: entry?.complete === true,
        reopen_verified: reopenVerified,
        capture_coverage: record.capture_coverage,
        state: admitted.state.manifest.state,
        token_estimate: entry?.token_estimate ?? 0
      };
      const offload = evaluateWorkingOffload({
        ...working,
        tool_name: prepared.payload?.tool_name ?? null,
        status: entry?.status ?? "metadata_only"
      }, {
        enabled: workingMemory?.offload?.enabled === true,
        replacementSupported: workingMemory?.offload?.replacementSupported === true ||
          workingMemory?.offload?.replacement_supported === true,
        thresholdTokens: workingMemory?.offload?.thresholdTokens ?? workingMemory?.offload?.threshold_tokens,
        allowedTools: workingMemory?.offload?.allowedTools ?? workingMemory?.offload?.allowed_tools
      });
      working.offload = offload;
      working.offload_eligible = offload.eligible;
      return { ...captureResult, stored: true, working };
    } catch (error) {
      return {
        ...captureResult,
        stored: true,
        working: {
          working_set_id: null,
          evidence_id: null,
          episode_id: null,
          admitted: false,
          durable: false,
          complete: false,
          reopen_verified: false,
          capture_coverage: captureResult.captureCoverage ?? "partial",
          state: "degraded",
          offload_eligible: false,
          error: error?.code ?? error?.message ?? "working_projection_failed"
        }
      };
    }
  };

  const ingestPrepared = (candidate) => {
    const prepared = assertPreparedCapture(candidate);
    return projectWorkingMemory(prepared, commitPrepared(prepared));
  };

  const ingest = (input) => ingestPrepared(prepareCodexCapture(input, {
    encryptionKey,
    observedAt: clock()
  }));

  const readEvents = ({
    workspaceId,
    sessionId = null,
    includePayload = false
  } = {}) => {
    if (typeof workspaceId !== "string" || !workspaceId.startsWith("ws_")) {
      fail("scope_unresolved");
    }
    return allRecords().filter((record) => (
      record.envelope.workspace_id === workspaceId &&
      (!sessionId || record.envelope.session_id === sessionId)
    )).map((record) => {
      if (!includePayload) return record;
      const hash = record.envelope.payload_hash.slice("sha256:".length);
      const blobPath = path.join(eventRoot, "blobs", hash.slice(0, 2), `${hash}.json.aead`);
      const payload = openJsonAead(JSON.parse(fs.readFileSync(blobPath, "utf8")), {
        encryptionKey,
        expectedAad: `supermemory.payload.${record.envelope.payload_hash}`
      });
      return { ...record, payload };
    });
  };

  const stats = () => {
    const records = allRecords();
    return {
      events: records.length,
      workspaces: new Set(records.map((record) => record.envelope.workspace_id)).size,
      sessions: new Set(records.map((record) => (
        `${record.envelope.workspace_id}\0${record.envelope.session_id}`
      ))).size,
      gaps: records.filter((record) => record.order_status !== "in_order").length
    };
  };

  const listScopes = () => {
    const scopes = new Map();
    for (const record of allRecords()) {
      const { workspace_id: workspaceId, session_id: sessionId } = record.envelope;
      const key = `${workspaceId}\0${sessionId}`;
      if (!scopes.has(key)) scopes.set(key, { workspaceId, sessionId });
    }
    return [...scopes.values()].sort((left, right) => (
      left.workspaceId.localeCompare(right.workspaceId) ||
      left.sessionId.localeCompare(right.sessionId)
    ));
  };

  return {
    vaultRoot: vault,
    eventRoot,
    ingest,
    ingestPrepared,
    readEvents,
    listScopes,
    stats,
    workingStore
  };
}
