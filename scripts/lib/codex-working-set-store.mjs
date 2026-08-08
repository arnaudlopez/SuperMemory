import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { payloadHash, validateCodexEventEnvelope } from "./codex-event-envelope.mjs";
import { generateUuidV7 } from "./project-registry.mjs";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import { classifyWorkingEvent, selectWorkingEvidence } from "./codex-working-set-index.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";
import { legacyObservedEventTime } from "./codex-temporal-normalizer.mjs";

const WORKING_ID = /^wset_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_ID = /^wev_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EPISODE_ID = /^epi_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMISSION_ID = /^adm_[0-9a-f]{64}$/i;
const JOURNALS = Object.freeze({
  evidence: "entries.jsonl.aead",
  checkpoint: "checkpoints.jsonl.aead",
  tombstone: "tombstones.jsonl.aead"
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail("working_encryption_key_invalid");
}

function assertString(value, code) {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function assertId(value, pattern, code) {
  if (!pattern.test(String(value ?? ""))) fail(code);
  return value;
}

function safeSegment(value, code) {
  assertString(value, code);
  if (!/^[A-Za-z0-9._:-]{1,300}$/.test(value)) fail(code);
  return value;
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    safeSegment(segment, "working_path_invalid");
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("working_path_invalid");
    } else {
      fs.mkdirSync(next, { mode: 0o700 });
    }
    fs.chmodSync(next, 0o700);
    current = fs.realpathSync(next);
    const relativePath = path.relative(root, current);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) fail("working_scope_escape");
  }
  return current;
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
    // File fsync plus atomic rename is the portable durability baseline.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function atomicWrite(filePath, value) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("working_path_invalid");
  }
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function appendAndSync(filePath, line) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("working_journal_corrupt");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, "a", 0o600);
    fs.writeFileSync(descriptor, `${line}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  fs.chmodSync(filePath, 0o600);
  fsyncDirectory(path.dirname(filePath));
}

function scopeFrom(input, code = "working_scope_invalid") {
  return {
    workspaceId: safeSegment(input?.workspaceId ?? input?.workspace_id, code),
    projectId: safeSegment(input?.projectId ?? input?.project_id, code),
    sessionId: safeSegment(input?.sessionId ?? input?.session_id, code)
  };
}

function sameScope(left, right) {
  return left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.sessionId === right.sessionId;
}

function episodeKind(eventType) {
  if (eventType === "tool.completed") return "tool_result";
  if (eventType === "file.changed") return "document";
  return "interaction";
}

export function createCodexWorkingSetStore({
  vaultRoot,
  encryptionKey,
  capacityTokens = 100_000,
  maxCompleteEventBytes = 512 * 1024,
  clock = () => new Date().toISOString(),
  randomBytes = crypto.randomBytes,
  faultInjector = null
} = {}) {
  assertKey(encryptionKey);
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const rootRelative = "00_inbox/supermemory-product/codex-working-sets";
  const root = path.join(vault, rootRelative);
  const nowMs = () => {
    const value = Date.parse(clock());
    if (!Number.isSafeInteger(value)) fail("working_clock_invalid");
    return value;
  };
  const makeId = (prefix) => `${prefix}_${generateUuidV7({ now: nowMs(), randomBytes })}`;
  const inject = (point, value) => {
    if (typeof faultInjector === "function") faultInjector(point, value);
  };

  const directoryFor = (workspaceId, workingSetId, create = false) => {
    safeSegment(workspaceId, "working_set_unknown");
    assertId(workingSetId, WORKING_ID, "working_set_unknown");
    const relative = `${rootRelative}/${workspaceId}/${workingSetId}`;
    return create ? ensureDirectory(vault, relative) : path.join(vault, relative);
  };
  const journalPath = (workspaceId, workingSetId, journal) => path.join(
    directoryFor(workspaceId, workingSetId),
    JOURNALS[journal]
  );
  const manifestPath = (workspaceId, workingSetId) => path.join(
    directoryFor(workspaceId, workingSetId),
    "manifest.json.aead"
  );
  const derivedMapPath = (workspaceId, workingSetId) => path.join(
    directoryFor(workspaceId, workingSetId),
    "active-map.json.aead"
  );
  const purgeAttestationPath = (workspaceId, workingSetId, evidenceId) => path.join(
    directoryFor(workspaceId, workingSetId),
    `purge-${assertId(evidenceId, EVIDENCE_ID, "working_evidence_unknown")}.json.aead`
  );
  const frameAad = (journal, workingSetId, sequence, previousHash) => (
    `supermemory.working-frame.v1.${journal}.${workingSetId}.${sequence}.${previousHash}`
  );
  const manifestAad = (workspaceId, workingSetId) => (
    `supermemory.working-manifest.v1.${workspaceId}.${workingSetId}`
  );
  const admissionRevocationDirectory = (workspaceId, create = false) => {
    const workspace = safeSegment(workspaceId, "working_scope_invalid");
    const relative = `${rootRelative}/${workspace}/admission-revocations`;
    return create ? ensureDirectory(vault, relative) : path.join(vault, relative);
  };
  const admissionRevocationPath = (workspaceId, admissionId, create = false) => path.join(
    admissionRevocationDirectory(workspaceId, create),
    `${assertId(admissionId, ADMISSION_ID, "working_admission_invalid")}.json.aead`
  );
  const admissionRevocationAad = (workspaceId, admissionId) => (
    `supermemory.working-admission-revocation.v1.${workspaceId}.${admissionId}`
  );
  const readAdmissionRevocation = (workspaceId, admissionId) => {
    const workspace = safeSegment(workspaceId, "working_scope_invalid");
    const id = assertId(admissionId, ADMISSION_ID, "working_admission_invalid");
    try {
      const filePath = admissionRevocationPath(workspace, id);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) fail("working_admission_revocation_corrupt");
      const value = openJsonAead(JSON.parse(fs.readFileSync(filePath, "utf8")), {
        encryptionKey,
        expectedAad: admissionRevocationAad(workspace, id)
      });
      if (
        value?.schema !== "supermemory.working-admission-revocation.v1" ||
        value.workspace_id !== workspace || value.admission_id !== id ||
        !Number.isFinite(Date.parse(value.revoked_at))
      ) fail("working_admission_revocation_corrupt");
      return value;
    } catch (error) {
      if (error?.code === "working_admission_revocation_corrupt") throw error;
      fail("working_admission_revocation_corrupt");
    }
  };
  const recordAdmissionRevocation = ({
    workspaceId,
    workspace_id: snakeWorkspace,
    admissionId,
    admission_id: snakeAdmission,
    revokedAt,
    revoked_at: snakeRevokedAt
  } = {}) => withVaultMutationLock(vault, () => {
    const workspace = safeSegment(workspaceId ?? snakeWorkspace, "working_scope_invalid");
    const id = assertId(admissionId ?? snakeAdmission, ADMISSION_ID, "working_admission_invalid");
    const time = assertString(revokedAt ?? snakeRevokedAt ?? clock(), "working_admission_revocation_invalid");
    if (!Number.isFinite(Date.parse(time))) fail("working_admission_revocation_invalid");
    const filePath = admissionRevocationPath(workspace, id, true);
    if (fs.existsSync(filePath)) {
      const existing = readAdmissionRevocation(workspace, id);
      if (existing.revoked_at !== time) fail("working_admission_revocation_conflict");
      return existing;
    }
    const body = {
      schema: "supermemory.working-admission-revocation.v1",
      workspace_id: workspace,
      admission_id: id,
      revoked_at: time
    };
    atomicWrite(filePath, `${JSON.stringify(sealJsonAead(body, {
      encryptionKey,
      aad: admissionRevocationAad(workspace, id)
    }))}\n`);
    return readAdmissionRevocation(workspace, id);
  });
  const listRevokedAdmissions = ({ workspaceId, workspace_id: snakeWorkspace } = {}) => {
    const workspace = safeSegment(workspaceId ?? snakeWorkspace, "working_scope_invalid");
    const directory = admissionRevocationDirectory(workspace);
    if (!fs.existsSync(directory)) return [];
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("working_admission_revocation_corrupt");
    return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
      if (entry.isSymbolicLink() || !entry.isFile()) fail("working_admission_revocation_corrupt");
      const match = /^(adm_[0-9a-f]{64})\.json\.aead$/i.exec(entry.name);
      if (!match) fail("working_admission_revocation_corrupt");
      return readAdmissionRevocation(workspace, match[1]).admission_id;
    }).sort();
  };

  const readFrames = (workspaceId, workingSetId, journal) => {
    const filePath = journalPath(workspaceId, workingSetId, journal);
    if (!fs.existsSync(filePath)) return [];
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("working_journal_corrupt");
    const raw = fs.readFileSync(filePath, "utf8");
    if (raw.length > 0 && !raw.endsWith("\n")) fail("working_journal_corrupt");
    const lines = raw.split("\n").filter(Boolean);
    const result = [];
    let previousHash = "sha256:genesis";
    for (let index = 0; index < lines.length; index += 1) {
      let frame;
      try {
        frame = JSON.parse(lines[index]);
      } catch {
        fail("working_journal_corrupt");
      }
      const sequence = index + 1;
      if (
        frame?.schema !== "supermemory.working-frame.v1" ||
        frame.journal !== journal ||
        frame.working_set_id !== workingSetId ||
        frame.sequence !== sequence ||
        frame.previous_frame_hash !== previousHash
      ) fail("working_journal_corrupt");
      let mutation;
      try {
        mutation = openJsonAead(frame.sealed, {
          encryptionKey,
          expectedAad: frameAad(journal, workingSetId, sequence, previousHash)
        });
      } catch {
        fail("working_journal_corrupt");
      }
      if (mutation?.schema !== "supermemory.working-mutation.v1") fail("working_journal_corrupt");
      const frameHash = sha256(canonicalJson(frame));
      result.push({ frame, mutation, frameHash });
      previousHash = frameHash;
    }
    return result;
  };

  const appendFrame = (workspaceId, workingSetId, journal, mutation) => {
    const frames = readFrames(workspaceId, workingSetId, journal);
    const sequence = frames.length + 1;
    const previousHash = frames.at(-1)?.frameHash ?? "sha256:genesis";
    const frame = {
      schema: "supermemory.working-frame.v1",
      journal,
      working_set_id: workingSetId,
      sequence,
      previous_frame_hash: previousHash,
      sealed: sealJsonAead(mutation, {
        encryptionKey,
        aad: frameAad(journal, workingSetId, sequence, previousHash)
      })
    };
    appendAndSync(journalPath(workspaceId, workingSetId, journal), JSON.stringify(frame));
    const reopened = readFrames(workspaceId, workingSetId, journal);
    const latest = reopened.at(-1);
    if (latest?.frameHash !== sha256(canonicalJson(frame))) fail("working_journal_reopen_failed");
    return latest;
  };

  const readManifestSnapshot = (workspaceId, workingSetId) => {
    const filePath = manifestPath(workspaceId, workingSetId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const value = openJsonAead(JSON.parse(fs.readFileSync(filePath, "utf8")), {
        encryptionKey,
        expectedAad: manifestAad(workspaceId, workingSetId)
      });
      if (value?.schema !== "supermemory.working-manifest-snapshot.v1") return null;
      return value;
    } catch {
      return null;
    }
  };

  const writeManifestSnapshot = (state, tails) => {
    const { workspace_id: workspaceId, working_set_id: workingSetId } = state.manifest;
    const snapshot = {
      schema: "supermemory.working-manifest-snapshot.v1",
      manifest: state.manifest,
      tails
    };
    const sealed = sealJsonAead(snapshot, {
      encryptionKey,
      aad: manifestAad(workspaceId, workingSetId)
    });
    atomicWrite(manifestPath(workspaceId, workingSetId), `${JSON.stringify(sealed)}\n`);
    const reopened = readManifestSnapshot(workspaceId, workingSetId);
    if (!reopened || canonicalJson(reopened) !== canonicalJson(snapshot)) fail("working_manifest_reopen_failed");
    inject("after_manifest_commit", state);
    inject("after_state_commit", state);
    return reopened;
  };

  const creationFromFrames = (workspaceId, workingSetId, checkpointFrames) => {
    const creationFrames = checkpointFrames.filter(({ mutation }) => mutation.type === "working.created");
    const created = creationFrames[0]?.mutation;
    if (!created) {
      const interim = path.join(directoryFor(workspaceId, workingSetId), "state.json.aead");
      if (fs.existsSync(interim)) fail("working_interim_format_unsupported");
      fail("working_set_unknown");
    }
    if (
      creationFrames.length !== 1 || checkpointFrames[0]?.mutation !== created ||
      created.working_set_id !== workingSetId ||
      created.workspace_id !== workspaceId ||
      !created.project_id || !created.session_id
    ) fail("working_journal_corrupt");
    return created;
  };

  const replay = (workspaceId, workingSetId, expectedScope = null) => {
    assertId(workingSetId, WORKING_ID, "working_set_unknown");
    const directory = directoryFor(workspaceId, workingSetId);
    if (!fs.existsSync(directory)) fail("working_set_unknown");
    const checkpointFrames = readFrames(workspaceId, workingSetId, "checkpoint");
    const created = creationFromFrames(workspaceId, workingSetId, checkpointFrames);
    const scope = {
      workspaceId: created.workspace_id,
      projectId: created.project_id,
      sessionId: created.session_id
    };
    if (expectedScope && !sameScope(scope, expectedScope)) fail("working_set_unknown");
    const evidenceFrames = readFrames(workspaceId, workingSetId, "evidence");
    const tombstoneFrames = readFrames(workspaceId, workingSetId, "tombstone");
    const snapshot = readManifestSnapshot(workspaceId, workingSetId);
    const actualTails = Object.fromEntries(Object.keys(JOURNALS).map((journal) => {
      const frames = journal === "evidence" ? evidenceFrames : journal === "checkpoint" ? checkpointFrames : tombstoneFrames;
      return [journal, { sequence: frames.length, hash: frames.at(-1)?.frameHash ?? "sha256:genesis" }];
    }));
    if (snapshot?.tails) {
      for (const journal of Object.keys(JOURNALS)) {
        const committed = snapshot.tails[journal];
        if (committed && committed.sequence > actualTails[journal].sequence) fail("working_journal_truncated");
        if (
          committed?.sequence === actualTails[journal].sequence &&
          committed.hash !== actualTails[journal].hash
        ) fail("working_journal_corrupt");
      }
    }

    const entriesById = new Map();
    const events = new Map();
    for (const { mutation } of evidenceFrames) {
      if (mutation.type !== "evidence.added" || mutation.working_set_id !== workingSetId) fail("working_journal_corrupt");
      const entry = mutation.evidence;
      if (
        entry?.schema !== "supermemory.working-evidence.v1" ||
        entry.working_set_id !== workingSetId ||
        entry.workspace_id !== scope.workspaceId ||
        entry.project_id !== scope.projectId ||
        entry.session_id !== scope.sessionId ||
        !EVIDENCE_ID.test(entry.evidence_id) || !EPISODE_ID.test(entry.episode_id) ||
        entriesById.has(entry.evidence_id) || events.has(entry.event_id)
      ) fail("working_journal_corrupt");
      entriesById.set(entry.evidence_id, { ...entry, pinned: false, status: "selected" });
      events.set(entry.event_id, entry.evidence_id);
    }

    const observed = new Map();
    const pins = new Map();
    let closedAt = null;
    for (const { mutation } of checkpointFrames) {
      if (mutation.working_set_id !== workingSetId) fail("working_journal_corrupt");
      if (mutation.type === "source.observed") {
        if (
          mutation.workspace_id !== scope.workspaceId || mutation.project_id !== scope.projectId ||
          mutation.session_id !== scope.sessionId
        ) fail("working_journal_corrupt");
        const prior = observed.get(mutation.event_id);
        if (prior && canonicalJson(prior) !== canonicalJson(mutation)) fail("working_journal_corrupt");
        observed.set(mutation.event_id, mutation);
      } else if (mutation.type === "pin.set") {
        assertId(mutation.evidence_id, EVIDENCE_ID, "working_journal_corrupt");
        if (
          mutation.workspace_id !== scope.workspaceId || mutation.project_id !== scope.projectId ||
          mutation.session_id !== scope.sessionId || !entriesById.has(mutation.evidence_id)
        ) fail("working_journal_corrupt");
        pins.set(mutation.evidence_id, mutation.pinned === true);
      } else if (mutation.type === "session.closed") {
        if (
          mutation.workspace_id !== scope.workspaceId || mutation.project_id !== scope.projectId ||
          mutation.session_id !== scope.sessionId || !Number.isFinite(Date.parse(mutation.closed_at))
        ) fail("working_journal_corrupt");
        if (closedAt && closedAt !== mutation.closed_at) fail("working_journal_corrupt");
        closedAt = mutation.closed_at;
      } else if (mutation.type !== "working.created") {
        fail("working_journal_corrupt");
      }
    }

    const tombstones = [];
    const tombstoneStatus = new Map();
    for (const { mutation } of tombstoneFrames) {
      if (
        !["evidence.tombstoned", "evidence.purged"].includes(mutation.type) ||
        mutation.working_set_id !== workingSetId ||
        mutation.workspace_id !== scope.workspaceId || mutation.project_id !== scope.projectId ||
        mutation.session_id !== scope.sessionId || !EVIDENCE_ID.test(mutation.evidence_id)
      ) fail("working_journal_corrupt");
      const evidence = entriesById.get(mutation.evidence_id);
      if (
        !evidence || evidence.event_id !== mutation.event_id ||
        evidence.episode_id !== mutation.episode_id
      ) fail("working_journal_corrupt");
      tombstoneStatus.set(
        mutation.evidence_id,
        mutation.type === "evidence.purged" ? "purged" : "tombstoned"
      );
      tombstones.push({
        evidence_id: mutation.evidence_id,
        event_id: mutation.event_id,
        episode_id: mutation.episode_id,
        status: mutation.type === "evidence.purged" ? "purged" : "tombstoned",
        tombstoned_at: mutation.recorded_at
      });
    }

    const entries = [...entriesById.values()].map((entry) => ({
      ...entry,
      pinned: pins.get(entry.evidence_id) === true,
      status: tombstoneStatus.get(entry.evidence_id) ?? "selected"
    }));
    const selection = selectWorkingEvidence(entries, { capacityTokens });
    const highWatermarks = {};
    for (const source of observed.values()) {
      const key = `${source.source_adapter}:${source.session_id}`;
      highWatermarks[key] = Math.max(Number(highWatermarks[key] ?? -1), source.source_sequence);
    }
    const coverage = [...observed.values()].some((source) => source.capture_coverage === "partial")
      ? "partial"
      : [...observed.values()].some((source) => source.capture_coverage === "rich") ? "rich" : "standard";
    const manifest = {
      schema: "supermemory.working-set.v1",
      working_set_id: workingSetId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      session_id: scope.sessionId,
      thread_id: created.thread_id ?? null,
      checkout_id: created.checkout_id ?? null,
      forked_from_working_set_id: created.forked_from_working_set_id,
      forked_from_session_id: created.forked_from_session_id,
      fork_identity: created.fork_identity,
      state: selection.state === "over_capacity" ? "over_capacity" : coverage === "partial" ? "degraded" : "ready",
      capture_coverage: coverage,
      capacity_tokens: capacityTokens,
      selected_tokens: selection.selected_tokens,
      pinned_tokens: selection.pinned_tokens,
      map_version: 0,
      source_sequence_high_watermark: Math.max(-1, ...Object.values(highWatermarks)),
      source_high_watermarks: highWatermarks,
      created_at: created.recorded_at,
      updated_at: [...checkpointFrames, ...evidenceFrames, ...tombstoneFrames]
        .map(({ mutation }) => mutation.recorded_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? created.recorded_at,
      closed_at: closedAt,
      expires_at: null
    };
    return {
      schema: "supermemory.working-state.v2",
      manifest,
      entries: selection.entries,
      episodes: selection.entries.map((entry) => ({
        episode_id: entry.episode_id,
        evidence_ids: [entry.evidence_id],
        status: ["tombstoned", "purged"].includes(entry.status) ? entry.status : "active"
      })),
      tombstones,
      observed_events: observed,
      tails: actualTails
    };
  };

  const workspaceDirectories = (workspaceId) => {
    const workspaceRoot = path.join(root, workspaceId);
    if (!fs.existsSync(workspaceRoot)) return [];
    const stat = fs.lstatSync(workspaceRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("working_path_invalid");
    const result = [];
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) fail("working_path_invalid");
      if (!entry.isDirectory()) continue;
      if (WORKING_ID.test(entry.name)) result.push(entry.name);
      else if (fs.existsSync(path.join(workspaceRoot, entry.name, "state.json.aead"))) {
        fail("working_interim_format_unsupported");
      }
    }
    return result.sort();
  };

  const findByIdentity = (scope, forkedFromWorkingSetId, forkedFromSessionId, forkIdentity) => {
    let interimFound = false;
    for (const workingSetId of workspaceDirectories(scope.workspaceId)) {
      try {
        const state = replay(scope.workspaceId, workingSetId);
        if (
          sameScope(scope, {
            workspaceId: state.manifest.workspace_id,
            projectId: state.manifest.project_id,
            sessionId: state.manifest.session_id
          }) &&
          state.manifest.forked_from_working_set_id === forkedFromWorkingSetId &&
          state.manifest.forked_from_session_id === forkedFromSessionId &&
          state.manifest.fork_identity === forkIdentity
        ) return state;
      } catch (error) {
        if (error?.code === "working_interim_format_unsupported") interimFound = true;
        else if (!["working_set_unknown"].includes(error?.code)) throw error;
      }
    }
    if (interimFound) fail("working_interim_format_unsupported");
    return null;
  };

  const canonicalEpisodePath = (workspaceId, episodeId, create = false) => {
    safeSegment(workspaceId, "working_episode_unknown");
    assertId(episodeId, EPISODE_ID, "working_episode_unknown");
    const directory = create
      ? ensureDirectory(vault, `20_professional/memory-fabric/${workspaceId}/episodes`)
      : path.join(vault, "20_professional", "memory-fabric", workspaceId, "episodes");
    return path.join(directory, `${episodeId}.json.aead`);
  };
  const episodeAad = (workspaceId, episodeId) => `supermemory.episode.v1.${workspaceId}.${episodeId}`;
  const readCanonicalEpisode = (workspaceId, episodeId) => {
    const filePath = canonicalEpisodePath(workspaceId, episodeId);
    if (!fs.existsSync(filePath)) fail("working_episode_unknown");
    try {
      const episode = openJsonAead(JSON.parse(fs.readFileSync(filePath, "utf8")), {
        encryptionKey,
        expectedAad: episodeAad(workspaceId, episodeId)
      });
      if (
        episode?.schema !== "supermemory.episode.v1" ||
        episode.workspace_id !== workspaceId || episode.episode_id !== episodeId
      ) fail("working_episode_unknown");
      return episode;
    } catch {
      fail("working_episode_unknown");
    }
  };
  const writeCanonicalEpisode = (episode) => {
    const normalized = {
      ...episode,
      event_time: episode.event_time ?? legacyObservedEventTime(episode.observed_at)
    };
    const filePath = canonicalEpisodePath(normalized.workspace_id, normalized.episode_id, true);
    atomicWrite(filePath, `${JSON.stringify(sealJsonAead(normalized, {
      encryptionKey,
      aad: episodeAad(normalized.workspace_id, normalized.episode_id)
    }))}\n`);
    const reopened = readCanonicalEpisode(normalized.workspace_id, normalized.episode_id);
    if (canonicalJson(reopened) !== canonicalJson(normalized)) fail("working_episode_reopen_failed");
    inject("after_episode_commit", normalized);
    return reopened;
  };

  const readState = (input) => {
    const scope = scopeFrom(input, "working_set_unknown");
    const candidate = safeSegment(input?.workingSetId ?? input?.working_set_id, "working_set_unknown");
    if (!WORKING_ID.test(candidate)) {
      fail("working_set_unknown");
    }
    try {
      return replay(scope.workspaceId, candidate, scope);
    } catch (error) {
      if (error?.code === "working_set_unknown") throw error;
      const snapshot = readManifestSnapshot(scope.workspaceId, candidate);
      const manifest = snapshot?.manifest;
      if (
        manifest?.workspace_id === scope.workspaceId && manifest.project_id === scope.projectId &&
        manifest.session_id === scope.sessionId && manifest.working_set_id === candidate
      ) throw error;
      fail("working_set_unknown");
    }
  };

  const persistManifest = (state) => writeManifestSnapshot(state, state.tails);

  const ensure = (input) => withVaultMutationLock(vault, () => {
    const scope = scopeFrom(input);
    const forkedFromWorkingSetId = input?.forkedFromWorkingSetId ?? input?.forked_from_working_set_id ?? null;
    const forkedFromSessionId = input?.forkedFromSessionId ?? input?.forked_from_session_id ?? null;
    const forkIdentity = input?.forkIdentity ?? input?.fork_identity ?? null;
    const threadId = input?.threadId ?? input?.thread_id ?? null;
    const checkoutId = input?.checkoutId ?? input?.checkout_id ?? null;
    if (forkedFromWorkingSetId !== null) {
      assertId(forkedFromWorkingSetId, WORKING_ID, "working_set_unknown");
      assertString(forkedFromSessionId, "working_fork_parent_session_required");
      assertString(forkIdentity, "working_fork_identity_required");
      readState({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        sessionId: forkedFromSessionId,
        workingSetId: forkedFromWorkingSetId
      });
    } else if (forkIdentity !== null || forkedFromSessionId !== null) {
      fail("working_fork_parent_required");
    }
    const existing = findByIdentity(scope, forkedFromWorkingSetId, forkedFromSessionId, forkIdentity);
    if (existing) return existing;
    const workingSetId = makeId("wset");
    directoryFor(scope.workspaceId, workingSetId, true);
    appendFrame(scope.workspaceId, workingSetId, "checkpoint", {
      schema: "supermemory.working-mutation.v1",
      type: "working.created",
      working_set_id: workingSetId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      session_id: scope.sessionId,
      forked_from_working_set_id: forkedFromWorkingSetId,
      forked_from_session_id: forkedFromSessionId,
      fork_identity: forkIdentity,
      thread_id: threadId,
      checkout_id: checkoutId,
      recorded_at: clock()
    });
    inject("after_checkpoint_commit", { workingSetId, type: "working.created" });
    const state = replay(scope.workspaceId, workingSetId, scope);
    persistManifest(state);
    return state;
  });

  const validateSource = (record, payload, scope) => {
    let envelope;
    try {
      envelope = validateCodexEventEnvelope(record?.envelope);
    } catch {
      fail("working_source_invalid");
    }
    if (
      record?.schema !== "supermemory.codex-journal-record.v1" || record.applied !== true ||
      record.durable !== true || !["rich", "standard", "partial"].includes(record.capture_coverage) ||
      envelope.workspace_id !== scope.workspaceId || envelope.project_id !== scope.projectId ||
      envelope.session_id !== scope.sessionId || payloadHash(payload) !== envelope.payload_hash
    ) fail("working_source_invalid");
    return envelope;
  };

  const admit = ({
    record,
    payload,
    workingSetId = null,
    forkedFromWorkingSetId = null,
    forkedFromSessionId = null,
    forkIdentity = null
  }) => {
    const envelopeScope = scopeFrom(record?.envelope ?? {}, "working_source_invalid");
    return withVaultMutationLock(vault, () => {
      let state;
      if (workingSetId) state = replay(envelopeScope.workspaceId, workingSetId, envelopeScope);
      else {
        const found = findByIdentity(envelopeScope, forkedFromWorkingSetId, forkedFromSessionId, forkIdentity);
        if (found) state = found;
        else {
          if (forkedFromWorkingSetId !== null) {
            assertId(forkedFromWorkingSetId, WORKING_ID, "working_set_unknown");
            assertString(forkedFromSessionId, "working_fork_parent_session_required");
            assertString(forkIdentity, "working_fork_identity_required");
            readState({
              workspaceId: envelopeScope.workspaceId,
              projectId: envelopeScope.projectId,
              sessionId: forkedFromSessionId,
              workingSetId: forkedFromWorkingSetId
            });
          } else if (forkedFromSessionId !== null || forkIdentity !== null) {
            fail("working_fork_parent_required");
          }
          const newWorkingSetId = makeId("wset");
          directoryFor(envelopeScope.workspaceId, newWorkingSetId, true);
          appendFrame(envelopeScope.workspaceId, newWorkingSetId, "checkpoint", {
            schema: "supermemory.working-mutation.v1", type: "working.created",
            working_set_id: newWorkingSetId, workspace_id: envelopeScope.workspaceId,
            project_id: envelopeScope.projectId, session_id: envelopeScope.sessionId,
            forked_from_working_set_id: forkedFromWorkingSetId,
            forked_from_session_id: forkedFromSessionId,
            fork_identity: forkIdentity,
            thread_id: record.envelope.thread_id ?? null,
            checkout_id: record.envelope.checkout_id ?? null,
            recorded_at: clock()
          });
          state = replay(envelopeScope.workspaceId, newWorkingSetId, envelopeScope);
        }
      }
      const envelope = validateSource(record, payload, envelopeScope);
      const existingEvidence = state.entries.find((entry) => entry.event_id === envelope.event_id);
      const existingObserved = state.observed_events.get(envelope.event_id);
      if (existingEvidence || existingObserved) {
        const entry = existingEvidence ?? null;
        let episode = null;
        if (entry && entry.status !== "purged") {
          try {
            episode = readCanonicalEpisode(envelopeScope.workspaceId, entry.episode_id);
          } catch {
            episode = writeCanonicalEpisode({
              schema: "supermemory.episode.v1", episode_id: entry.episode_id,
              workspace_id: entry.workspace_id, project_id: entry.project_id,
              session_id: entry.session_id, working_set_id: entry.working_set_id,
              source_event_ids: [entry.event_id], evidence_ids: [entry.evidence_id],
              kind: episodeKind(entry.kind), observed_at: entry.created_at,
              content_hash: entry.content_hash, sensitivity: "standard",
              status: entry.status === "tombstoned" ? "tombstoned" : "active"
            });
          }
        }
        if (!existingObserved) {
          appendFrame(envelopeScope.workspaceId, state.manifest.working_set_id, "checkpoint", {
            schema: "supermemory.working-mutation.v1", type: "source.observed",
            working_set_id: state.manifest.working_set_id,
            workspace_id: envelope.workspace_id, project_id: envelope.project_id,
            session_id: envelope.session_id, event_id: envelope.event_id,
            source_adapter: envelope.adapter, source_sequence: envelope.sequence,
            capture_coverage: record.capture_coverage, recorded_at: clock()
          });
          state = replay(envelopeScope.workspaceId, state.manifest.working_set_id, envelopeScope);
        }
        persistManifest(state);
        return { state, entry, episode, duplicate: true };
      }

      const classification = classifyWorkingEvent(record, payload, { maxCompleteEventBytes });
      let entry = null;
      let episode = null;
      if (classification.eligible) {
        const evidenceId = makeId("wev");
        const episodeId = makeId("epi");
        entry = {
          schema: "supermemory.working-evidence.v1",
          evidence_id: evidenceId,
          episode_id: episodeId,
          working_set_id: state.manifest.working_set_id,
          event_id: envelope.event_id,
          payload_ref: envelope.payload_ref,
          workspace_id: envelope.workspace_id,
          project_id: envelope.project_id,
          session_id: envelope.session_id,
          turn_id: envelope.turn_id,
          item_id: envelope.item_id,
          kind: envelope.event_type,
          family: classification.family,
          title: envelope.event_type,
          token_estimate: classification.token_estimate,
          byte_length: classification.byte_length,
          content_hash: envelope.payload_hash,
          capture_coverage: classification.capture_coverage,
          complete: classification.complete,
          priority: classification.priority,
          redaction_profile: envelope.redaction_profile,
          source_adapter: envelope.adapter,
          source_sequence: envelope.sequence,
          created_at: envelope.observed_at,
          last_accessed_at: null,
          expires_at: null
        };
        episode = {
          schema: "supermemory.episode.v1",
          episode_id: episodeId,
          workspace_id: envelope.workspace_id,
          project_id: envelope.project_id,
          session_id: envelope.session_id,
          working_set_id: state.manifest.working_set_id,
          source_event_ids: [envelope.event_id],
          evidence_ids: [evidenceId],
          kind: episodeKind(envelope.event_type),
          observed_at: envelope.observed_at,
          content_hash: envelope.payload_hash,
          sensitivity: "standard",
          status: "active"
        };
        appendFrame(envelopeScope.workspaceId, state.manifest.working_set_id, "evidence", {
          schema: "supermemory.working-mutation.v1",
          type: "evidence.added",
          working_set_id: state.manifest.working_set_id,
          evidence: entry,
          episode_id: episodeId,
          recorded_at: clock()
        });
        inject("after_evidence_commit", entry);
        episode = writeCanonicalEpisode(episode);
      }
      appendFrame(envelopeScope.workspaceId, state.manifest.working_set_id, "checkpoint", {
        schema: "supermemory.working-mutation.v1",
        type: "source.observed",
        working_set_id: state.manifest.working_set_id,
        workspace_id: envelope.workspace_id,
        project_id: envelope.project_id,
        session_id: envelope.session_id,
        event_id: envelope.event_id,
        source_adapter: envelope.adapter,
        source_sequence: envelope.sequence,
        capture_coverage: record.capture_coverage,
        recorded_at: clock()
      });
      inject("after_checkpoint_commit", { eventId: envelope.event_id, type: "source.observed" });
      state = replay(envelopeScope.workspaceId, state.manifest.working_set_id, envelopeScope);
      persistManifest(state);
      entry = entry ? state.entries.find((item) => item.evidence_id === entry.evidence_id) : null;
      return { state, entry, episode, duplicate: false };
    });
  };

  const scopedEvidence = (input) => {
    const state = readState(input);
    const evidenceId = assertId(input?.evidenceId ?? input?.evidence_id, EVIDENCE_ID, "working_evidence_unknown");
    const entry = state.entries.find((item) => item.evidence_id === evidenceId);
    if (!entry) fail("working_evidence_unknown");
    return { state, entry, scope: scopeFrom(input, "working_evidence_unknown") };
  };

  const setPin = (input, pinned) => withVaultMutationLock(vault, () => {
    let { state, entry, scope } = scopedEvidence(input);
    if (["tombstoned", "purged"].includes(entry.status)) fail("working_evidence_unknown");
    if (entry.pinned === pinned) {
      persistManifest(state);
      return state;
    }
    appendFrame(scope.workspaceId, state.manifest.working_set_id, "checkpoint", {
      schema: "supermemory.working-mutation.v1",
      type: "pin.set",
      working_set_id: state.manifest.working_set_id,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      session_id: scope.sessionId,
      evidence_id: entry.evidence_id,
      pinned,
      recorded_at: clock()
    });
    inject("after_checkpoint_commit", { evidenceId: entry.evidence_id, type: "pin.set", pinned });
    state = replay(scope.workspaceId, state.manifest.working_set_id, scope);
    persistManifest(state);
    return state;
  });

  const tombstone = (input) => withVaultMutationLock(vault, () => {
    let { state, entry, scope } = scopedEvidence(input);
    if (!["tombstoned", "purged"].includes(entry.status)) {
      appendFrame(scope.workspaceId, state.manifest.working_set_id, "tombstone", {
        schema: "supermemory.working-mutation.v1",
        type: "evidence.tombstoned",
        working_set_id: state.manifest.working_set_id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        session_id: scope.sessionId,
        evidence_id: entry.evidence_id,
        event_id: entry.event_id,
        episode_id: entry.episode_id,
        recorded_at: clock()
      });
      inject("after_tombstone_commit", entry);
      state = replay(scope.workspaceId, state.manifest.working_set_id, scope);
      entry = state.entries.find((item) => item.evidence_id === entry.evidence_id);
    }
    if (entry.status === "purged") {
      persistManifest(state);
      return state;
    }
    let episode;
    try {
      episode = readCanonicalEpisode(scope.workspaceId, entry.episode_id);
    } catch (error) {
      if (fs.existsSync(canonicalEpisodePath(scope.workspaceId, entry.episode_id))) throw error;
      episode = writeCanonicalEpisode({
        schema: "supermemory.episode.v1", episode_id: entry.episode_id,
        workspace_id: scope.workspaceId, project_id: scope.projectId,
        session_id: scope.sessionId, working_set_id: state.manifest.working_set_id,
        source_event_ids: [entry.event_id], evidence_ids: [entry.evidence_id],
        kind: episodeKind(entry.kind), observed_at: entry.created_at,
        content_hash: entry.content_hash, sensitivity: "standard", status: "tombstoned"
      });
    }
    if (episode.status !== "tombstoned") writeCanonicalEpisode({ ...episode, status: "tombstoned" });
    persistManifest(state);
    return state;
  });

  const readDerivedMap = (input) => {
    const state = readState(input);
    const workspaceId = state.manifest.workspace_id;
    const workingSetId = state.manifest.working_set_id;
    const target = derivedMapPath(workspaceId, workingSetId);
    if (!fs.existsSync(target)) return null;
    try {
      const sealed = JSON.parse(fs.readFileSync(target, "utf8"));
      let value;
      try {
        value = openJsonAead(sealed, {
          encryptionKey,
          expectedAad: `supermemory.working-map.v2.${workspaceId}.${workingSetId}`
        });
      } catch {
        value = openJsonAead(sealed, {
          encryptionKey,
          expectedAad: `supermemory.working-map.v1.${workspaceId}.${workingSetId}`
        });
      }
      if (
        !["supermemory.working-map.v1", "supermemory.working-map.v2"].includes(value?.schema) ||
        value.workspace_id !== workspaceId || value.project_id !== state.manifest.project_id ||
        value.session_id !== state.manifest.session_id || value.working_set_id !== workingSetId
      ) fail("working_map_corrupt");
      return value;
    } catch (error) {
      if (error?.code === "working_map_corrupt") throw error;
      fail("working_map_corrupt");
    }
  };

  const writeDerivedMap = (input) => withVaultMutationLock(vault, () => {
    const state = readState(input);
    const value = input?.map;
    const workspaceId = state.manifest.workspace_id;
    const workingSetId = state.manifest.working_set_id;
    if (
      !["supermemory.working-map.v1", "supermemory.working-map.v2"].includes(value?.schema) ||
      value.workspace_id !== workspaceId || value.project_id !== state.manifest.project_id ||
      value.session_id !== state.manifest.session_id || value.working_set_id !== workingSetId
    ) fail("working_map_invalid");
    atomicWrite(derivedMapPath(workspaceId, workingSetId), `${JSON.stringify(sealJsonAead(value, {
      encryptionKey,
      aad: `${value.schema}.${workspaceId}.${workingSetId}`
    }))}\n`);
    return value;
  });

  const purgeDerived = (input) => withVaultMutationLock(vault, () => {
    let { state, entry, scope } = scopedEvidence(input);
    if (input?.confirmation !== `PURGE ${entry.evidence_id}`) fail("working_purge_confirmation_required");
    const attestationTarget = purgeAttestationPath(
      scope.workspaceId,
      state.manifest.working_set_id,
      entry.evidence_id
    );
    const attestationAad = `supermemory.working-purge-attestation.v1.${scope.workspaceId}.${state.manifest.working_set_id}.${entry.evidence_id}`;
    if (entry.status === "purged" && fs.existsSync(attestationTarget)) {
      return openJsonAead(JSON.parse(fs.readFileSync(attestationTarget, "utf8")), {
        encryptionKey,
        expectedAad: attestationAad
      });
    }
    if (entry.status !== "purged") {
      appendFrame(scope.workspaceId, state.manifest.working_set_id, "tombstone", {
        schema: "supermemory.working-mutation.v1",
        type: "evidence.purged",
        working_set_id: state.manifest.working_set_id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        session_id: scope.sessionId,
        evidence_id: entry.evidence_id,
        event_id: entry.event_id,
        episode_id: entry.episode_id,
        recorded_at: clock()
      });
      state = replay(scope.workspaceId, state.manifest.working_set_id, scope);
    }
    const mapTarget = derivedMapPath(scope.workspaceId, state.manifest.working_set_id);
    if (fs.existsSync(mapTarget)) fs.rmSync(mapTarget);
    const episodeTarget = canonicalEpisodePath(scope.workspaceId, entry.episode_id);
    if (fs.existsSync(episodeTarget)) fs.rmSync(episodeTarget);
    const attestation = {
      schema: "supermemory.working-purge-attestation.v1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      session_id: scope.sessionId,
      working_set_id: state.manifest.working_set_id,
      evidence_id: entry.evidence_id,
      episode_id: entry.episode_id,
      content_hash: entry.content_hash,
      capture_archive_preserved: true,
      derived_map_removed: true,
      derived_episode_removed: true,
      purged_at: clock()
    };
    atomicWrite(
      attestationTarget,
      `${JSON.stringify(sealJsonAead(attestation, {
        encryptionKey,
        aad: attestationAad
      }))}\n`
    );
    persistManifest(state);
    return attestation;
  });

  const openEvidence = (input) => {
    const { state, entry, scope } = scopedEvidence(input);
    if (entry.status === "tombstoned" || entry.status === "purged" || entry.expires_at) {
      fail("working_evidence_unknown");
    }
    if (!input?.captureStore || typeof input.captureStore.readEvents !== "function") {
      fail("working_capture_store_required");
    }
    const record = input.captureStore.readEvents({
      workspaceId: scope.workspaceId,
      sessionId: scope.sessionId,
      includePayload: true
    }).find((item) => item.envelope.event_id === entry.event_id);
    if (
      !record || record.envelope.workspace_id !== scope.workspaceId ||
      record.envelope.project_id !== scope.projectId || record.envelope.session_id !== scope.sessionId ||
      record.envelope.payload_hash !== entry.content_hash || payloadHash(record.payload) !== entry.content_hash
    ) fail("working_evidence_unknown");
    const episode = readCanonicalEpisode(scope.workspaceId, entry.episode_id);
    if (
      episode.project_id !== scope.projectId || episode.session_id !== scope.sessionId ||
      episode.working_set_id !== state.manifest.working_set_id ||
      !episode.evidence_ids.includes(entry.evidence_id) || episode.status !== "active" ||
      episode.content_hash !== entry.content_hash
    ) fail("working_evidence_unknown");
    return { entry, episode, payload: record.payload };
  };

  const readEpisode = (input) => {
    const { state, entry, scope } = scopedEvidence(input);
    const episodeId = assertId(input?.episodeId ?? input?.episode_id, EPISODE_ID, "working_episode_unknown");
    if (entry.episode_id !== episodeId || ["tombstoned", "purged"].includes(entry.status)) fail("working_episode_unknown");
    const episode = readCanonicalEpisode(scope.workspaceId, episodeId);
    if (
      episode.project_id !== scope.projectId || episode.session_id !== scope.sessionId ||
      episode.working_set_id !== state.manifest.working_set_id ||
      !episode.evidence_ids.includes(entry.evidence_id) || episode.status !== "active"
    ) fail("working_episode_unknown");
    return episode;
  };

  const listEpisodes = ({ workspaceId, workspace_id: snakeWorkspaceId } = {}) => {
    const workspace = safeSegment(workspaceId ?? snakeWorkspaceId, "working_scope_invalid");
    const directory = path.join(vault, "20_professional", "memory-fabric", workspace, "episodes");
    if (!fs.existsSync(directory)) return [];
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("working_episode_unknown");
    return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
      if (entry.isSymbolicLink() || !entry.isFile()) fail("working_episode_unknown");
      const match = /^(epi_[0-9a-f-]+)\.json\.aead$/i.exec(entry.name);
      if (!match) fail("working_episode_unknown");
      return readCanonicalEpisode(workspace, match[1]);
    }).sort((left, right) => (
      left.observed_at.localeCompare(right.observed_at) || left.episode_id.localeCompare(right.episode_id)
    ));
  };

  const resolveWorkingSet = ({
    workspaceId,
    workspace_id: snakeWorkspace,
    projectId,
    project_id: snakeProject,
    workingSetId,
    working_set_id: snakeWorkingSet
  } = {}) => {
    const workspace = safeSegment(workspaceId ?? snakeWorkspace, "working_set_unknown");
    const project = safeSegment(projectId ?? snakeProject, "working_set_unknown");
    const workingSet = assertId(workingSetId ?? snakeWorkingSet, WORKING_ID, "working_set_unknown");
    const state = replay(workspace, workingSet);
    if (state.manifest.project_id !== project) fail("working_set_unknown");
    return state;
  };

  const listImproveEpisodes = ({
    workspaceId,
    workspace_id: snakeWorkspaceId,
    sessionId = null,
    session_id: snakeSessionId = null,
    captureStore
  } = {}) => {
    const workspace = safeSegment(workspaceId ?? snakeWorkspaceId, "working_scope_invalid");
    const requestedSession = sessionId ?? snakeSessionId;
    if (!captureStore || typeof captureStore.readEvents !== "function") fail("working_capture_store_required");
    const result = [];
    for (const workingSetId of workspaceDirectories(workspace)) {
      const state = replay(workspace, workingSetId);
      if (requestedSession && state.manifest.session_id !== requestedSession) continue;
      for (const entry of state.entries) {
        const scope = {
          workspaceId: workspace,
          projectId: state.manifest.project_id,
          sessionId: state.manifest.session_id,
          workingSetId,
          evidenceId: entry.evidence_id
        };
        const cursor = {
          owner: `${entry.source_adapter}:${entry.session_id}`,
          sequence: entry.source_sequence,
          event_id: entry.event_id
        };
        if (entry.status === "purged") {
          result.push({
            episode: {
              episode_id: entry.episode_id,
              evidence_ids: [entry.evidence_id],
              workspace_id: workspace,
              project_id: state.manifest.project_id,
              session_id: state.manifest.session_id,
              working_set_id: workingSetId,
              status: "purged"
            },
            evidence: entry,
            payload: null,
            cursor,
            reopened: false,
            status: "purged"
          });
          continue;
        }
        const episode = readCanonicalEpisode(workspace, entry.episode_id);
        if (entry.status === "tombstoned" || episode.status === "tombstoned") {
          result.push({ episode, evidence: entry, payload: null, cursor, reopened: false, status: "tombstoned" });
          continue;
        }
        const reopened = openEvidence({ ...scope, captureStore });
        result.push({
          episode: reopened.episode,
          evidence: reopened.entry,
          payload: reopened.payload,
          cursor,
          reopened: true,
          status: "active"
        });
      }
    }
    return result.sort((left, right) => (
      left.cursor.owner.localeCompare(right.cursor.owner) ||
      left.cursor.sequence - right.cursor.sequence ||
      left.cursor.event_id.localeCompare(right.cursor.event_id)
    ));
  };

  const readClosedSession = ({ workspaceId, workspace_id: snakeWorkspaceId, sessionId, session_id: snakeSessionId } = {}) => {
    const workspace = safeSegment(workspaceId ?? snakeWorkspaceId, "working_scope_invalid");
    const session = assertString(sessionId ?? snakeSessionId, "working_session_unknown");
    const matches = workspaceDirectories(workspace).map((workingSetId) => replay(workspace, workingSetId))
      .filter((state) => state.manifest.session_id === session);
    if (matches.length !== 1 || !matches[0].manifest.closed_at) fail("working_session_not_closed");
    return {
      workspace_id: workspace,
      project_id: matches[0].manifest.project_id,
      session_id: session,
      working_set_id: matches[0].manifest.working_set_id,
      closed_at: matches[0].manifest.closed_at
    };
  };

  const closeSession = (input = {}) => withVaultMutationLock(vault, () => {
    const scope = scopeFrom(input, "working_set_unknown");
    const workingSetId = assertId(input.workingSetId ?? input.working_set_id, WORKING_ID, "working_set_unknown");
    let state = replay(scope.workspaceId, workingSetId, scope);
    const closedAt = assertString(input.closedAt ?? input.closed_at ?? clock(), "working_session_close_invalid");
    if (!Number.isFinite(Date.parse(closedAt))) fail("working_session_close_invalid");
    if (state.manifest.closed_at) {
      if (state.manifest.closed_at !== closedAt) fail("working_session_close_conflict");
      return readClosedSession({ workspaceId: scope.workspaceId, sessionId: scope.sessionId });
    }
    appendFrame(scope.workspaceId, workingSetId, "checkpoint", {
      schema: "supermemory.working-mutation.v1",
      type: "session.closed",
      working_set_id: workingSetId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      session_id: scope.sessionId,
      closed_at: closedAt,
      recorded_at: clock()
    });
    state = replay(scope.workspaceId, workingSetId, scope);
    persistManifest(state);
    return readClosedSession({ workspaceId: scope.workspaceId, sessionId: scope.sessionId });
  });

  const rebuild = (input) => withVaultMutationLock(vault, () => {
    const scope = scopeFrom(input, "working_set_unknown");
    const workingSetId = assertId(input?.workingSetId ?? input?.working_set_id, WORKING_ID, "working_set_unknown");
    let state = readState({ ...scope, workingSetId });
    if (!input.captureStore || typeof input.captureStore.readEvents !== "function") fail("working_capture_store_required");
    const records = input.captureStore.readEvents({
      workspaceId: scope.workspaceId,
      sessionId: scope.sessionId,
      includePayload: true
    });
    const canonicalByEvent = new Map();
    for (const record of records.sort((left, right) => (
      left.envelope.sequence - right.envelope.sequence ||
      left.envelope.event_id.localeCompare(right.envelope.event_id)
    ))) {
      const envelope = validateSource(record, record.payload, scope);
      if (canonicalByEvent.has(envelope.event_id)) fail("working_source_invalid");
      canonicalByEvent.set(envelope.event_id, record);
    }
    for (const entry of state.entries) {
      const record = canonicalByEvent.get(entry.event_id);
      if (!record || record.envelope.payload_hash !== entry.content_hash) fail("working_source_invalid");
      if (entry.status === "purged") continue;
      let episode;
      try {
        episode = readCanonicalEpisode(scope.workspaceId, entry.episode_id);
      } catch (error) {
        if (fs.existsSync(canonicalEpisodePath(scope.workspaceId, entry.episode_id))) throw error;
        episode = writeCanonicalEpisode({
          schema: "supermemory.episode.v1", episode_id: entry.episode_id,
          workspace_id: scope.workspaceId, project_id: scope.projectId,
          session_id: scope.sessionId, working_set_id: workingSetId,
          source_event_ids: [entry.event_id], evidence_ids: [entry.evidence_id],
          kind: episodeKind(entry.kind), observed_at: entry.created_at,
          content_hash: entry.content_hash, sensitivity: "standard",
          status: entry.status === "tombstoned" ? "tombstoned" : "active"
        });
      }
      const tombstoned = entry.status === "tombstoned";
      if (
        episode.project_id !== scope.projectId || episode.session_id !== scope.sessionId ||
        episode.working_set_id !== workingSetId || episode.content_hash !== entry.content_hash ||
        !episode.evidence_ids.includes(entry.evidence_id)
      ) fail("working_episode_unknown");
      if (tombstoned && episode.status !== "tombstoned") {
        writeCanonicalEpisode({ ...episode, status: "tombstoned" });
      }
      if (!tombstoned && episode.status !== "active") fail("working_episode_unknown");
    }
    for (const eventId of state.observed_events.keys()) {
      if (!canonicalByEvent.has(eventId)) fail("working_source_invalid");
    }
    for (const [eventId, record] of canonicalByEvent) {
      if (state.observed_events.has(eventId)) continue;
      const envelope = record.envelope;
      const classification = classifyWorkingEvent(record, record.payload, { maxCompleteEventBytes });
      const existingEntry = state.entries.find((entry) => entry.event_id === eventId);
      if (classification.eligible && !existingEntry) {
        const evidenceId = makeId("wev");
        const episodeId = makeId("epi");
        const evidence = {
          schema: "supermemory.working-evidence.v1", evidence_id: evidenceId,
          episode_id: episodeId, working_set_id: workingSetId, event_id: eventId,
          payload_ref: envelope.payload_ref, workspace_id: scope.workspaceId,
          project_id: scope.projectId, session_id: scope.sessionId,
          turn_id: envelope.turn_id, item_id: envelope.item_id, kind: envelope.event_type,
          family: classification.family, title: envelope.event_type,
          token_estimate: classification.token_estimate, byte_length: classification.byte_length,
          content_hash: envelope.payload_hash, capture_coverage: classification.capture_coverage,
          complete: classification.complete, priority: classification.priority,
          redaction_profile: envelope.redaction_profile, source_adapter: envelope.adapter,
          source_sequence: envelope.sequence, created_at: envelope.observed_at,
          last_accessed_at: null, expires_at: null
        };
        appendFrame(scope.workspaceId, workingSetId, "evidence", {
          schema: "supermemory.working-mutation.v1", type: "evidence.added",
          working_set_id: workingSetId, evidence, episode_id: episodeId, recorded_at: clock()
        });
        writeCanonicalEpisode({
          schema: "supermemory.episode.v1", episode_id: episodeId,
          workspace_id: scope.workspaceId, project_id: scope.projectId,
          session_id: scope.sessionId, working_set_id: workingSetId,
          source_event_ids: [eventId], evidence_ids: [evidenceId],
          kind: episodeKind(envelope.event_type), observed_at: envelope.observed_at,
          content_hash: envelope.payload_hash, sensitivity: "standard", status: "active"
        });
      }
      appendFrame(scope.workspaceId, workingSetId, "checkpoint", {
        schema: "supermemory.working-mutation.v1", type: "source.observed",
        working_set_id: workingSetId, workspace_id: scope.workspaceId,
        project_id: scope.projectId, session_id: scope.sessionId, event_id: eventId,
        source_adapter: envelope.adapter, source_sequence: envelope.sequence,
        capture_coverage: record.capture_coverage, recorded_at: clock()
      });
    }
    state = replay(scope.workspaceId, workingSetId, scope);
    persistManifest(state);
    return state;
  });

  const listWorkingSets = ({ workspaceId, workspace_id: snakeWorkspaceId, projectId, project_id: snakeProjectId } = {}) => {
    const workspace = assertString(workspaceId ?? snakeWorkspaceId, "working_set_unknown");
    const project = projectId ?? snakeProjectId ?? null;
    const directory = path.join(root, workspace);
    if (!fs.existsSync(directory)) return [];
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("working_set_unknown");
    const states = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !WORKING_ID.test(entry.name)) continue;
      try {
        const state = replay(workspace, entry.name);
        if (project === null || state.manifest.project_id === project) states.push(state);
      } catch {
        // A corrupt set is isolated and will be surfaced when addressed directly.
      }
    }
    return states.sort((left, right) => left.manifest.created_at.localeCompare(right.manifest.created_at));
  };

  const migrateTemporalEpisodes = ({ workspaceId, workspace_id: snakeWorkspaceId } = {}) => withVaultMutationLock(vault, () => {
    const workspace = safeSegment(workspaceId ?? snakeWorkspaceId, "working_scope_invalid");
    const directory = path.join(vault, "20_professional", "memory-fabric", workspace, "episodes");
    if (!fs.existsSync(directory)) return { workspace_id: workspace, episodes: 0, migrated: 0 };
    let episodes = 0;
    let migrated = 0;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const match = /^(epi_[0-9a-f-]{36})\.json\.aead$/i.exec(entry.name);
      if (!entry.isFile() || entry.isSymbolicLink() || !match) fail("working_episode_unknown");
      const episode = readCanonicalEpisode(workspace, match[1]);
      episodes += 1;
      if (!episode.event_time) {
        writeCanonicalEpisode(episode);
        migrated += 1;
      }
    }
    return { schema: "supermemory.episode-temporal-migration.v1", workspace_id: workspace, episodes, migrated };
  });

  return {
    root,
    ensure,
    admit,
    readState,
    openEvidence,
    readEpisode,
    listEpisodes,
    resolveWorkingSet,
    listImproveEpisodes,
    listWorkingSets,
    migrateTemporalEpisodes,
    recordAdmissionRevocation,
    listRevokedAdmissions,
    readClosedSession,
    closeSession,
    pin: (input) => setPin(input, true),
    unpin: (input) => setPin(input, false),
    tombstone,
    readDerivedMap,
    writeDerivedMap,
    purgeDerived,
    rebuild
  };
}
