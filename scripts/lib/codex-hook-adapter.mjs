import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { payloadHash } from "./codex-event-envelope.mjs";
import { canonicalJson, hmacFingerprint } from "./codex-redaction.mjs";
import { buildSessionStartContext } from "./codex-session-context.mjs";

export const SUPERMEMORY_HOOK_EVENTS = Object.freeze([
  "SessionStart",
  "UserPromptSubmit",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "Stop",
  "SessionEnd"
]);

const CAPTURE_MODES = new Set([
  "app_server_primary",
  "hooks_primary",
  "backfill_only"
]);

const EVENT_TYPE = Object.freeze({
  SessionStart: "session.started",
  UserPromptSubmit: "prompt.submitted",
  PostToolUse: "tool.completed",
  PreCompact: "context.compacted",
  PostCompact: "context.compacted",
  Stop: "assistant.completed",
  SessionEnd: "session.ended"
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertStateKey(stateKey) {
  if (!Buffer.isBuffer(stateKey) || stateKey.length !== 32) fail("hook_state_key_invalid");
}

function safeExternalId(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9._:-]{1,180}$/.test(text)) return text;
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function existingRuntimeRoot(requestedRoot) {
  const resolved = path.resolve(requestedRoot);
  if (!fs.existsSync(resolved)) fail("hook_runtime_root_missing");
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("hook_runtime_root_invalid");
  return fs.realpathSync(resolved);
}

function ensureDirectory(parent, segment) {
  const target = path.join(parent, segment);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("hook_state_path_invalid");
  } else {
    fs.mkdirSync(target, { mode: 0o700 });
  }
  fs.chmodSync(target, 0o700);
  return fs.realpathSync(target);
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
    // Atomic rename plus file fsync is the portable baseline.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function atomicJson(filePath, value) {
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`);
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

function acquireSessionLock(lockPath) {
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const stat = fs.statSync(lockPath);
  if (Date.now() - stat.mtimeMs > 5_000) {
    fs.rmSync(lockPath, { recursive: true, force: true });
    fs.mkdirSync(lockPath, { mode: 0o700 });
    return;
  }
  fail("hook_session_busy");
}

function readSessionState(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail("hook_session_state_invalid");
  let state;
  try {
    state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail("hook_session_state_invalid");
  }
  if (
    state?.schema !== "supermemory.hook-session.v1" ||
    !CAPTURE_MODES.has(state.capture_mode) ||
    !Number.isSafeInteger(state.next_sequence) ||
    state.next_sequence < 0 ||
    typeof state.seen !== "object"
  ) {
    fail("hook_session_state_invalid");
  }
  return state;
}

function boundValue(value, maxBytes) {
  let serialized;
  try {
    serialized = canonicalJson(value ?? null);
  } catch {
    serialized = JSON.stringify("[UNSERIALIZABLE]");
  }
  const bytes = Buffer.from(serialized);
  if (bytes.length <= maxBytes) return value ?? null;
  const preview = bytes.subarray(0, Math.min(maxBytes, 4_096)).toString("utf8");
  return {
    truncated: true,
    original_bytes: bytes.length,
    content_hash: `sha256:${sha256(bytes)}`,
    preview
  };
}

function eventPayload(eventName, input, captureRole, maxPayloadBytes) {
  const common = {
    capture_role: captureRole,
    transcript: input.transcript_path ? "unparsed" : "unavailable",
    hosted_actions_visible: false
  };
  if (eventName === "SessionStart") {
    return {
      ...common,
      source: input.source ?? "startup",
      model: input.model ?? null,
      permission_mode: input.permission_mode ?? null
    };
  }
  if (eventName === "UserPromptSubmit") {
    return { ...common, prompt: boundValue(input.prompt ?? "", maxPayloadBytes) };
  }
  if (eventName === "PostToolUse") {
    return {
      ...common,
      tool_name: input.tool_name ?? "unknown",
      tool_use_id: input.tool_use_id ?? null,
      tool_input: boundValue(input.tool_input ?? null, Math.floor(maxPayloadBytes / 2)),
      tool_response: boundValue(input.tool_response ?? null, Math.floor(maxPayloadBytes / 2))
    };
  }
  if (eventName === "PreCompact" || eventName === "PostCompact") {
    return {
      ...common,
      stage: eventName === "PreCompact" ? "pre" : "post",
      trigger: input.trigger ?? "unknown"
    };
  }
  if (eventName === "Stop") {
    return {
      ...common,
      last_assistant_message: boundValue(input.last_assistant_message ?? null, maxPayloadBytes),
      stop_hook_active: Boolean(input.stop_hook_active)
    };
  }
  return { ...common, reason: input.reason ?? "other" };
}

function captureRole(captureMode) {
  if (captureMode === "app_server_primary") return "shadow";
  if (captureMode === "hooks_primary") return "primary";
  return "backfill";
}

function equivalentObservation(eventName, input) {
  if (!input.turn_id) return null;
  if (eventName === "UserPromptSubmit") {
    return {
      eventSlot: "prompt.submitted",
      normalizedPayloadHash: payloadHash({
        item_type: "userMessage",
        authoritative: true,
        content: input.prompt ?? ""
      })
    };
  }
  if (eventName === "Stop" && input.last_assistant_message !== undefined) {
    return {
      eventSlot: "assistant.final",
      normalizedPayloadHash: payloadHash({
        item_type: "agentMessage",
        authoritative: true,
        text: input.last_assistant_message
      })
    };
  }
  return null;
}

function eventOutput(eventName, context = null) {
  if (eventName === "SessionEnd") return null;
  if (eventName === "SessionStart") {
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context
      }
    };
  }
  return { continue: true };
}

function handlerCommands(hookConfig, eventName) {
  const groups = hookConfig?.hooks?.[eventName];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => (
    Array.isArray(group?.hooks)
      ? group.hooks
        .filter((hook) => hook?.type === "command" && typeof hook.command === "string")
        .map((hook) => hook.command)
      : []
  ));
}

export function diagnoseCodexHookCoverage({
  sources = [],
  captureMode = "hooks_primary",
  appServerHealthy = false
} = {}) {
  const handlers = {};
  const duplicates = [];
  const missing = [];
  for (const eventName of SUPERMEMORY_HOOK_EVENTS) {
    handlers[eventName] = sources.flatMap((source) => (
      handlerCommands(source.config, eventName)
        .filter((command) => (
          /supermemory/i.test(command) ||
          /supermemory/i.test(String(source.source)) ||
          /supermemory/i.test(String(source.config?.description))
        ))
        .map((command) => ({ source: source.source, command }))
    ));
    if (handlers[eventName].length === 0) missing.push(eventName);
    if (handlers[eventName].length > 1) duplicates.push(eventName);
  }
  const modeValid = CAPTURE_MODES.has(captureMode);
  const coverage = (
    appServerHealthy && captureMode === "app_server_primary"
      ? "rich"
      : missing.length === 0
        ? "partial"
        : "none"
  );
  return {
    status: !modeValid || duplicates.length > 0 ? "error" : "ok",
    captureMode,
    coverage,
    hostedActionsVisible: appServerHealthy,
    transcriptSchema: "unparsed",
    handlers,
    duplicates,
    missing
  };
}

export function createCodexHookAdapter({
  runtimeRoot,
  stateKey,
  binding,
  captureMode = "hooks_primary",
  capture,
  equivalenceStore = null,
  memoryProvider = async () => [],
  workingMapProvider = null,
  clock = () => new Date().toISOString(),
  contextBudget = {},
  maxPayloadBytes = 128 * 1024
} = {}) {
  assertStateKey(stateKey);
  if (!CAPTURE_MODES.has(captureMode)) fail("hook_capture_mode_invalid");
  if (!binding?.projectId || !binding?.workspaceId || !binding?.checkoutId) {
    fail("hook_binding_invalid");
  }
  if (typeof capture !== "function") fail("hook_capture_callback_required");
  if (workingMapProvider !== null && typeof workingMapProvider !== "function") {
    fail("hook_working_map_provider_invalid");
  }
  const runtime = existingRuntimeRoot(runtimeRoot);
  const sessionsRoot = ensureDirectory(ensureDirectory(runtime, "hook-sessions"), binding.workspaceId);

  const handle = async (input) => {
    const eventName = input?.hook_event_name;
    if (!SUPERMEMORY_HOOK_EVENTS.includes(eventName)) {
      return {
        ok: false,
        captured: false,
        coverage: "none",
        reason: "hook_event_unsupported",
        output: null
      };
    }
    if (!input.session_id) {
      return {
        ok: false,
        captured: false,
        coverage: "none",
        reason: "hook_session_missing",
        output: eventOutput(eventName, "SuperMemory indisponible : session non résolue.")
      };
    }
    const externalSessionId = safeExternalId(input.session_id);
    const sessionId = `ses_hook:${externalSessionId}`;
    const turnId = input.turn_id ? `turn_hook:${safeExternalId(input.turn_id)}` : null;
    const sessionFingerprint = hmacFingerprint(sessionId, stateKey, "hook-session")
      .slice("hmac-sha256:".length);
    const statePath = path.join(sessionsRoot, `${sessionFingerprint}.json`);
    const lockPath = `${statePath}.lock`;
    let state;
    let sequence;
    let payload;
    let dedupeKey;
    let modeMismatch = false;
    let lockOwned = false;
    try {
      acquireSessionLock(lockPath);
      lockOwned = true;
      state = readSessionState(statePath) ?? {
        schema: "supermemory.hook-session.v1",
        session_id: sessionId,
        project_id: binding.projectId,
        workspace_id: binding.workspaceId,
        checkout_id: binding.checkoutId,
        capture_mode: captureMode,
        capture_coverage: "partial",
        next_sequence: 0,
        seen: {},
        bound_at: clock(),
        updated_at: clock()
      };
      if (
        state.session_id !== sessionId ||
        state.project_id !== binding.projectId ||
        state.workspace_id !== binding.workspaceId ||
        state.checkout_id !== binding.checkoutId
      ) {
        fail("hook_session_scope_mismatch");
      }
      modeMismatch = state.capture_mode !== captureMode;
      payload = eventPayload(
        eventName,
        input,
        captureRole(state.capture_mode),
        maxPayloadBytes
      );
      dedupeKey = sha256(canonicalJson({
        event: eventName,
        turn: turnId,
        tool: input.tool_use_id ?? null,
        source: input.source ?? null,
        trigger: input.trigger ?? null,
        reason: input.reason ?? null,
        payload
      }));
      const seen = state.seen[dedupeKey];
      if (seen) sequence = seen.sequence;
      else {
        sequence = state.next_sequence;
        state.next_sequence += 1;
        state.seen[dedupeKey] = { sequence, first_seen_at: clock() };
      }
      state.updated_at = clock();
      atomicJson(statePath, state);
    } catch (error) {
      return {
        ok: false,
        captured: false,
        coverage: "partial",
        reason: error?.code ?? error?.message ?? "hook_session_failed",
        output: eventOutput(
          eventName,
          "SuperMemory dégradé : capture de session temporairement indisponible."
        )
      };
    } finally {
      if (lockOwned && fs.existsSync(lockPath)) {
        fs.rmSync(lockPath, { recursive: true, force: true });
      }
    }

    const effectiveMode = state.capture_mode;
    const effectiveRole = captureRole(effectiveMode);
    payload.capture_role = effectiveRole;
    let equivalenceBinding = null;
    if (
      equivalenceStore &&
      ["hooks_primary", "app_server_primary"].includes(effectiveMode)
    ) {
      try {
        equivalenceBinding = equivalenceStore.bindSession({
          workspaceId: binding.workspaceId,
          sessionId: String(input.session_id),
          captureMode: effectiveMode,
          primaryAdapter: effectiveMode === "app_server_primary" ? "app_server" : "hook",
          shadowAdapter: effectiveMode === "app_server_primary" ? "hook" : null
        });
      } catch (error) {
        equivalenceBinding = { error: error?.code ?? error?.message ?? "equivalence_unavailable" };
      }
    }
    let captureResult;
    try {
      captureResult = await capture({
        adapter: "hook",
        adapter_version: "1.0.0",
        external_event_id: `hook:${dedupeKey}`,
        project_id: binding.projectId,
        workspace_id: binding.workspaceId,
        checkout_id: binding.checkoutId,
        session_id: sessionId,
        thread_id: String(input.session_id),
        turn_id: turnId,
        item_id: input.tool_use_id ? String(input.tool_use_id) : null,
        event_type: EVENT_TYPE[eventName],
        occurred_at: clock(),
        capture_level: effectiveRole === "backfill" ? "backfill" : "standard",
        sequence,
        payload
      });
    } catch (error) {
      captureResult = {
        status: "dropped",
        reason: error?.code ?? error?.message ?? "capture_failed"
      };
    }
    let equivalence = null;
    const equivalent = equivalentObservation(eventName, input);
    if (
      equivalent &&
      equivalenceStore &&
      !equivalenceBinding?.error &&
      captureResult?.durable === true &&
      typeof captureResult.eventId === "string"
    ) {
      try {
        equivalence = equivalenceStore.recordObservation({
          workspaceId: binding.workspaceId,
          sessionId: String(input.session_id),
          canonicalTurnId: String(input.turn_id),
          eventSlot: equivalent.eventSlot,
          normalizedPayloadHash: equivalent.normalizedPayloadHash,
          eventId: captureResult.eventId,
          adapter: "hook",
          sequence
        });
      } catch (error) {
        equivalence = { error: error?.code ?? error?.message ?? "equivalence_unavailable" };
      }
    } else if (equivalent && captureResult?.status === "spooled") {
      equivalence = { pending: true, reason: "awaiting_durable_event_id" };
    }

    let memories = [];
    if (eventName === "SessionStart") {
      try {
        const provided = await memoryProvider({
          projectId: binding.projectId,
          workspaceId: binding.workspaceId,
          workingSetId: captureResult?.working?.working_set_id ?? null
        });
        if (Array.isArray(provided)) memories = provided;
      } catch {
        memories = [];
      }
    }
    const daemonStatus = captureResult.status === "delivered"
      ? "ready"
      : captureResult.status === "spooled"
        ? "degraded"
        : "down";
    let context = eventName === "SessionStart"
      ? buildSessionStartContext({
        projectId: binding.projectId,
        workspaceId: binding.workspaceId,
        captureCoverage: "partial",
        daemonStatus,
        memories,
        ...contextBudget
      })
      : null;
    if (
      eventName === "SessionStart" && input.source === "compact" &&
      workingMapProvider && captureResult?.working?.working_set_id
    ) {
      try {
        const workingMap = await workingMapProvider({
          working_set_id: captureResult.working.working_set_id
        });
        if (
          workingMap?.status === "ready" && typeof workingMap.additional_context === "string" &&
          workingMap.additional_context.length > 0 && workingMap.estimated_tokens <= 8_000
        ) {
          context = {
            ...context,
            text: workingMap.additional_context,
            estimatedTokens: workingMap.estimated_tokens,
            workingSetId: captureResult.working.working_set_id,
            source: "working_map"
          };
        }
      } catch {
        // The durable-memory context remains available when the derived map is unavailable.
      }
    }
    const offload = eventName === "PostToolUse" ? captureResult?.working?.offload : null;
    const output = offload?.replacement_enabled === true && offload.suppress_original === true &&
      typeof offload.replacement_text === "string" && offload.replacement_text.length > 0
      ? {
          continue: false,
          stopReason: offload.replacement_text,
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: offload.replacement_text
          }
        }
      : eventOutput(eventName, context?.text ?? null);
    return {
      ok: captureResult.status === "delivered" || captureResult.status === "spooled",
      captured: captureResult.status === "delivered" || captureResult.status === "spooled",
      captureStatus: captureResult.status,
      captureRole: effectiveRole,
      captureMode: effectiveMode,
      modeMismatch,
      coverage: "partial",
      transcriptSchema: input.transcript_path ? "unparsed" : "unavailable",
      hostedActionsVisible: false,
      sessionId,
      turnId,
      sequence,
      equivalence,
      working: captureResult.working ?? null,
      output,
      context
    };
  };

  return { handle };
}
