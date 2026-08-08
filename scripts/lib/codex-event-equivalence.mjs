import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function realDirectory(requested) {
  const resolved = path.resolve(requested);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("equivalence_vault_invalid");
  return fs.realpathSync(resolved);
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/")) {
    const target = path.join(current, segment);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("equivalence_path_invalid");
    } else fs.mkdirSync(target, { mode: 0o700 });
    fs.chmodSync(target, 0o700);
    current = fs.realpathSync(target);
  }
  return current;
}

function atomicWrite(filePath, content) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function readEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      fail("equivalence_log_invalid");
    }
  });
}

function sessionKey(workspaceId, sessionId) {
  return `${workspaceId}\0${sessionId}`;
}

function reduce(events) {
  const sessions = new Map();
  const logicalEvents = new Map();
  for (const event of events) {
    if (event?.schema !== "supermemory.event-equivalence-log.v1") fail("equivalence_log_invalid");
    const key = sessionKey(event.workspace_id, event.session_id);
    if (event.type === "session.bound") {
      if (sessions.has(key)) fail("equivalence_log_invalid");
      sessions.set(key, {
        workspaceId: event.workspace_id,
        sessionId: event.session_id,
        captureMode: event.capture_mode,
        primaryAdapter: event.primary_adapter,
        shadowAdapter: event.shadow_adapter,
        coverage: event.capture_mode === "app_server_primary" ? "rich" : "partial",
        checkpoint: -1,
        failed: false,
        observations: []
      });
    } else if (event.type === "observation.recorded") {
      const session = sessions.get(key);
      if (!session) fail("equivalence_log_invalid");
      session.observations.push(event);
      let logical = logicalEvents.get(event.logical_event_id);
      if (!logical) {
        logical = { logicalEventId: event.logical_event_id, observations: [], appliedEventId: null };
        logicalEvents.set(event.logical_event_id, logical);
      }
      if (logical.observations.some((item) => item.event_id === event.event_id)) {
        fail("equivalence_log_invalid");
      }
      logical.observations.push(event);
      if (event.applies_effect) {
        if (logical.appliedEventId) fail("equivalence_double_effect");
        logical.appliedEventId = event.event_id;
      }
    } else if (event.type === "primary.checkpoint") {
      const session = sessions.get(key);
      if (!session || event.sequence < session.checkpoint) fail("equivalence_log_invalid");
      session.checkpoint = event.sequence;
    } else if (event.type === "primary.failed") {
      const session = sessions.get(key);
      if (!session || session.captureMode !== "app_server_primary" || session.failed) {
        fail("equivalence_log_invalid");
      }
      session.failed = true;
      session.coverage = "partial";
      session.checkpoint = event.last_primary_sequence;
    } else if (event.type === "shadow.promoted") {
      const session = sessions.get(key);
      const logical = logicalEvents.get(event.logical_event_id);
      if (!session?.failed || !logical || logical.appliedEventId) fail("equivalence_log_invalid");
      const observation = logical.observations.find((item) => item.event_id === event.event_id);
      if (!observation || observation.adapter !== session.shadowAdapter) fail("equivalence_log_invalid");
      logical.appliedEventId = event.event_id;
    } else fail("equivalence_log_invalid");
  }
  return { sessions, logicalEvents };
}

export function computeLogicalEventId({
  workspaceId,
  canonicalSessionId,
  canonicalTurnId,
  eventSlot,
  normalizedPayloadHash
}) {
  for (const value of [
    workspaceId,
    canonicalSessionId,
    canonicalTurnId,
    eventSlot,
    normalizedPayloadHash
  ]) {
    if (typeof value !== "string" || value.length === 0) fail("logical_event_scope_invalid");
  }
  return `logical_${sha256(canonicalJson({
    workspace_id: workspaceId,
    session_id: canonicalSessionId,
    turn_id: canonicalTurnId,
    event_slot: eventSlot,
    payload_hash: normalizedPayloadHash
  }))}`;
}

export function createEventEquivalenceStore({
  vaultRoot,
  storageRoot = null,
  clock = () => new Date().toISOString()
} = {}) {
  const vault = realDirectory(storageRoot ?? vaultRoot);
  const directory = ensureDirectory(
    vault,
    storageRoot ? "event-equivalence" : "00_inbox/supermemory-product"
  );
  const filePath = path.join(directory, "event-equivalence.jsonl");

  const mutate = (build) => withVaultMutationLock(vault, () => {
    const current = readEvents(filePath);
    const view = reduce(current);
    const additions = build(view);
    const next = [...current, ...additions];
    const nextView = reduce(next);
    if (additions.length > 0) {
      atomicWrite(filePath, `${next.map((event) => JSON.stringify(event)).join("\n")}\n`);
    }
    return nextView;
  });
  const event = (type, fields) => ({
    schema: "supermemory.event-equivalence-log.v1",
    type,
    occurred_at: clock(),
    ...fields
  });

  const bindSession = ({
    workspaceId,
    sessionId,
    captureMode,
    primaryAdapter,
    shadowAdapter = null
  }) => {
    const key = sessionKey(workspaceId, sessionId);
    const view = mutate((current) => {
      const existing = current.sessions.get(key);
      if (existing) {
        if (
          existing.captureMode !== captureMode ||
          existing.primaryAdapter !== primaryAdapter ||
          existing.shadowAdapter !== shadowAdapter
        ) fail("session_capture_binding_conflict");
        return [];
      }
      return [event("session.bound", {
        workspace_id: workspaceId,
        session_id: sessionId,
        capture_mode: captureMode,
        primary_adapter: primaryAdapter,
        shadow_adapter: shadowAdapter
      })];
    });
    return { ...view.sessions.get(key) };
  };

  const recordObservation = ({
    workspaceId,
    sessionId,
    canonicalTurnId,
    eventSlot,
    normalizedPayloadHash,
    eventId,
    adapter,
    sequence
  }) => {
    const logicalEventId = computeLogicalEventId({
      workspaceId,
      canonicalSessionId: sessionId,
      canonicalTurnId,
      eventSlot,
      normalizedPayloadHash
    });
    let result;
    mutate((view) => {
      const session = view.sessions.get(sessionKey(workspaceId, sessionId));
      if (!session) fail("session_capture_binding_missing");
      const logical = view.logicalEvents.get(logicalEventId);
      const duplicate = logical?.observations.find((item) => item.event_id === eventId);
      if (duplicate) {
        result = {
          logicalEventId,
          appliesEffect: logical.appliedEventId === eventId,
          duplicate: true
        };
        return [];
      }
      const primary = !session.failed && adapter === session.primaryAdapter;
      const promotableShadow = (
        session.failed &&
        adapter === session.shadowAdapter &&
        sequence > session.checkpoint
      );
      const appliesEffect = !logical?.appliedEventId && (primary || promotableShadow);
      result = { logicalEventId, appliesEffect, duplicate: false };
      return [event("observation.recorded", {
        workspace_id: workspaceId,
        session_id: sessionId,
        logical_event_id: logicalEventId,
        event_id: eventId,
        adapter,
        sequence,
        event_slot: eventSlot,
        payload_hash: normalizedPayloadHash,
        applies_effect: appliesEffect
      })];
    });
    return result;
  };

  const checkpointPrimary = ({ workspaceId, sessionId, sequence }) => {
    mutate((view) => {
      const session = view.sessions.get(sessionKey(workspaceId, sessionId));
      if (!session || session.failed || sequence < session.checkpoint) {
        fail("primary_checkpoint_invalid");
      }
      return [event("primary.checkpoint", {
        workspace_id: workspaceId,
        session_id: sessionId,
        sequence
      })];
    });
    return { durable: true, sequence };
  };

  const confirmPrimaryFailure = ({
    workspaceId,
    sessionId,
    lastPrimarySequence,
    confirmedGap
  }) => {
    if (confirmedGap !== true) fail("primary_gap_confirmation_required");
    let promoted = [];
    const key = sessionKey(workspaceId, sessionId);
    const view = mutate((current) => {
      const session = current.sessions.get(key);
      if (
        !session ||
        session.captureMode !== "app_server_primary" ||
        session.failed ||
        lastPrimarySequence < session.checkpoint
      ) fail("primary_failover_invalid");
      const additions = [event("primary.failed", {
        workspace_id: workspaceId,
        session_id: sessionId,
        last_primary_sequence: lastPrimarySequence,
        confirmed_gap: true
      })];
      promoted = session.observations.filter((observation) => {
        if (observation.adapter !== session.shadowAdapter) return false;
        if (observation.sequence <= lastPrimarySequence) return false;
        return !current.logicalEvents.get(observation.logical_event_id)?.appliedEventId;
      });
      for (const observation of promoted) {
        additions.push(event("shadow.promoted", {
          workspace_id: workspaceId,
          session_id: sessionId,
          logical_event_id: observation.logical_event_id,
          event_id: observation.event_id
        }));
      }
      return additions;
    });
    return {
      coverage: view.sessions.get(key).coverage,
      promotedEventIds: promoted.map((item) => item.event_id)
    };
  };

  const snapshot = () => {
    const view = reduce(readEvents(filePath));
    return {
      sessions: [...view.sessions.values()].map((session) => ({ ...session })),
      logicalEvents: [...view.logicalEvents.values()].map((logical) => ({
        ...logical,
        observations: logical.observations.map((item) => ({ ...item }))
      }))
    };
  };

  return {
    filePath,
    bindSession,
    recordObservation,
    checkpointPrimary,
    confirmPrimaryFailure,
    snapshot
  };
}
