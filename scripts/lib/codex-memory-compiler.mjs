import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-redaction.mjs";
import { createCodexMemoryGovernance } from "./codex-memory-governance.mjs";
import { createTurnSnapshotStore } from "./codex-turn-snapshot.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3:latest";
const COMPILER_SCHEMA = "supermemory.codex-memory-compiler.v1";
const PROMPT_VERSION = "codex-durable-memory-v1";

const EXTRACTION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    should_create: { type: "boolean" },
    title: { type: "string" },
    proposed_text: { type: "string" },
    type: {
      type: "string",
      enum: ["durable_fact", "decision", "preference", "constraint", "lesson", "open_work"]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    uncertainty: { type: "string" },
    sensitivity: { type: "string", enum: ["standard", "restricted"] }
  },
  required: [
    "should_create",
    "title",
    "proposed_text",
    "type",
    "confidence",
    "uncertainty",
    "sensitivity"
  ]
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function loopbackBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("compiler_ollama_url_invalid");
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    fail("compiler_ollama_remote_forbidden");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function existingDirectory(requested, code) {
  const resolved = path.resolve(requested);
  if (!fs.existsSync(resolved)) fail(`${code}_missing`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${code}_invalid`);
  return fs.realpathSync(resolved);
}

function ensureDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    const target = path.join(current, segment);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("compiler_path_invalid");
    } else {
      fs.mkdirSync(target, { mode: 0o700 });
    }
    fs.chmodSync(target, 0o700);
    current = fs.realpathSync(target);
  }
  return current;
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, `${canonicalJson(value)}\n`);
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

function safeReadJson(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail("compiler_state_invalid");
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (value?.schema !== COMPILER_SCHEMA) fail("compiler_state_invalid");
    return value;
  } catch (error) {
    if (error?.code === "compiler_state_invalid") throw error;
    fail("compiler_state_invalid");
  }
}

function boundedString(value, maximum, code) {
  const text = String(value ?? "").trim();
  if (!text || Buffer.byteLength(text) > maximum) fail(code);
  return text;
}

function messageText(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.preview === "string") {
    return value.preview.trim();
  }
  if (value === null || value === undefined) return "";
  return canonicalJson(value).slice(0, 128 * 1024).trim();
}

function visibleMessages(records) {
  const messages = [];
  for (const record of records) {
    if (record.envelope.event_type === "prompt.submitted") {
      const text = messageText(record.payload?.prompt ?? record.payload?.text);
      if (text) messages.push({ role: "user", text });
    } else if (record.envelope.event_type === "assistant.completed") {
      const text = messageText(
        record.payload?.last_assistant_message ??
        record.payload?.text ??
        record.payload?.message
      );
      if (text) messages.push({ role: "assistant", text });
    }
  }
  return messages;
}

function transcriptForExtraction(messages, maximum) {
  const transcript = messages
    .map((message) => `${message.role === "user" ? "USER" : "ASSISTANT"}:\n${message.text}`)
    .join("\n\n")
    .trim();
  return transcript.length <= maximum ? transcript : transcript.slice(0, maximum);
}

function validateExtraction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("compiler_extraction_invalid");
  }
  if (typeof value.should_create !== "boolean") fail("compiler_extraction_invalid");
  if (!value.should_create) return null;
  const allowedTypes = new Set([
    "durable_fact",
    "decision",
    "preference",
    "constraint",
    "lesson",
    "open_work"
  ]);
  if (
    !allowedTypes.has(value.type) ||
    !["standard", "restricted"].includes(value.sensitivity) ||
    !Number.isFinite(Number(value.confidence)) ||
    Number(value.confidence) < 0 ||
    Number(value.confidence) > 1
  ) fail("compiler_extraction_invalid");
  return {
    title: boundedString(value.title, 16 * 1024, "compiler_extraction_invalid"),
    proposedText: boundedString(
      value.proposed_text,
      128 * 1024,
      "compiler_extraction_invalid"
    ),
    type: value.type,
    confidence: Number(value.confidence),
    uncertainty: String(value.uncertainty ?? "").slice(0, 16 * 1024),
    sensitivity: value.sensitivity
  };
}

export function createOllamaMemoryExtractor({
  baseUrl = DEFAULT_OLLAMA_URL,
  model = DEFAULT_MODEL,
  timeoutMs = 20_000,
  maxInputChars = 24_000,
  fetchImpl = globalThis.fetch
} = {}) {
  const endpoint = loopbackBaseUrl(baseUrl);
  const selectedModel = boundedString(model, 240, "compiler_model_invalid");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60_000
  ) fail("compiler_timeout_invalid");
  if (!Number.isSafeInteger(maxInputChars) || maxInputChars < 1_000 || maxInputChars > 128_000) {
    fail("compiler_input_limit_invalid");
  }
  if (typeof fetchImpl !== "function") fail("compiler_fetch_missing");

  const extract = async ({ messages }) => {
    const transcript = transcriptForExtraction(messages, maxInputChars);
    if (!transcript) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          stream: false,
          think: false,
          format: EXTRACTION_SCHEMA,
          options: { temperature: 0 },
          messages: [
            {
              role: "system",
              content: [
                "Extract at most one durable project memory from the redacted exchange.",
                "Keep only stable decisions, preferences, constraints, lessons, durable facts, or explicit open work.",
                "Reject transient chat, pleasantries, status-only updates, speculation, credentials, secrets, and raw private paths.",
                "Do not invent facts. The proposed text must stand alone and remain useful in a later coding session.",
                "If no durable memory exists, set should_create=false and return empty title/proposed_text."
              ].join(" ")
            },
            { role: "user", content: transcript }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) fail("compiler_ollama_unavailable");
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 1024 * 1024) fail("compiler_ollama_response_too_large");
      let responseBody;
      let extraction;
      try {
        responseBody = JSON.parse(raw);
        extraction = JSON.parse(responseBody?.message?.content);
      } catch {
        fail("compiler_ollama_response_invalid");
      }
      return validateExtraction(extraction);
    } catch (error) {
      if (error?.name === "AbortError") fail("compiler_ollama_timeout");
      if (error?.code) throw error;
      fail("compiler_ollama_unavailable");
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    model: selectedModel,
    promptVersion: PROMPT_VERSION,
    baseUrl: endpoint,
    extract
  };
}

function createCompilerStateStore(vaultRoot, clock) {
  const vault = existingDirectory(vaultRoot, "compiler_vault");
  const root = ensureDirectory(vault, "00_inbox/supermemory-product/codex-compiler");

  const statePath = (workspaceId, stopEventId) => {
    const workspaceRoot = ensureDirectory(root, workspaceId);
    return path.join(workspaceRoot, `${stopEventId}.json`);
  };

  const read = (workspaceId, stopEventId) => {
    const target = statePath(workspaceId, stopEventId);
    return fs.existsSync(target) ? safeReadJson(target) : null;
  };

  const write = (value) => {
    atomicJson(statePath(value.workspace_id, value.stop_event_id), {
      ...value,
      schema: COMPILER_SCHEMA,
      updated_at: clock()
    });
  };

  const list = () => {
    const states = [];
    for (const workspace of fs.readdirSync(root, { withFileTypes: true })) {
      const workspacePath = path.join(root, workspace.name);
      if (workspace.isSymbolicLink()) fail("compiler_state_invalid");
      if (!workspace.isDirectory()) continue;
      for (const entry of fs.readdirSync(workspacePath, { withFileTypes: true })) {
        const target = path.join(workspacePath, entry.name);
        if (entry.isSymbolicLink()) fail("compiler_state_invalid");
        if (entry.isFile() && entry.name.endsWith(".json")) states.push(safeReadJson(target));
      }
    }
    return states;
  };

  return { read, write, list };
}

function sortRecords(records) {
  return [...records].sort((left, right) => (
    left.envelope.sequence - right.envelope.sequence ||
    left.envelope.occurred_at.localeCompare(right.envelope.occurred_at) ||
    left.envelope.event_id.localeCompare(right.envelope.event_id)
  ));
}

function segmentForStop(records, stopIndex) {
  const stop = records[stopIndex];
  let previousStop = -1;
  for (let index = stopIndex - 1; index >= 0; index -= 1) {
    if (records[index].envelope.event_type === "assistant.completed") {
      previousStop = index;
      break;
    }
  }
  const interval = records.slice(previousStop + 1, stopIndex + 1);
  if (!stop.envelope.turn_id) return interval;
  const scoped = interval.filter((record) => (
    record.envelope.turn_id === null ||
    record.envelope.turn_id === stop.envelope.turn_id
  ));
  return scoped.some((record) => record.envelope.event_id === stop.envelope.event_id)
    ? scoped
    : [...scoped, stop];
}

function derivedTurnId(stop) {
  if (stop.envelope.turn_id) return stop.envelope.turn_id;
  return `turn_hook:auto:${crypto.createHash("sha256")
    .update(stop.envelope.event_id)
    .digest("hex")
    .slice(0, 32)}`;
}

function errorCode(error) {
  return String(error?.code ?? error?.message ?? "compiler_failed").slice(0, 120);
}

export function createCodexMemoryCompiler({
  vaultRoot,
  encryptionKey,
  captureStore,
  extractor = null,
  verifier = null,
  admissionMode = "legacy_manual",
  admissionPolicy = null,
  ollamaBaseUrl = DEFAULT_OLLAMA_URL,
  ollamaModel = DEFAULT_MODEL,
  ollamaTimeoutMs = 20_000,
  fetchImpl = globalThis.fetch,
  clock = () => new Date().toISOString()
} = {}) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
    fail("compiler_encryption_key_invalid");
  }
  if (
    !captureStore ||
    typeof captureStore.readEvents !== "function" ||
    typeof captureStore.listScopes !== "function"
  ) fail("compiler_capture_store_invalid");
  const vault = existingDirectory(vaultRoot, "compiler_vault");
  const stateStore = createCompilerStateStore(vault, clock);
  const snapshots = createTurnSnapshotStore({ vaultRoot: vault, fingerprintKey: encryptionKey });
  const selectedExtractor = extractor ?? createOllamaMemoryExtractor({
    baseUrl: ollamaBaseUrl,
    model: ollamaModel,
    timeoutMs: ollamaTimeoutMs,
    fetchImpl
  });
  if (typeof selectedExtractor.extract !== "function") fail("compiler_extractor_invalid");
  if (!["legacy_manual", "automatic"].includes(admissionMode)) fail("admission_mode_invalid");
  if (verifier !== null && typeof verifier.verify !== "function") fail("compiler_verifier_invalid");

  const verificationFor = async (candidate, context) => {
    if (admissionMode !== "automatic") return null;
    if (!verifier) return { status: "unavailable" };
    try {
      const result = await verifier.verify({ candidate, ...context });
      return result?.status === "verified" ? result : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  };

  const pending = new Map();
  let drainPromise = null;
  let accepting = true;

  const compileStop = async (stop, records, stopIndex) => {
    const envelope = stop.envelope;
    const previous = stateStore.read(envelope.workspace_id, envelope.event_id);
    if (previous?.status === "compiled" && previous.outcome !== "pending_verification") return previous;
    const attempts = Number(previous?.attempts ?? 0) + 1;
    const turnId = derivedTurnId(stop);
    stateStore.write({
      schema: COMPILER_SCHEMA,
      workspace_id: envelope.workspace_id,
      project_id: envelope.project_id,
      session_id: envelope.session_id,
      turn_id: turnId,
      stop_event_id: envelope.event_id,
      status: "processing",
      attempts,
      archive_id: previous?.archive_id ?? null,
      turn_snapshot_id: previous?.turn_snapshot_id ?? null,
      candidate_id: previous?.candidate_id ?? null,
      outcome: previous?.outcome ?? null,
      last_error: null
    });
    try {
      const segment = segmentForStop(records, stopIndex);
      const eventIds = [...new Set(segment.map((record) => record.envelope.event_id))];
      if (eventIds.length === 0) fail("compiler_turn_empty");
      const turn = snapshots.createTurnSnapshot({
        workspaceId: envelope.workspace_id,
        turnId,
        eventIds,
        fileSnapshotIds: [],
        completion: "complete",
        completedAt: envelope.occurred_at
      });
      const messages = visibleMessages(segment);
      const governance = createCodexMemoryGovernance({
        vaultRoot: vault,
        workspaceId: envelope.workspace_id,
        projectId: envelope.project_id,
        encryptionKey,
        admissionMode,
        admissionPolicy,
        clock
      });
      const archive = governance.archiveTurn({
        sessionId: envelope.session_id,
        turnId,
        visibleMessages: messages,
        toolEventIds: eventIds,
        turnSnapshotId: turn.turnSnapshotId,
        retentionClass: "standard"
      });
      const existingCandidate = governance.workspace.listCandidates()
        .find((candidate) => candidate.archive_id === archive.archive_id);
      if (existingCandidate) {
        let admission = null;
        if (admissionMode === "automatic") {
          admission = await governance.admitCandidate(existingCandidate.candidate_id, {
            verification: await verificationFor(existingCandidate, {
              messages,
              workspaceId: envelope.workspace_id,
              projectId: envelope.project_id
            })
          });
        }
        const result = {
          schema: COMPILER_SCHEMA,
          workspace_id: envelope.workspace_id,
          project_id: envelope.project_id,
          session_id: envelope.session_id,
          turn_id: turnId,
          stop_event_id: envelope.event_id,
          status: "compiled",
          attempts,
          archive_id: archive.archive_id,
          turn_snapshot_id: turn.turnSnapshotId,
          candidate_id: existingCandidate.candidate_id,
          outcome: admission?.status ?? "candidate",
          last_error: null
        };
        stateStore.write(result);
        return result;
      }
      const extracted = await selectedExtractor.extract({
        messages,
        workspaceId: envelope.workspace_id,
        projectId: envelope.project_id,
        sessionId: envelope.session_id,
        turnId
      });
      let candidate = null;
      if (extracted) {
        candidate = governance.createCandidate({
          archiveId: archive.archive_id,
          eventIds,
          turnSnapshotId: turn.turnSnapshotId,
          sourceSnapshotIds: [],
          title: extracted.title,
          proposedText: extracted.proposedText,
          type: extracted.type,
          confidence: extracted.confidence,
          uncertainty: extracted.uncertainty,
          sensitivity: extracted.sensitivity,
          extractor: {
            model: selectedExtractor.model ?? "local-extractor",
            prompt_version: selectedExtractor.promptVersion ?? PROMPT_VERSION
          },
          dedupeKey: `compiler:${archive.archive_id}:${selectedExtractor.promptVersion ?? PROMPT_VERSION}`
        });
        if (admissionMode === "automatic") {
          const admission = await governance.admitCandidate(candidate.candidate_id, {
            verification: await verificationFor(candidate, {
              messages,
              workspaceId: envelope.workspace_id,
              projectId: envelope.project_id
            })
          });
          candidate = { ...candidate, admission_status: admission.status };
        }
      }
      const result = {
        schema: COMPILER_SCHEMA,
        workspace_id: envelope.workspace_id,
        project_id: envelope.project_id,
        session_id: envelope.session_id,
        turn_id: turnId,
        stop_event_id: envelope.event_id,
        status: "compiled",
        attempts,
        archive_id: archive.archive_id,
        turn_snapshot_id: turn.turnSnapshotId,
        candidate_id: candidate?.candidate_id ?? null,
        outcome: candidate?.admission_status ?? (candidate ? "candidate" : "archived_only"),
        last_error: null
      };
      stateStore.write(result);
      return result;
    } catch (error) {
      const failed = {
        schema: COMPILER_SCHEMA,
        workspace_id: envelope.workspace_id,
        project_id: envelope.project_id,
        session_id: envelope.session_id,
        turn_id: turnId,
        stop_event_id: envelope.event_id,
        status: "retryable",
        attempts,
        archive_id: previous?.archive_id ?? null,
        turn_snapshot_id: previous?.turn_snapshot_id ?? null,
        candidate_id: previous?.candidate_id ?? null,
        outcome: null,
        last_error: errorCode(error)
      };
      stateStore.write(failed);
      return failed;
    }
  };

  const compileScope = async ({ workspaceId, sessionId }) => {
    const records = sortRecords(captureStore.readEvents({
      workspaceId,
      sessionId,
      includePayload: true
    }));
    for (let index = 0; index < records.length; index += 1) {
      if (records[index].envelope.event_type === "assistant.completed") {
        await compileStop(records[index], records, index);
      }
    }
  };

  const drain = async () => {
    while (pending.size > 0) {
      const [key, scope] = pending.entries().next().value;
      pending.delete(key);
      try {
        await compileScope(scope);
      } catch {
        // A per-turn failure is recorded without taking down capture or the daemon.
      }
    }
  };

  const ensureDrain = () => {
    if (!drainPromise) {
      drainPromise = Promise.resolve()
        .then(drain)
        .finally(() => {
          drainPromise = null;
          if (pending.size > 0 && accepting) ensureDrain();
        });
    }
  };

  const schedule = ({ workspaceId, sessionId }) => {
    if (!accepting || !workspaceId || !sessionId) return { scheduled: false };
    const key = `${workspaceId}\0${sessionId}`;
    pending.set(key, { workspaceId, sessionId });
    ensureDrain();
    return { scheduled: true };
  };

  const notifyCapture = (input) => {
    if (input?.event_type !== "assistant.completed") return { scheduled: false };
    return schedule({ workspaceId: input.workspace_id, sessionId: input.session_id });
  };

  const recover = () => {
    let scheduled = 0;
    for (const scope of captureStore.listScopes()) {
      schedule(scope);
      scheduled += 1;
    }
    return { scheduled };
  };

  const whenIdle = async () => {
    while (drainPromise || pending.size > 0) {
      if (drainPromise) await drainPromise;
      else ensureDrain();
    }
  };

  const stop = async () => {
    accepting = false;
    await whenIdle();
  };

  const stats = () => {
    const states = stateStore.list();
    const retryable = states.filter((state) => state.status === "retryable").length;
    const processing = states.filter((state) => state.status === "processing").length;
    const compiled = states.filter((state) => state.status === "compiled").length;
    return {
      status: retryable > 0 ? "degraded" : "ready",
      model: selectedExtractor.model ?? "local-extractor",
      pending: pending.size + processing,
      compiled,
      candidates: states.filter((state) => state.outcome === "candidate").length,
      archived_only: states.filter((state) => state.outcome === "archived_only").length,
      retryable
    };
  };

  return {
    model: selectedExtractor.model ?? "local-extractor",
    notifyCapture,
    recover,
    schedule,
    whenIdle,
    stop,
    stats
  };
}
