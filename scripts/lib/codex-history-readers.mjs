import crypto from "node:crypto";
import fs from "node:fs";

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
  return `${bytes.subarray(0, maxBytes - 64).toString("utf8")}\n[TRUNCATED sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}]`;
}

function parseLines(filePath) {
  return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try {
      return { line: index + 1, value: JSON.parse(line) };
    } catch {
      fail("history_schema_unknown");
    }
  });
}

export function readCodexRolloutHistory(source, {
  binding,
  maxEventBytes = 524_288,
  observedAt = new Date().toISOString()
} = {}) {
  if (source?.format !== "codex-rollout-jsonl.v1" || !binding) fail("history_schema_unknown");
  const rows = parseLines(source.file);
  const meta = rows[0]?.value;
  if (meta?.type !== "session_meta" || String(meta.payload?.id) !== source.session_id) {
    fail("history_schema_unknown");
  }
  const nativeSession = safeExternal(source.session_id);
  const sessionId = `ses_${nativeSession}`;
  const base = {
    adapter: "history_import",
    adapter_version: "codex-rollout-jsonl.v1",
    project_id: binding.projectId,
    workspace_id: binding.workspaceId,
    checkout_id: binding.checkoutId,
    session_id: sessionId,
    thread_id: nativeSession,
    redaction_profile: "redaction.v1",
    capture_level: "backfill"
  };
  const candidates = [{
    row: rows[0],
    event_type: "session.started",
    payload: {
      source: "codex_history",
      cli_version: source.cli_version,
      model_provider: source.model_provider,
      historical: true
    }
  }];
  for (const row of rows.slice(1)) {
    const item = row.value;
    if (item?.type === "event_msg" && item.payload?.type === "user_message") {
      candidates.push({
        row,
        event_type: "prompt.submitted",
        turn_id: item.payload.turn_id ? `turn_${safeExternal(item.payload.turn_id)}` : null,
        payload: { prompt: boundedText(item.payload.message ?? "", maxEventBytes), historical: true }
      });
      continue;
    }
    if (item?.type === "event_msg" && item.payload?.type === "agent_message") {
      candidates.push({
        row,
        event_type: "turn.completed",
        payload: { assistant_message: boundedText(item.payload.message ?? "", maxEventBytes), historical: true }
      });
      continue;
    }
    if (item?.type === "response_item" && item.payload?.type === "function_call") {
      candidates.push({
        row,
        event_type: "tool.completed",
        item_id: item.payload.call_id ? safeExternal(item.payload.call_id) : null,
        payload: {
          tool_name: String(item.payload.name ?? "unknown").slice(0, 180),
          arguments_imported: false,
          output_imported: false,
          historical: true
        }
      });
    }
  }
  const assistant = candidates.filter((item) => item.event_type === "turn.completed").at(-1);
  if (assistant) assistant.event_type = "assistant.completed";
  const finalTimestamp = rows.at(-1)?.value?.timestamp ?? source.started_at;
  candidates.push({
    row: { line: rows.length + 1, value: { timestamp: finalTimestamp } },
    event_type: "session.ended",
    payload: { reason: "history_import_complete", historical: true }
  });
  return candidates.map((item, sequence) => ({
    ...base,
    external_event_id: `${source.source_hash}:${item.row.line}`,
    event_type: item.event_type,
    occurred_at: Number.isFinite(Date.parse(item.row.value.timestamp))
      ? item.row.value.timestamp
      : source.started_at,
    observed_at: observedAt,
    sequence,
    turn_id: item.turn_id ?? null,
    item_id: item.item_id ?? null,
    payload: item.payload
  }));
}
