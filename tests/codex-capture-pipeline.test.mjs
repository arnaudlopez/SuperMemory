import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCodexEventEnvelope,
  payloadHash
} from "../scripts/lib/codex-event-envelope.mjs";
import {
  createCodexCaptureStore,
  prepareCodexCapture
} from "../scripts/lib/codex-capture-store.mjs";
import {
  canonicalJson,
  redactCodexPayload
} from "../scripts/lib/codex-redaction.mjs";
import { createCodexArchiveStore } from "../scripts/lib/codex-archive-store.mjs";
import { createCodexSpool } from "../scripts/lib/codex-spool.mjs";
import {
  createSuperMemoryDaemon,
  createSuperMemoryDaemonClient
} from "../scripts/lib/supermemory-daemon.mjs";

const PROJECT_ID = "prj_018f1234-5678-7abc-8def-0123456789ab";
const WORKSPACE_ID = "ws_018f1234-5678-7abc-8def-0123456789ac";
const CHECKOUT_ID = "co_018f1234-5678-7abc-8def-0123456789ad";
const KEY = Buffer.alloc(32, 0x42);
const TOKEN = "supermemory-test-token-000000000000000000000000";
const SENSITIVE_SAMPLE = ["sk", "proj", "abcdefghijklmnopABCDEFGHIJKLMNOP123456"].join("-");
const PRIVATE_PATH = "/Users/alice/Clients/Acme/secret-plan.md";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-capture-"));
  const vault = path.join(root, "vault");
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(vault);
  fs.mkdirSync(runtime);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault, runtime };
}

function captureInput({
  sequence = 0,
  sessionId = "ses_hook:session-a",
  adapter = "hook",
  eventType = "prompt.submitted",
  payload = { text: "hello" },
  externalEventId = `external-${sessionId}-${sequence}-${eventType}`
} = {}) {
  return {
    adapter,
    adapter_version: "1.0.0",
    external_event_id: externalEventId,
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    checkout_id: CHECKOUT_ID,
    session_id: sessionId,
    thread_id: "thread-a",
    turn_id: "turn_hook:turn-a",
    item_id: `item-${sequence}`,
    event_type: eventType,
    occurred_at: `2026-07-24T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    capture_level: "standard",
    sequence,
    payload
  };
}

function allFiles(directory) {
  const result = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) result.push(target);
    }
  };
  visit(directory);
  return result;
}

function requestJson(url, {
  method = "GET",
  token = null,
  host = null,
  body = null
} = {}) {
  const parsed = new URL(url);
  const serialized = body === null ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request(parsed, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(host ? { host } : {}),
        ...(serialized ? {
          "content-type": "application/json",
          "content-length": serialized.length
        } : {})
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
      }));
    });
    request.on("error", reject);
    request.end(serialized ?? undefined);
  });
}

test("EventEnvelope identity is deterministic and adapter-namespaced", () => {
  const input = captureInput({ payload: { z: 1, a: ["same"] } });
  const first = createCodexEventEnvelope(input, {
    observedAt: "2026-07-24T12:01:00.000Z"
  });
  const retry = createCodexEventEnvelope({
    ...input,
    payload: { a: ["same"], z: 1 }
  }, {
    observedAt: "2026-07-24T12:02:00.000Z"
  });
  const shadow = createCodexEventEnvelope({
    ...input,
    adapter: "app_server"
  }, {
    observedAt: "2026-07-24T12:01:00.000Z"
  });

  assert.equal(first.event_id, retry.event_id);
  assert.equal(first.payload_hash, retry.payload_hash);
  assert.notEqual(first.event_id, shadow.event_id);
  assert.match(first.event_id, /^evt_[0-9a-f]{64}$/);
});

test("redaction happens before encrypted payload and normalized journal persistence", (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    clock: () => "2026-07-24T12:05:00.000Z"
  });
  const result = store.ingest(captureInput({
    payload: {
      prompt: `Inspect ${PRIVATE_PATH} with ${SENSITIVE_SAMPLE}`,
      password: "test-correct-horse-battery-staple",
      nested: { authorization: "Bearer top-secret-token-value" }
    }
  }));
  assert.equal(result.status, "applied");
  assert.equal(result.durable, true);

  const persistedText = allFiles(vault)
    .map((filePath) => fs.readFileSync(filePath).toString("utf8"))
    .join("\n");
  assert.equal(persistedText.includes(SENSITIVE_SAMPLE), false);
  assert.equal(persistedText.includes(PRIVATE_PATH), false);
  assert.equal(persistedText.includes("test-correct-horse-battery-staple"), false);

  const [record] = store.readEvents({
    workspaceId: WORKSPACE_ID,
    includePayload: true
  });
  assert.match(record.payload.prompt, /\[PATH:hmac-sha256:[0-9a-f]{64}\]/);
  assert.match(record.payload.prompt, /\[REDACTED:OPENAI_KEY\]/);
  assert.equal(record.payload.password, "[REDACTED:SECRET_FIELD]");
  assert.equal(record.payload.nested.authorization, "[REDACTED:SECRET_FIELD]");
  assert.equal(record.envelope.payload_hash, payloadHash(record.payload));
});

test("redaction remains idempotent when path fingerprints expand a bounded string", () => {
  const paths = Array.from({ length: 32 }, (_, index) => `/tmp/p${index}`).join(" ");
  const prompt = `${"x".repeat(64 * 1024 - paths.length - 32)} ${paths} trailing text`;
  const first = redactCodexPayload({ prompt }, { encryptionKey: KEY });
  const rerun = redactCodexPayload(first.payload, { encryptionKey: KEY });

  assert.equal(first.findings.truncated_strings, 1);
  assert.match(first.payload.prompt, /\[PATH:hmac-sha256:[0-9a-f]{64}\]/);
  assert.equal(canonicalJson(rerun.payload), canonicalJson(first.payload));
});

test("journal replay is idempotent and ordering is isolated per session", (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    clock: () => "2026-07-24T12:05:00.000Z"
  });
  const first = store.ingest(captureInput({ sequence: 0 }));
  const duplicate = store.ingest(captureInput({ sequence: 0 }));
  const gap = store.ingest(captureInput({ sequence: 2 }));
  const late = store.ingest(captureInput({ sequence: 1 }));
  const otherSession = store.ingest(captureInput({
    sequence: 8,
    sessionId: "ses_hook:session-b"
  }));

  assert.equal(first.status, "applied");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.applied, false);
  assert.equal(gap.orderStatus, "gap");
  assert.equal(gap.captureCoverage, "partial");
  assert.equal(late.orderStatus, "out_of_order");
  assert.equal(otherSession.orderStatus, "in_order");
  assert.equal(store.stats().events, 4);
  assert.equal(store.stats().sessions, 2);
  assert.equal(store.stats().gaps, 2);
});

test("capture journal cache remains coherent across store instances", (t) => {
  const { vault } = fixture(t);
  const firstStore = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const secondStore = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const originalReadFileSync = fs.readFileSync;
  let journalReads = 0;
  fs.readFileSync = function instrumentedReadFileSync(filePath, ...args) {
    if (String(filePath).endsWith(`${path.sep}events.jsonl`)) journalReads += 1;
    return originalReadFileSync.call(this, filePath, ...args);
  };
  try {
    assert.equal(firstStore.stats().events, 0);
    assert.equal(secondStore.ingest(captureInput({ sequence: 0 })).status, "applied");
    assert.equal(firstStore.ingest(captureInput({ sequence: 0 })).status, "duplicate");
    assert.equal(firstStore.ingest(captureInput({ sequence: 1 })).orderStatus, "in_order");
    assert.equal(secondStore.stats().events, 2);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.equal(journalReads, 1);

  const revisionPath = path.join(vault, "00_inbox", "codex-events", ".journal-revision");
  assert.equal(fs.readFileSync(revisionPath, "utf8"), "2\n");
});

test("unresolved workspace and forged unredacted prepared captures fail closed", (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  assert.throws(
    () => store.ingest({ ...captureInput(), workspace_id: null }),
    /Invalid workspace_id/
  );
  assert.equal(store.stats().events, 0);

  const rawPayload = { text: `leak ${SENSITIVE_SAMPLE}` };
  const envelope = createCodexEventEnvelope({
    ...captureInput({ payload: rawPayload }),
    payload: rawPayload,
    redaction_profile: "redaction.v1"
  });
  assert.throws(
    () => store.ingestPrepared({
      schema: "supermemory.prepared-capture.v1",
      envelope,
      payload: rawPayload,
      redaction: { profile: "redaction.v1", findings: {} }
    }),
    /prepared_capture_not_redacted/
  );
  assert.equal(store.stats().events, 0);
});

test("encrypted spool retains failed leases and removes entries only after durable ack", async (t) => {
  const { vault, runtime } = fixture(t);
  const store = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const spool = createCodexSpool({
    runtimeRoot: runtime,
    workspaceId: WORKSPACE_ID,
    encryptionKey: KEY
  });
  const input = captureInput({
    payload: { text: `never persist plaintext ${SENSITIVE_SAMPLE}` }
  });
  const queued = spool.enqueue(input);
  assert.equal(queued.status, "spooled");
  assert.equal(spool.depth().entries, 1);
  assert.equal(fs.statSync(spool.directory).mode & 0o777, 0o700);
  for (const filePath of allFiles(spool.directory)) {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(filePath, "utf8").includes(SENSITIVE_SAMPLE), false);
  }

  const failed = await spool.replay(async () => {
    throw new Error("simulated_daemon_crash");
  });
  assert.equal(failed.failed, 1);
  assert.equal(failed.retained, 1);
  assert.equal(spool.depth().entries, 1);

  const replayed = await spool.replay((prepared) => store.ingestPrepared(prepared));
  assert.equal(replayed.replayed, 1);
  assert.equal(spool.depth().entries, 0);
  assert.equal(store.stats().events, 1);
});

test("crash after journal commit but before producer ack replays as one logical effect", async (t) => {
  const { vault, runtime } = fixture(t);
  const store = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const spool = createCodexSpool({
    runtimeRoot: runtime,
    workspaceId: WORKSPACE_ID,
    encryptionKey: KEY
  });
  const input = captureInput({ sequence: 4, externalEventId: "crash-before-ack" });
  spool.enqueue(input);
  const prepared = prepareCodexCapture(input, { encryptionKey: KEY });
  assert.equal(store.ingestPrepared(prepared).status, "applied");

  const replayed = await spool.replay((entry) => store.ingestPrepared(entry));
  assert.equal(replayed.duplicates, 1);
  assert.equal(spool.depth().entries, 0);
  assert.equal(store.stats().events, 1);
});

test("interactive spool replay drains one bounded entry per capture opportunity", async (t) => {
  const { vault, runtime } = fixture(t);
  const store = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const spool = createCodexSpool({
    runtimeRoot: runtime,
    workspaceId: WORKSPACE_ID,
    encryptionKey: KEY
  });
  for (let sequence = 0; sequence < 3; sequence += 1) {
    spool.enqueue(captureInput({ sequence, externalEventId: `bounded-${sequence}` }));
  }
  const first = await spool.replay(
    (prepared) => store.ingestPrepared(prepared),
    { maxEntries: 1 }
  );
  assert.equal(first.replayed, 1);
  assert.equal(spool.depth().entries, 2);
  await assert.rejects(
    spool.replay(() => {}, { maxEntries: 0 }),
    /spool_replay_limit_invalid/
  );
});

test("spool quota drops in bounded time and writes a payload-free capture gap", (t) => {
  const { runtime } = fixture(t);
  const spool = createCodexSpool({
    runtimeRoot: runtime,
    workspaceId: WORKSPACE_ID,
    encryptionKey: KEY,
    maxBytes: 128
  });
  const started = performance.now();
  const result = spool.enqueue(captureInput({
    payload: { text: `large ${SENSITIVE_SAMPLE} ${"x".repeat(5_000)}` }
  }));
  const elapsed = performance.now() - started;

  assert.equal(result.status, "dropped");
  assert.equal(result.reason, "spool_full");
  assert.equal(result.captureGap, true);
  assert.ok(elapsed < 500);
  assert.equal(spool.depth().entries, 0);
  const gaps = allFiles(spool.auditDirectory);
  assert.equal(gaps.length, 1);
  const gapText = fs.readFileSync(gaps[0], "utf8");
  assert.equal(gapText.includes(SENSITIVE_SAMPLE), false);
  assert.match(gapText, /"reason":"spool_full"/);
});

test("daemon is loopback-only, authenticated and falls back to encrypted spool", async (t) => {
  const { vault, runtime } = fixture(t);
  assert.throws(() => createSuperMemoryDaemon({
    vaultRoot: vault,
    encryptionKey: KEY,
    authToken: TOKEN,
    host: "0.0.0.0"
  }), /daemon_host_not_loopback/);

  const daemon = createSuperMemoryDaemon({
    vaultRoot: vault,
    encryptionKey: KEY,
    authToken: TOKEN
  });
  const address = await daemon.start();
  t.after(async () => daemon.stop().catch(() => {}));
  const spool = createCodexSpool({
    runtimeRoot: runtime,
    workspaceId: WORKSPACE_ID,
    encryptionKey: KEY
  });
  const client = createSuperMemoryDaemonClient({
    endpoint: address.url,
    authToken: TOKEN,
    spool,
    timeoutMs: 500
  });

  const unauthorized = await requestJson(`${address.url}/health`);
  assert.equal(unauthorized.status, 401);
  const wrongHost = await requestJson(`${address.url}/health`, {
    token: TOKEN,
    host: "attacker.invalid"
  });
  assert.equal(wrongHost.status, 421);

  const delivered = await client.capture(captureInput());
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.durable, true);
  const duplicate = await client.capture(captureInput());
  assert.equal(duplicate.status, "delivered");
  assert.equal(daemon.store.stats().events, 1);

  const health = await requestJson(`${address.url}/health`, { token: TOKEN });
  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ready");
  assert.equal(health.body.capture.events, 1);
  assert.equal(health.body.counters.duplicates, 1);

  await daemon.stop();
  const fallback = await client.capture(captureInput({
    sequence: 1,
    externalEventId: "daemon-down",
    payload: { text: `spool ${SENSITIVE_SAMPLE}` }
  }));
  assert.equal(fallback.status, "spooled");
  assert.equal(fallback.fallback, true);
  assert.equal(spool.depth().entries, 1);

  const replayed = await daemon.replaySpool(spool);
  assert.equal(replayed.replayed, 1);
  assert.equal(spool.depth().entries, 0);
  assert.equal(daemon.store.stats().events, 2);
});

test("Mac client drains its encrypted outage spool through the restored Z2 tunnel", async (t) => {
  const { vault, runtime } = fixture(t);
  const spool = createCodexSpool({
    runtimeRoot: runtime,
    workspaceId: WORKSPACE_ID,
    encryptionKey: KEY
  });
  const unavailable = createSuperMemoryDaemon({
    vaultRoot: vault,
    encryptionKey: KEY,
    authToken: TOKEN
  });
  const firstAddress = await unavailable.start();
  await unavailable.stop();
  const offlineClient = createSuperMemoryDaemonClient({
    endpoint: firstAddress.url,
    authToken: TOKEN,
    spool,
    timeoutMs: 100
  });
  const spooled = await offlineClient.capture(captureInput({ externalEventId: "offline-event" }));
  assert.equal(spooled.status, "spooled");
  assert.equal(spool.depth().entries, 1);

  const restored = createSuperMemoryDaemon({
    vaultRoot: vault,
    encryptionKey: KEY,
    authToken: TOKEN
  });
  const restoredAddress = await restored.start();
  t.after(async () => restored.stop().catch(() => {}));
  const onlineClient = createSuperMemoryDaemonClient({
    endpoint: restoredAddress.url,
    authToken: TOKEN,
    spool,
    timeoutMs: 500
  });
  const delivered = await onlineClient.capture(captureInput({
    sequence: 1,
    externalEventId: "online-event"
  }));
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.spoolReplay.replayed, 1);
  assert.equal(spool.depth().entries, 0);
  assert.equal(restored.store.stats().events, 2);
});

test("daemon acknowledges a durable Stop without waiting for memory compilation", async (t) => {
  const { vault } = fixture(t);
  let release;
  let compilationStarted = false;
  const compilation = new Promise((resolve) => {
    release = resolve;
  });
  const memoryCompiler = {
    notifyCapture(input) {
      if (input.event_type === "assistant.completed") {
        compilationStarted = true;
        void compilation;
      }
      return { scheduled: true };
    },
    recover() {
      return { scheduled: 0 };
    },
    async stop() {
      await compilation;
    },
    stats() {
      return {
        status: "ready",
        pending: compilationStarted ? 1 : 0,
        compiled: 0,
        candidates: 0,
        archived_only: 0,
        retryable: 0
      };
    }
  };
  const daemon = createSuperMemoryDaemon({
    vaultRoot: vault,
    encryptionKey: KEY,
    authToken: TOKEN,
    memoryCompiler
  });
  const address = await daemon.start();
  const response = await requestJson(`${address.url}/v1/events`, {
    method: "POST",
    token: TOKEN,
    body: captureInput({
      sequence: 0,
      eventType: "assistant.completed",
      payload: { last_assistant_message: "A durable decision." }
    })
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.durable, true);
  assert.equal(compilationStarted, true);
  release();
  await daemon.stop();
});

test("historical backfill defers compiler, topic and canonical enrichment until completion", async (t) => {
  const { vault } = fixture(t);
  let compilerNotifications = 0;
  let compilerRecoveries = 0;
  let topicResolutions = 0;
  let workerRecoveries = 0;
  const projectRouter = {
    resolveTopic: async () => {
      topicResolutions += 1;
      return { status: "resolved" };
    }
  };
  const supervisor = {
    forScope: () => projectRouter,
    forProject: () => projectRouter,
    recover: async () => ({ recovered: 1, failures: [] }),
    recoverWorkers: async () => {
      workerRecoveries += 1;
      return { status: "complete", recovered: 1, failures: [] };
    },
    status: () => ({ active_contexts: 1 }),
    close: async () => {}
  };
  const memoryCompiler = {
    notifyCapture() { compilerNotifications += 1; },
    recover() { compilerRecoveries += 1; },
    stop: async () => {},
    stats: () => ({ status: "idle" })
  };
  const daemon = createSuperMemoryDaemon({
    vaultRoot: vault,
    encryptionKey: KEY,
    authToken: TOKEN,
    workingMemory: { enabled: true },
    memoryCompiler,
    runtimeSupervisor: supervisor,
    requestScopeResolver: () => ({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      checkoutId: CHECKOUT_ID
    })
  });
  const address = await daemon.start();
  t.after(() => daemon.stop().catch(() => {}));

  const backfill = await requestJson(`${address.url}/v1/events`, {
    method: "POST",
    token: TOKEN,
    body: { ...captureInput({ sequence: 0 }), capture_level: "backfill" }
  });
  assert.equal(backfill.status, 202);
  assert.equal(compilerNotifications, 0);
  assert.equal(topicResolutions, 0);
  assert.equal(workerRecoveries, 0);

  const live = await requestJson(`${address.url}/v1/events`, {
    method: "POST",
    token: TOKEN,
    body: captureInput({ sequence: 1, externalEventId: "live-after-backfill" })
  });
  assert.equal(live.status, 202);
  assert.equal(compilerNotifications, 1);
  assert.equal(topicResolutions, 1);

  const enrichment = await requestJson(`${address.url}/v1/admin/canonical/recover`, {
    method: "POST",
    token: TOKEN
  });
  assert.equal(enrichment.status, 202);
  assert.equal(workerRecoveries, 1);
  assert.equal(compilerRecoveries, 2);
});

test("daemon creates deterministic topic checkpoints on compaction and session end without a canonical worker", async (t) => {
  const { vault } = fixture(t);
  const checkpoints = [];
  const empty = async () => ({ results: [] });
  const memoryRouter = {
    recall: empty,
    workingSearch: empty,
    workingOpen: async () => ({}),
    workingNeighbors: async () => ({}),
    workingMap: async () => ({}),
    graphQuery: empty,
    explainPath: async () => ({}),
    search: empty,
    get: async () => ({}),
    explainCitation: async () => ({}),
    status: async () => ({ status: "ready" }),
    topicCheckpoint: async (input) => {
      checkpoints.push(input);
      return { status: "created" };
    }
  };
  const memoryCompiler = {
    notifyCapture() {}, recover() {}, stop: async () => {}, stats: () => ({ status: "idle" })
  };
  const daemon = createSuperMemoryDaemon({
    vaultRoot: vault,
    encryptionKey: KEY,
    authToken: TOKEN,
    workingMemory: { enabled: true },
    memoryCompiler,
    memoryRouter
  });
  const address = await daemon.start();
  t.after(() => daemon.stop().catch(() => {}));
  for (const [sequence, eventType] of [[0, "context.compacted"], [1, "assistant.completed"]]) {
    const response = await requestJson(`${address.url}/v1/events`, {
      method: "POST",
      token: TOKEN,
      body: captureInput({ sequence, eventType, externalEventId: `checkpoint-${eventType}` })
    });
    assert.equal(response.status, 202);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(checkpoints.map((item) => item.kind), ["compaction", "session_end"]);
  assert.equal(checkpoints[0].working_set_id, checkpoints[1].working_set_id);
});

test("daemon startup replays encrypted outage spool before compiling completed turns", async (t) => {
  const { vault, runtime } = fixture(t);
  const spool = createCodexSpool({
    runtimeRoot: runtime,
    workspaceId: WORKSPACE_ID,
    encryptionKey: KEY
  });
  spool.enqueue(captureInput({
    sequence: 0,
    eventType: "prompt.submitted",
    payload: { prompt: "Keep this durable outage decision." }
  }));
  spool.enqueue(captureInput({
    sequence: 1,
    eventType: "assistant.completed",
    payload: { last_assistant_message: "Outage captures must be replayed." }
  }));
  const daemon = createSuperMemoryDaemon({
    vaultRoot: vault,
    runtimeRoot: runtime,
    encryptionKey: KEY,
    authToken: TOKEN,
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          message: {
            content: JSON.stringify({
              should_create: false,
              title: "",
              proposed_text: "",
              type: "durable_fact",
              confidence: 0,
              uncertainty: "",
              sensitivity: "standard"
            })
          }
        });
      }
    })
  });
  const address = await daemon.start();
  await daemon.compiler.whenIdle();

  const health = await requestJson(`${address.url}/health`, { token: TOKEN });
  assert.equal(health.body.spool_replay.status, "complete");
  assert.equal(health.body.spool_replay.replayed, 2);
  assert.equal(health.body.capture.events, 2);
  assert.equal(spool.depth().entries, 0);
  const archives = createCodexArchiveStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    encryptionKey: KEY
  });
  const [metadata] = archives.listMetadata();
  const opened = archives.openArchive(metadata.archive_id);
  assert.deepEqual(opened.content.visible_messages.map((message) => message.role), [
    "user",
    "assistant"
  ]);
  await daemon.stop();
});

test("AEAD tampering is detected and the spool entry is retained", async (t) => {
  const { runtime } = fixture(t);
  const spool = createCodexSpool({
    runtimeRoot: runtime,
    workspaceId: WORKSPACE_ID,
    encryptionKey: KEY
  });
  spool.enqueue(captureInput());
  const [filePath] = allFiles(spool.directory);
  const sealed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const bytes = Buffer.from(sealed.ciphertext, "base64");
  bytes[0] ^= 0xff;
  sealed.ciphertext = bytes.toString("base64");
  fs.writeFileSync(filePath, `${JSON.stringify(sealed)}\n`, { mode: 0o600 });

  const replay = await spool.replay(async () => ({
    status: "applied",
    durable: true
  }));
  assert.equal(replay.failed, 1);
  assert.equal(replay.retained, 1);
  assert.equal(spool.depth().entries, 1);
});
