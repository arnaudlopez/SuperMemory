import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "./project-registry.mjs";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const TOPIC_ID = /^topic_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKING_ID = /^wset_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKPOINT_ID = /^tcp_[0-9a-f]{64}$/i;
const RELATIONS = new Set(["root", "continuation", "fork"]);
const RESOLUTIONS = new Set(["exact", "inherited", "high_confidence", "manual"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function safeSegment(value, code = "topic_scope_invalid") {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,300}$/.test(value)) fail(code);
  return value;
}

function assertId(value, pattern, code) {
  if (!pattern.test(String(value ?? ""))) fail(code);
  return value;
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    safeSegment(segment, "topic_path_invalid");
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("topic_path_invalid");
    } else fs.mkdirSync(next, { mode: 0o700 });
    fs.chmodSync(next, 0o700);
    current = fs.realpathSync(next);
    const relativePath = path.relative(root, current);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) fail("topic_scope_escape");
  }
  return current;
}

function syncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
    // File fsync remains the portable durability baseline.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function appendAndSync(filePath, line) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("topic_journal_corrupt");
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
  syncDirectory(path.dirname(filePath));
}

function scope(input) {
  return {
    workspaceId: safeSegment(input?.workspaceId ?? input?.workspace_id),
    projectId: safeSegment(input?.projectId ?? input?.project_id)
  };
}

function cloneState(state) {
  return {
    topics: [...state.topics.values()].map((item) => structuredClone(item)),
    memberships: [...state.memberships.values()].map((item) => structuredClone(item)),
    checkpoints: [...state.checkpoints.values()].map((item) => structuredClone(item)),
    suggestions: [...state.suggestions.values()].map((item) => structuredClone(item)),
    sequence: state.sequence,
    tail: state.tail
  };
}

export function createCodexTopicStore({
  vaultRoot,
  encryptionKey,
  clock = () => new Date().toISOString(),
  randomBytes = crypto.randomBytes,
  faultInjector = null
} = {}) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) fail("topic_encryption_key_invalid");
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const root = ensureDirectory(vault, "00_inbox/supermemory-product/codex-topics");
  const now = () => {
    const value = clock();
    if (!Number.isFinite(Date.parse(value))) fail("topic_clock_invalid");
    return new Date(value).toISOString();
  };
  const makeTopicId = () => `topic_${generateUuidV7({ now: Date.parse(now()), randomBytes })}`;
  const directory = (workspaceId, create = false) => {
    safeSegment(workspaceId);
    const target = path.join(root, workspaceId);
    if (!fs.existsSync(target)) {
      if (!create) return null;
      return ensureDirectory(root, workspaceId);
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("topic_path_invalid");
    return fs.realpathSync(target);
  };
  const journalPath = (workspaceId, create = false) => {
    const folder = directory(workspaceId, create);
    return folder ? path.join(folder, "topic-events.jsonl.aead") : null;
  };
  const aad = (workspaceId) => `supermemory.topic-journal.v1:${workspaceId}`;

  const emptyState = () => ({
    topics: new Map(), memberships: new Map(), checkpoints: new Map(), suggestions: new Map(),
    sequence: 0, tail: "sha256:genesis"
  });

  const apply = (state, event) => {
    if (event.type === "topic.created") {
      if (state.topics.has(event.topic.topic_id)) fail("topic_journal_conflict");
      state.topics.set(event.topic.topic_id, structuredClone(event.topic));
    } else if (event.type === "membership.bound") {
      const current = state.memberships.get(event.membership.working_set_id);
      if (current && current.unbound_at === null && current.topic_id !== event.membership.topic_id) fail("topic_membership_conflict");
      state.memberships.set(event.membership.working_set_id, structuredClone(event.membership));
    } else if (event.type === "membership.unbound") {
      const current = state.memberships.get(event.working_set_id);
      if (!current || current.topic_id !== event.topic_id || current.unbound_at !== null) fail("topic_journal_conflict");
      state.memberships.set(event.working_set_id, { ...current, unbound_at: event.unbound_at });
    } else if (event.type === "checkpoint.appended") {
      const existing = state.checkpoints.get(event.checkpoint.checkpoint_id);
      if (existing && canonicalJson(existing) !== canonicalJson(event.checkpoint)) fail("topic_checkpoint_conflict");
      state.checkpoints.set(event.checkpoint.checkpoint_id, structuredClone(event.checkpoint));
      const topic = state.topics.get(event.checkpoint.topic_id);
      if (!topic) fail("topic_journal_conflict");
      state.topics.set(topic.topic_id, {
        ...topic,
        last_checkpoint_id: event.checkpoint.checkpoint_id,
        updated_at: event.checkpoint.created_at
      });
    } else if (event.type === "checkpoint.enriched") {
      const current = state.checkpoints.get(event.checkpoint_id);
      if (!current || current.enrichment !== null) fail("topic_checkpoint_conflict");
      state.checkpoints.set(event.checkpoint_id, { ...current, enrichment: structuredClone(event.enrichment) });
    } else if (event.type === "topic.status") {
      const topic = state.topics.get(event.topic_id);
      if (!topic) fail("topic_journal_conflict");
      state.topics.set(topic.topic_id, { ...topic, status: event.status, updated_at: event.recorded_at });
    } else if (event.type === "topic.suggested_link") {
      state.suggestions.set(event.suggestion.fingerprint, structuredClone(event.suggestion));
    } else fail("topic_journal_event_invalid");
  };

  const replay = (workspaceId) => {
    safeSegment(workspaceId);
    const filePath = journalPath(workspaceId, false);
    const state = emptyState();
    if (!filePath || !fs.existsSync(filePath)) return state;
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("topic_journal_corrupt");
    const content = fs.readFileSync(filePath, "utf8");
    if (content && !content.endsWith("\n")) fail("topic_journal_truncated");
    for (const line of content.split("\n").filter(Boolean)) {
      let frame;
      try { frame = JSON.parse(line); } catch { fail("topic_journal_corrupt"); }
      const expectedSequence = state.sequence + 1;
      if (
        frame?.schema !== "supermemory.topic-frame.v1" || frame.sequence !== expectedSequence ||
        frame.previous_frame_hash !== state.tail
      ) fail("topic_journal_corrupt");
      const material = canonicalJson({
        schema: frame.schema,
        sequence: frame.sequence,
        previous_frame_hash: frame.previous_frame_hash,
        sealed: frame.sealed
      });
      if (frame.frame_hash !== sha256(material)) fail("topic_journal_corrupt");
      let event;
      try { event = openJsonAead(frame.sealed, { encryptionKey, expectedAad: aad(workspaceId) }); } catch { fail("topic_journal_corrupt"); }
      if (event.workspace_id !== workspaceId) fail("topic_journal_corrupt");
      apply(state, event);
      state.sequence = frame.sequence;
      state.tail = frame.frame_hash;
    }
    return state;
  };

  const append = (workspaceId, event) => {
    const state = replay(workspaceId);
    const sequence = state.sequence + 1;
    const sealed = sealJsonAead(event, { encryptionKey, aad: aad(workspaceId) });
    const material = canonicalJson({
      schema: "supermemory.topic-frame.v1",
      sequence,
      previous_frame_hash: state.tail,
      sealed
    });
    const frame = {
      schema: "supermemory.topic-frame.v1",
      sequence,
      previous_frame_hash: state.tail,
      sealed,
      frame_hash: sha256(material)
    };
    appendAndSync(journalPath(workspaceId, true), canonicalJson(frame));
    faultInjector?.("after_topic_frame_commit", { sequence, event: event.type });
    apply(state, event);
    state.sequence = sequence;
    state.tail = frame.frame_hash;
    return state;
  };

  const readBound = (input, state = null) => {
    const exact = scope(input);
    const workingSetId = assertId(input?.workingSetId ?? input?.working_set_id, WORKING_ID, "topic_not_found_or_not_authorized");
    const snapshot = state ?? replay(exact.workspaceId);
    const membership = snapshot.memberships.get(workingSetId);
    const topic = membership ? snapshot.topics.get(membership.topic_id) : null;
    if (
      !membership || membership.unbound_at !== null || !topic ||
      topic.workspace_id !== exact.workspaceId || topic.project_id !== exact.projectId
    ) fail("topic_not_found_or_not_authorized");
    return { exact, workingSetId, membership, topic, state: snapshot };
  };

  const createRoot = (input = {}) => withVaultMutationLock(vault, () => {
    const exact = scope(input);
    const workingSetId = assertId(input.workingSetId ?? input.working_set_id, WORKING_ID, "topic_working_set_invalid");
    const sessionId = safeSegment(input.sessionId ?? input.session_id, "topic_session_invalid");
    let state = replay(exact.workspaceId);
    const existing = state.memberships.get(workingSetId);
    if (existing?.unbound_at === null) return readBound(input, state);
    const timestamp = now();
    const topic = {
      schema: "supermemory.topic.v1",
      topic_id: makeTopicId(),
      workspace_id: exact.workspaceId,
      project_id: exact.projectId,
      title: String(input.title ?? "Sujet sans titre").replace(/\s+/g, " ").trim().slice(0, 200),
      status: "active",
      created_at: timestamp,
      updated_at: timestamp,
      last_checkpoint_id: null,
      authority_revision: 0,
      retention_class: "project_default"
    };
    state = append(exact.workspaceId, { schema: "supermemory.topic-event.v1", type: "topic.created", workspace_id: exact.workspaceId, topic });
    const membership = {
      schema: "supermemory.topic-membership.v1",
      topic_id: topic.topic_id,
      working_set_id: workingSetId,
      session_id: sessionId,
      relation: "root",
      resolution: "exact",
      resolution_score: 1,
      reason_codes: ["new_topic_root"],
      bound_at: timestamp,
      unbound_at: null
    };
    state = append(exact.workspaceId, { schema: "supermemory.topic-event.v1", type: "membership.bound", workspace_id: exact.workspaceId, membership });
    return readBound(input, state);
  });

  const bind = (input = {}) => withVaultMutationLock(vault, () => {
    const exact = scope(input);
    const topicId = assertId(input.topicId ?? input.topic_id, TOPIC_ID, "topic_unknown");
    const workingSetId = assertId(input.workingSetId ?? input.working_set_id, WORKING_ID, "topic_working_set_invalid");
    const sessionId = safeSegment(input.sessionId ?? input.session_id, "topic_session_invalid");
    const relation = input.relation ?? "continuation";
    const resolution = input.resolution ?? "exact";
    if (!RELATIONS.has(relation) || !RESOLUTIONS.has(resolution)) fail("topic_membership_invalid");
    const score = Number(input.resolutionScore ?? input.resolution_score ?? 1);
    if (!Number.isFinite(score) || score < 0 || score > 1) fail("topic_membership_invalid");
    let state = replay(exact.workspaceId);
    const topic = state.topics.get(topicId);
    if (!topic || topic.project_id !== exact.projectId || topic.status === "purged") fail("topic_unknown");
    const existing = state.memberships.get(workingSetId);
    if (existing?.unbound_at === null) {
      if (existing.topic_id !== topicId) fail("topic_membership_conflict");
      return readBound(input, state);
    }
    const membership = {
      schema: "supermemory.topic-membership.v1", topic_id: topicId, working_set_id: workingSetId,
      session_id: sessionId, relation, resolution, resolution_score: score,
      reason_codes: [...new Set(input.reasonCodes ?? input.reason_codes ?? [])].sort(),
      bound_at: now(), unbound_at: null
    };
    state = append(exact.workspaceId, { schema: "supermemory.topic-event.v1", type: "membership.bound", workspace_id: exact.workspaceId, membership });
    return readBound(input, state);
  });

  const appendCheckpoint = (input = {}) => withVaultMutationLock(vault, () => {
    const bound = readBound(input);
    const checkpoint = structuredClone(input.checkpoint);
    if (
      checkpoint?.schema !== "supermemory.topic-checkpoint.v1" ||
      !CHECKPOINT_ID.test(String(checkpoint.checkpoint_id ?? "")) || checkpoint.topic_id !== bound.topic.topic_id ||
      checkpoint.working_set_id !== bound.workingSetId || checkpoint.session_id !== bound.membership.session_id
    ) fail("topic_checkpoint_invalid");
    const existing = bound.state.checkpoints.get(checkpoint.checkpoint_id);
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(checkpoint)) fail("topic_checkpoint_conflict");
      return existing;
    }
    append(bound.exact.workspaceId, {
      schema: "supermemory.topic-event.v1", type: "checkpoint.appended",
      workspace_id: bound.exact.workspaceId, checkpoint
    });
    return checkpoint;
  });

  const enrichCheckpoint = (input = {}) => withVaultMutationLock(vault, () => {
    const bound = readBound(input);
    const checkpointId = assertId(input.checkpointId ?? input.checkpoint_id, CHECKPOINT_ID, "topic_checkpoint_invalid");
    const checkpoint = bound.state.checkpoints.get(checkpointId);
    const enrichment = structuredClone(input.enrichment);
    if (!checkpoint || checkpoint.topic_id !== bound.topic.topic_id || checkpoint.working_set_id !== bound.workingSetId) {
      fail("topic_checkpoint_invalid");
    }
    if (
      enrichment?.authoritative !== false || typeof enrichment.text !== "string" || !enrichment.text.trim() ||
      !Array.isArray(enrichment.based_on) || enrichment.based_on.length === 0 ||
      typeof enrichment.hash !== "string"
    ) fail("topic_checkpoint_enrichment_invalid");
    if (checkpoint.enrichment) {
      if (canonicalJson(checkpoint.enrichment) !== canonicalJson(enrichment)) fail("topic_checkpoint_conflict");
      return checkpoint;
    }
    const state = append(bound.exact.workspaceId, {
      schema: "supermemory.topic-event.v1",
      type: "checkpoint.enriched",
      workspace_id: bound.exact.workspaceId,
      checkpoint_id: checkpointId,
      enrichment
    });
    return state.checkpoints.get(checkpointId);
  });

  const listMembers = (input = {}) => {
    const bound = readBound(input);
    return [...bound.state.memberships.values()].filter((membership) => (
      membership.topic_id === bound.topic.topic_id && membership.unbound_at === null
    )).sort((left, right) => left.bound_at.localeCompare(right.bound_at) || left.working_set_id.localeCompare(right.working_set_id));
  };

  const getContext = (input = {}) => {
    const bound = readBound(input);
    const checkpoints = [...bound.state.checkpoints.values()].filter((checkpoint) => checkpoint.topic_id === bound.topic.topic_id)
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.checkpoint_id.localeCompare(right.checkpoint_id));
    return Object.freeze({
      topic: structuredClone(bound.topic),
      current_membership: structuredClone(bound.membership),
      memberships: listMembers(input).map((item) => structuredClone(item)),
      checkpoints: checkpoints.map((item) => structuredClone(item)),
      suggestions: [...bound.state.suggestions.values()].filter((item) => item.topic_id === bound.topic.topic_id).map((item) => structuredClone(item))
    });
  };

  const suggestLink = (input = {}) => withVaultMutationLock(vault, () => {
    const bound = readBound(input);
    const candidateTopicId = assertId(input.candidateTopicId ?? input.candidate_topic_id, TOPIC_ID, "topic_unknown");
    const candidate = bound.state.topics.get(candidateTopicId);
    if (!candidate || candidate.project_id !== bound.exact.projectId || candidate.topic_id === bound.topic.topic_id) fail("topic_unknown");
    const fingerprint = sha256(canonicalJson([bound.topic.topic_id, candidateTopicId].sort()));
    const suggestion = {
      schema: "supermemory.topic-suggested-link.v1", fingerprint,
      topic_id: bound.topic.topic_id, candidate_topic_id: candidateTopicId,
      reason_codes: [...new Set(input.reasonCodes ?? input.reason_codes ?? ["semantic_only"])].sort(),
      score: Number(input.score ?? 0), created_at: now(), active: false
    };
    append(bound.exact.workspaceId, { schema: "supermemory.topic-event.v1", type: "topic.suggested_link", workspace_id: bound.exact.workspaceId, suggestion });
    return suggestion;
  });

  return Object.freeze({
    root,
    createRoot,
    bind,
    appendCheckpoint,
    enrichCheckpoint,
    listMembers,
    getContext,
    suggestLink,
    replay: ({ workspaceId, workspace_id } = {}) => cloneState(replay(workspaceId ?? workspace_id))
  });
}
