import crypto from "node:crypto";
import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";

export const CODEX_HISTORY_READER_VERSION = "codex-rollout-jsonl.v3";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function safeExternal(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9._:-]{1,180}$/.test(text)) return text;
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function boundedText(value, maxBytes) {
  const text = String(value ?? "");
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return text;
  const marker = `\n[TRUNCATED sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}]`;
  const available = Math.max(0, maxBytes - Buffer.byteLength(marker));
  let prefix = bytes.subarray(0, available).toString("utf8");
  while (Buffer.byteLength(prefix) > available) prefix = prefix.slice(0, -1);
  return `${prefix}${marker}`;
}

function* parseLines(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let line = 0;
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const length = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!length) break;
      pending += decoder.write(buffer.subarray(0, length));
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const text = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        line += 1;
        if (!text) continue;
        try {
          yield { line, value: JSON.parse(text) };
        } catch {
          fail("history_schema_unknown");
        }
      }
    }
    pending += decoder.end();
    if (pending) {
      line += 1;
      try {
        yield { line, value: JSON.parse(pending) };
      } catch {
        fail("history_schema_unknown");
      }
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateMeta(source, row) {
  const meta = row?.value;
  if (
    source?.format !== "codex-rollout-jsonl.v1" ||
    meta?.type !== "session_meta" || String(meta.payload?.id) !== source.session_id
  ) fail("history_schema_unknown");
}

function candidate(row) {
  const item = row.value;
  if (item?.type === "event_msg" && item.payload?.type === "user_message") {
    return { event_type: "prompt.submitted", turn_id: item.payload.turn_id, payload_key: "prompt", text: item.payload.message };
  }
  if (item?.type === "event_msg" && item.payload?.type === "agent_message") {
    return { event_type: "turn.completed", turn_id: item.payload.turn_id, payload_key: "assistant_message", text: item.payload.message, assistant: true };
  }
  return null;
}

export function inspectCodexRolloutHistory(source) {
  let eventCount = 2;
  let pendingAssistant = false;
  let finalTimestamp = source?.started_at ?? null;
  let first = true;
  for (const row of parseLines(source.file)) {
    if (first) {
      validateMeta(source, row);
      first = false;
    } else {
      const item = candidate(row);
      if (item?.assistant) pendingAssistant = true;
      else if (item) {
        if (pendingAssistant) eventCount += 1;
        pendingAssistant = false;
        eventCount += 1;
      }
    }
    if (Number.isFinite(Date.parse(row.value?.timestamp))) finalTimestamp = row.value.timestamp;
  }
  if (first) fail("history_schema_unknown");
  if (pendingAssistant) eventCount += 1;
  return Object.freeze({ event_count: eventCount, final_timestamp: finalTimestamp });
}

function historyEvent({ base, source, row, item, eventType = item.event_type, observedAt, sequence, maxEventBytes }) {
  return {
    ...base,
    external_event_id: `${source.source_hash}:${row.line}`,
    event_type: eventType,
    occurred_at: Number.isFinite(Date.parse(row.value.timestamp)) ? row.value.timestamp : source.started_at,
    observed_at: observedAt,
    sequence,
    turn_id: item.turn_id ? `turn_${safeExternal(item.turn_id)}` : null,
    item_id: null,
    payload: { [item.payload_key]: boundedText(item.text ?? "", maxEventBytes), historical: true }
  };
}

export function* iterateCodexRolloutHistory(source, {
  binding,
  maxEventBytes = 524_288,
  observedAt = new Date().toISOString(),
  inspection = null
} = {}) {
  if (!binding) fail("history_schema_unknown");
  const stats = inspection ?? inspectCodexRolloutHistory(source);
  const nativeSession = safeExternal(source.session_id);
  const base = {
    adapter: "history_import",
    adapter_version: CODEX_HISTORY_READER_VERSION,
    project_id: binding.projectId,
    workspace_id: binding.workspaceId,
    checkout_id: binding.checkoutId,
    session_id: `ses_${nativeSession}`,
    thread_id: nativeSession,
    redaction_profile: "redaction.v1",
    capture_level: "backfill"
  };
  let sequence = 0;
  let first = true;
  let pendingAssistant = null;
  for (const row of parseLines(source.file)) {
    if (first) {
      validateMeta(source, row);
      first = false;
      yield {
        ...base,
        external_event_id: `${source.source_hash}:${row.line}`,
        event_type: "session.started",
        occurred_at: source.started_at,
        observed_at: observedAt,
        sequence: sequence++,
        turn_id: null,
        item_id: null,
        payload: {
          source: "codex_history",
          source_kind: source.source_kind,
          cli_version: source.cli_version,
          model_provider: source.model_provider,
          historical: true
        }
      };
      continue;
    }
    const item = candidate(row);
    if (!item) continue;
    if (item.assistant) {
      pendingAssistant = { row, item };
      continue;
    }
    if (pendingAssistant) {
      yield historyEvent({ base, source, ...pendingAssistant, observedAt, sequence: sequence++, maxEventBytes });
      pendingAssistant = null;
    }
    yield historyEvent({ base, source, row, item, observedAt, sequence: sequence++, maxEventBytes });
  }
  if (pendingAssistant) {
    yield historyEvent({
      base,
      source,
      ...pendingAssistant,
      eventType: "assistant.completed",
      observedAt,
      sequence: sequence++,
      maxEventBytes
    });
  }
  yield {
    ...base,
    external_event_id: `${source.source_hash}:session-ended`,
    event_type: "session.ended",
    occurred_at: stats.final_timestamp ?? source.started_at,
    observed_at: observedAt,
    sequence,
    turn_id: null,
    item_id: null,
    payload: { reason: "history_import_complete", historical: true }
  };
}

export function readCodexRolloutHistory(source, options = {}) {
  return [...iterateCodexRolloutHistory(source, options)];
}
