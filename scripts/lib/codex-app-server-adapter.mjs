import crypto from "node:crypto";
import { payloadHash } from "./codex-event-envelope.mjs";

export const CODEX_APP_SERVER_PROFILE_0_125 = Object.freeze({
  schema: "supermemory.codex-app-server-profile.v1",
  codexVersion: "codex-cli 0.125.0",
  protocol: "v2",
  authoritativeNotification: "item/completed",
  supportedItemTypes: [
    "userMessage",
    "agentMessage",
    "reasoning",
    "plan",
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "collabToolCall",
    "webSearch",
    "imageView",
    "contextCompaction"
  ]
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function safeId(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9._:-]{1,180}$/.test(text)) return text;
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function notificationIds(message) {
  const params = message?.params ?? {};
  return {
    threadId: params.threadId ?? params.thread?.id ?? params.turn?.threadId ?? null,
    turnId: params.turnId ?? params.turn?.id ?? null,
    item: params.item ?? null
  };
}

function itemEventType(type) {
  if (type === "userMessage") return "prompt.submitted";
  if (type === "agentMessage" || type === "reasoning") return "assistant.completed";
  if (type === "fileChange") return "file.changed";
  if (type === "contextCompaction") return "context.compacted";
  return "tool.completed";
}

function itemSlot(item) {
  const id = String(item.id ?? "unknown");
  if (item.type === "userMessage") return "prompt.submitted";
  if (item.type === "agentMessage") return "assistant.final";
  if (item.type === "reasoning") return "assistant.reasoning_summary";
  if (item.type === "fileChange") return `file.${id}.changed`;
  if (item.type === "contextCompaction") return "context.compacted";
  return `tool.${id}.completed`;
}

function visibleItemPayload(item) {
  const base = { item_type: item.type, authoritative: true };
  if (item.type === "userMessage") return { ...base, content: item.content ?? item.text ?? null };
  if (item.type === "agentMessage") return { ...base, text: item.text ?? item.content ?? null };
  if (item.type === "reasoning") {
    if (item.summary === undefined || item.summary === null) return null;
    return { ...base, visible_summary: item.summary };
  }
  if (item.type === "plan") return { ...base, text: item.text ?? item.plan ?? null };
  if (item.type === "commandExecution") {
    return {
      ...base,
      command: item.command ?? null,
      status: item.status ?? null,
      exit_code: item.exitCode ?? null,
      output: item.aggregatedOutput ?? item.output ?? null
    };
  }
  if (item.type === "fileChange") {
    return { ...base, status: item.status ?? null, changes: item.changes ?? [] };
  }
  if (["mcpToolCall", "dynamicToolCall", "collabToolCall"].includes(item.type)) {
    return {
      ...base,
      tool: item.tool ?? item.name ?? item.server ?? null,
      arguments: item.arguments ?? item.input ?? null,
      result: item.result ?? item.output ?? null,
      status: item.status ?? null
    };
  }
  if (item.type === "webSearch") return { ...base, query: item.query ?? null, result: item.result ?? null };
  if (item.type === "imageView") return { ...base, image: item.image ?? item.path ?? null };
  if (item.type === "contextCompaction") return { ...base, summary: item.summary ?? null };
  return null;
}

export function createCodexAppServerAdapter({
  binding,
  capture,
  equivalenceStore,
  snapshotStore,
  onSourceInvalidated = async () => {},
  schemaProfile = CODEX_APP_SERVER_PROFILE_0_125,
  clock = () => new Date().toISOString()
} = {}) {
  if (!binding?.projectId || !binding?.workspaceId || !binding?.checkoutId) {
    fail("app_server_binding_invalid");
  }
  if (
    typeof capture !== "function" ||
    !equivalenceStore ||
    !snapshotStore ||
    typeof onSourceInvalidated !== "function"
  ) {
    fail("app_server_dependencies_invalid");
  }
  if (
    schemaProfile?.schema !== "supermemory.codex-app-server-profile.v1" ||
    schemaProfile.protocol !== "v2" ||
    schemaProfile.authoritativeNotification !== "item/completed"
  ) fail("app_server_schema_incompatible");
  const supported = new Set(schemaProfile.supportedItemTypes);
  const sessions = new Map();

  const ensureSession = (threadId) => {
    if (!threadId) fail("app_server_thread_unresolved");
    let session = sessions.get(threadId);
    if (!session) {
      equivalenceStore.bindSession({
        workspaceId: binding.workspaceId,
        sessionId: threadId,
        captureMode: "app_server_primary",
        primaryAdapter: "app_server",
        shadowAdapter: "hook"
      });
      const existing = equivalenceStore.snapshot().sessions.find((entry) => (
        entry.workspaceId === binding.workspaceId && entry.sessionId === threadId
      ));
      const maximum = Math.max(-1, ...(existing?.observations ?? []).map((item) => item.sequence));
      session = { threadId, nextSequence: maximum + 1, turns: new Map() };
      sessions.set(threadId, session);
    }
    return session;
  };

  const ensureTurn = (session, turnId) => {
    if (!turnId) fail("app_server_turn_unresolved");
    let turn = session.turns.get(turnId);
    if (!turn) {
      turn = {
        turnId,
        eventIds: [],
        fileChanges: [],
        partial: false,
        gaps: [],
        seenItems: new Map(),
        completedSnapshot: null
      };
      session.turns.set(turnId, turn);
    }
    return turn;
  };

  const captureObservation = async ({
    session,
    turn,
    method,
    itemId = null,
    eventType,
    eventSlot,
    payload
  }) => {
    const normalizedHash = payloadHash(payload);
    const existingLogical = equivalenceStore.snapshot().logicalEvents.find((logical) => (
      logical.observations.some((observation) => (
        observation.adapter === "app_server" &&
        observation.event_slot === eventSlot &&
        observation.payload_hash === normalizedHash &&
        observation.session_id === session.threadId
      ))
    ));
    const existingObservation = existingLogical?.observations.find((item) => item.adapter === "app_server");
    const sequence = existingObservation?.sequence ?? session.nextSequence++;
    const rawTurnId = turn.turnId;
    const event = {
      adapter: "app_server",
      adapter_version: schemaProfile.codexVersion,
      external_event_id: `app_server:${method}:${itemId ?? rawTurnId}`,
      project_id: binding.projectId,
      workspace_id: binding.workspaceId,
      checkout_id: binding.checkoutId,
      session_id: `ses_app_server:${safeId(session.threadId)}`,
      thread_id: session.threadId,
      turn_id: `turn_app_server:${safeId(rawTurnId)}`,
      item_id: itemId,
      event_type: eventType,
      occurred_at: clock(),
      capture_level: "rich",
      sequence,
      payload
    };
    const captured = await capture(event);
    if (!captured?.eventId || captured.durable !== true) fail("app_server_capture_not_durable");
    const equivalence = equivalenceStore.recordObservation({
      workspaceId: binding.workspaceId,
      sessionId: session.threadId,
      canonicalTurnId: rawTurnId,
      eventSlot,
      normalizedPayloadHash: normalizedHash,
      eventId: captured.eventId,
      adapter: "app_server",
      sequence
    });
    if (!turn.eventIds.includes(captured.eventId)) turn.eventIds.push(captured.eventId);
    equivalenceStore.checkpointPrimary({
      workspaceId: binding.workspaceId,
      sessionId: session.threadId,
      sequence
    });
    return { captured, equivalence, sequence };
  };

  const handle = async (message) => {
    const method = message?.method;
    if (typeof method !== "string") return { status: "ignored", reason: "not_notification" };
    if (method.includes("/delta") || method.includes("/outputDelta") || method.includes("/patchUpdated")) {
      return { status: "telemetry_ignored", authoritative: false };
    }
    const { threadId, turnId, item } = notificationIds(message);
    if (method === "thread/started") {
      ensureSession(threadId);
      return { status: "session_bound", coverage: "rich" };
    }
    if (method === "turn/started") {
      const session = ensureSession(threadId);
      ensureTurn(session, turnId);
      return { status: "turn_started", coverage: "rich" };
    }
    if (method === "item/completed") {
      const session = ensureSession(threadId);
      const turn = ensureTurn(session, turnId);
      if (!item?.id || !supported.has(item.type)) {
        turn.partial = true;
        turn.gaps.push({ reason: "item_schema_unknown", item_type: item?.type ?? null });
        return { status: "capture_gap", coverage: "partial", reason: "item_schema_unknown" };
      }
      const visiblePayload = visibleItemPayload(item);
      if (visiblePayload === null) {
        return { status: "reasoning_internal_ignored", authoritative: false };
      }
      if (turn.seenItems.has(item.id)) return turn.seenItems.get(item.id);
      const observation = await captureObservation({
        session,
        turn,
        method,
        itemId: String(item.id),
        eventType: itemEventType(item.type),
        eventSlot: itemSlot(item),
        payload: visiblePayload
      });
      if (item.type === "fileChange") {
        turn.fileChanges.push({ itemId: String(item.id), changes: item.changes ?? [] });
      }
      const result = {
        status: "item_captured",
        authoritative: true,
        appliesEffect: observation.equivalence.appliesEffect,
        eventId: observation.captured.eventId,
        sequence: observation.sequence,
        coverage: turn.partial ? "partial" : "rich"
      };
      turn.seenItems.set(item.id, result);
      return result;
    }
    if (method === "turn/completed") {
      const session = ensureSession(threadId);
      const turn = ensureTurn(session, turnId);
      if (turn.completedSnapshot) return { ...turn.completedSnapshot, replayed: true };
      const status = message.params?.turn?.status ?? message.params?.status ?? "completed";
      const completed = await captureObservation({
        session,
        turn,
        method,
        eventType: "turn.completed",
        eventSlot: "turn.completed",
        payload: { status, authoritative: true }
      });
      const fileSnapshotIds = [];
      for (const entry of turn.fileChanges) {
        for (const [index, change] of entry.changes.entries()) {
          const filePath = change.path ?? change.filePath;
          if (!filePath) {
            turn.partial = true;
            continue;
          }
          const snapshot = snapshotStore.createFileSnapshot({
            workspaceId: binding.workspaceId,
            turnId,
            itemId: `${entry.itemId}:${index}`,
            filePath,
            renamedFromPath: change.renamedFromPath ??
              change.previousPath ??
              change.oldPath ??
              null,
            beforeHash: change.beforeHash ?? null,
            afterHash: change.afterHash ?? null
          });
          fileSnapshotIds.push(snapshot.snapshotId);
          if (snapshot.invalidatedSnapshotIds.length > 0) {
            await onSourceInvalidated({
              workspaceId: binding.workspaceId,
              projectId: binding.projectId,
              sourceId: snapshot.sourceId,
              invalidatedSnapshotIds: snapshot.invalidatedSnapshotIds,
              replacementSnapshotId: snapshot.snapshotId,
              reason: "source_changed"
            });
          }
        }
      }
      const turnSnapshot = snapshotStore.createTurnSnapshot({
        workspaceId: binding.workspaceId,
        turnId,
        eventIds: turn.eventIds,
        fileSnapshotIds,
        gitHeadBefore: message.params?.gitHeadBefore ?? null,
        gitHeadAfter: message.params?.gitHeadAfter ?? null,
        completion: turn.partial ? "partial" : "complete",
        completedAt: clock()
      });
      turn.completedSnapshot = {
        status: "turn_snapshotted",
        authoritative: true,
        eventId: completed.captured.eventId,
        turnSnapshotId: turnSnapshot.turnSnapshotId,
        manifestHash: turnSnapshot.manifestHash,
        coverage: turn.partial ? "partial" : "rich"
      };
      return turn.completedSnapshot;
    }
    if (method.startsWith("item/") || method.startsWith("turn/")) {
      return { status: "ignored", reason: "notification_not_authoritative" };
    }
    return { status: "ignored", reason: "notification_unsupported" };
  };

  return { schemaProfile, handle };
}
