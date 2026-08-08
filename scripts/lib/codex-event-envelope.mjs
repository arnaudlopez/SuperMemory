import crypto from "node:crypto";
import { canonicalJson } from "./codex-redaction.mjs";

const PROJECT_ID = /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_ID = /^ws_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKOUT_ID = /^co_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID = /^ses_[A-Za-z0-9._:-]{1,240}$/;
const TURN_ID = /^turn_[A-Za-z0-9._:-]{1,240}$/;
const EVENT_ID = /^evt_[0-9a-f]{64}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const BLOB_REF = /^blob:sha256:[0-9a-f]{64}$/;
const ADAPTERS = new Set(["app_server", "hook", "history_import"]);
const CAPTURE_LEVELS = new Set(["rich", "standard", "backfill"]);
const EVENT_TYPES = new Set([
  "session.started",
  "prompt.submitted",
  "tool.completed",
  "file.changed",
  "assistant.completed",
  "turn.completed",
  "session.ended",
  "context.compacted"
]);

export class CodexEventError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CodexEventError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CodexEventError(code, message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requiredString(value, field, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    fail("event_envelope_invalid", `Invalid ${field}.`);
  }
  return value;
}

function optionalString(value, field, pattern = null) {
  if (value === null || value === undefined) return null;
  return requiredString(value, field, pattern);
}

function timestamp(value, field) {
  requiredString(value, field);
  if (!Number.isFinite(Date.parse(value))) fail("event_envelope_invalid", `Invalid ${field}.`);
  return value;
}

export function payloadHash(payload) {
  return `sha256:${sha256(canonicalJson(payload ?? {}))}`;
}

function eventIdentity(input, hash) {
  return canonicalJson({
    adapter: input.adapter,
    external_event_id: input.external_event_id ?? null,
    project_id: input.project_id,
    workspace_id: input.workspace_id,
    checkout_id: input.checkout_id,
    session_id: input.session_id,
    thread_id: input.thread_id ?? null,
    turn_id: input.turn_id ?? null,
    item_id: input.item_id ?? null,
    event_type: input.event_type,
    sequence: input.sequence,
    payload_hash: hash
  });
}

export function createCodexEventEnvelope(input, {
  observedAt = new Date().toISOString()
} = {}) {
  if (!input || typeof input !== "object") fail("event_envelope_invalid", "Event input is required.");
  const hash = payloadHash(input.payload);
  const envelope = {
    schema: "supermemory.codex-event.v1",
    event_id: `evt_${sha256(eventIdentity(input, hash))}`,
    adapter: input.adapter,
    adapter_version: input.adapter_version,
    external_event_id: input.external_event_id ?? null,
    project_id: input.project_id,
    workspace_id: input.workspace_id,
    checkout_id: input.checkout_id,
    session_id: input.session_id,
    thread_id: input.thread_id ?? null,
    turn_id: input.turn_id ?? null,
    item_id: input.item_id ?? null,
    event_type: input.event_type,
    occurred_at: input.occurred_at ?? observedAt,
    observed_at: observedAt,
    payload_hash: hash,
    payload_ref: null,
    redaction_profile: input.redaction_profile ?? "redaction.v1",
    capture_level: input.capture_level,
    sequence: input.sequence,
    causation_id: input.causation_id ?? null
  };
  return validateCodexEventEnvelope(envelope);
}

export function validateCodexEventEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    fail("event_envelope_invalid", "Event envelope must be an object.");
  }
  if (envelope.schema !== "supermemory.codex-event.v1") {
    fail("event_envelope_invalid", "Unsupported event schema.");
  }
  requiredString(envelope.event_id, "event_id", EVENT_ID);
  if (!ADAPTERS.has(envelope.adapter)) fail("event_envelope_invalid", "Invalid adapter.");
  requiredString(envelope.adapter_version, "adapter_version");
  optionalString(envelope.external_event_id, "external_event_id");
  requiredString(envelope.project_id, "project_id", PROJECT_ID);
  requiredString(envelope.workspace_id, "workspace_id", WORKSPACE_ID);
  requiredString(envelope.checkout_id, "checkout_id", CHECKOUT_ID);
  requiredString(envelope.session_id, "session_id", SESSION_ID);
  optionalString(envelope.thread_id, "thread_id");
  optionalString(envelope.turn_id, "turn_id", TURN_ID);
  optionalString(envelope.item_id, "item_id");
  if (!EVENT_TYPES.has(envelope.event_type)) fail("event_envelope_invalid", "Invalid event_type.");
  timestamp(envelope.occurred_at, "occurred_at");
  timestamp(envelope.observed_at, "observed_at");
  requiredString(envelope.payload_hash, "payload_hash", HASH);
  if (envelope.payload_ref !== null) requiredString(envelope.payload_ref, "payload_ref", BLOB_REF);
  if (envelope.redaction_profile !== "redaction.v1") {
    fail("event_envelope_invalid", "Invalid redaction_profile.");
  }
  if (!CAPTURE_LEVELS.has(envelope.capture_level)) {
    fail("event_envelope_invalid", "Invalid capture_level.");
  }
  if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0) {
    fail("event_envelope_invalid", "Invalid sequence.");
  }
  if (envelope.causation_id !== null) requiredString(envelope.causation_id, "causation_id", EVENT_ID);
  return { ...envelope };
}

export function assertPreparedCapture(prepared) {
  if (prepared?.schema !== "supermemory.prepared-capture.v1") {
    fail("prepared_capture_invalid", "Unsupported prepared capture.");
  }
  const envelope = validateCodexEventEnvelope(prepared.envelope);
  if (payloadHash(prepared.payload) !== envelope.payload_hash) {
    fail("prepared_capture_invalid", "Prepared payload hash does not match its envelope.");
  }
  if (prepared.redaction?.profile !== "redaction.v1") {
    fail("prepared_capture_invalid", "Prepared capture lacks redaction evidence.");
  }
  return {
    schema: prepared.schema,
    envelope,
    payload: prepared.payload,
    redaction: prepared.redaction
  };
}
