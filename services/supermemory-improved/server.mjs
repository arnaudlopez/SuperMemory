import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8081);
const HOST = process.env.HOST ?? "0.0.0.0";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 4 * 1024 * 1024);
const GRAPHITI_URL = process.env.GRAPHITI_URL ?? "http://graphiti:8000";
const TOKEN_FILE = process.env.IMPROVED_TOKEN_FILE ?? "/run/secrets/improved_token";
const STATE_KEY_FILE = process.env.IMPROVED_STATE_KEY_FILE ?? "/run/secrets/improved_state_key";
const STATE_FILE = process.env.IMPROVED_STATE_FILE ?? "/var/lib/supermemory-improved/state.json";
const WORKSPACE = /^ws_[0-9a-f-]{36}$/i;
const JOB = /^imj_[A-Za-z0-9:_-]{8,128}$/;

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function readSecret(filePath, code) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code, 503);
  const value = fs.readFileSync(filePath, "utf8").trim();
  if (Buffer.byteLength(value) < 32) fail(code, 503);
  return value;
}

function readStateKey(filePath) {
  const encoded = readSecret(filePath, "improved_state_key_invalid");
  const key = /^[0-9a-f]{64}$/i.test(encoded)
    ? Buffer.from(encoded, "hex")
    : Buffer.from(encoded, "base64");
  if (key.length !== 32) fail("improved_state_key_invalid", 503);
  return key;
}

const apiToken = readSecret(TOKEN_FILE, "improved_token_invalid");
const stateKey = readStateKey(STATE_KEY_FILE);
const STATE_AAD = Buffer.from("supermemory.improved-state.v1", "utf8");

function authorized(header) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(apiToken);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  if (Object.keys(value).some((key) => !fields.has(key))) fail(code);
  return value;
}

function initialState() {
  return { schema: "supermemory.improved-state.v1", jobs: [], high_watermarks: {} };
}

function sealState(state) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", stateKey, nonce);
  cipher.setAAD(STATE_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final()
  ]);
  return {
    schema: "supermemory.improved-state-envelope.v1",
    algorithm: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function openState(envelope) {
  if (
    envelope?.schema !== "supermemory.improved-state-envelope.v1" ||
    envelope.algorithm !== "aes-256-gcm" ||
    typeof envelope.nonce !== "string" || typeof envelope.tag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) fail("improved_state_corrupt", 503);
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      stateKey,
      Buffer.from(envelope.nonce, "base64")
    );
    decipher.setAAD(STATE_AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8"));
  } catch {
    fail("improved_state_corrupt", 503);
  }
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return initialState();
  let state;
  try {
    state = openState(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
  } catch (error) {
    if (error?.code === "improved_state_corrupt") throw error;
    fail("improved_state_corrupt", 503);
  }
  if (state?.schema !== "supermemory.improved-state.v1" || !Array.isArray(state.jobs)) {
    fail("improved_state_corrupt", 503);
  }
  return state;
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  const temporary = `${STATE_FILE}.${crypto.randomUUID()}.tmp`;
  const handle = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(sealState(state))}\n`);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, STATE_FILE);
  const directory = fs.openSync(path.dirname(STATE_FILE), "r");
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}

function validateEpisode(value) {
  exactObject(value, new Set([
    "episode_id", "evidence_ids", "content", "observed_at", "admission_id", "ontology_version"
  ]), "improved_episode_invalid");
  if (
    typeof value.episode_id !== "string" || !Array.isArray(value.evidence_ids) ||
    value.evidence_ids.length === 0 || value.evidence_ids.length > 100 ||
    typeof value.content !== "string" || !value.content.trim() || Buffer.byteLength(value.content) > 512 * 1024 ||
    !Number.isFinite(Date.parse(value.observed_at)) || typeof value.admission_id !== "string" ||
    typeof value.ontology_version !== "string"
  ) fail("improved_episode_invalid");
  return value;
}

function validateJob(value) {
  exactObject(value, new Set(["schema", "job_id", "workspace_id", "cursor", "episodes"]), "improved_job_invalid");
  if (
    value.schema !== "supermemory.improve-notify.v1" || !JOB.test(value.job_id) ||
    !WORKSPACE.test(value.workspace_id) || !Number.isSafeInteger(value.cursor) || value.cursor < 0 ||
    !Array.isArray(value.episodes) || value.episodes.length < 1 || value.episodes.length > 100
  ) fail("improved_job_invalid");
  return { ...value, episodes: value.episodes.map(validateEpisode) };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) fail("payload_too_large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("invalid_json");
  }
}

function send(response, status, body) {
  const serialized = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(serialized);
}

function enqueue(input) {
  const job = validateJob(input);
  const state = readState();
  const existing = state.jobs.find((item) => item.job_id === job.job_id);
  if (existing) {
    if (existing.workspace_id !== job.workspace_id || existing.cursor !== job.cursor) fail("improved_job_collision", 409);
    return existing;
  }
  const current = Number(state.high_watermarks[job.workspace_id] ?? -1);
  if (job.cursor <= current) {
    return { job_id: job.job_id, workspace_id: job.workspace_id, cursor: job.cursor, status: "already_applied" };
  }
  const queued = {
    ...job,
    status: "queued",
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    error: null
  };
  state.jobs.push(queued);
  writeState(state);
  return queued;
}

async function projectJob(job) {
  const messages = job.episodes.map((episode) => ({
    uuid: episode.episode_id,
    name: "supermemory-authorized-episode",
    role_type: "system",
    role: "memory",
    content: episode.content,
    timestamp: episode.observed_at,
    source_description: JSON.stringify({
      admission_id: episode.admission_id,
      ontology_version: episode.ontology_version,
      evidence_ids: episode.evidence_ids
    })
  }));
  const response = await fetch(new URL("/messages", GRAPHITI_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ group_id: job.workspace_id, messages }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) fail("graphiti_unavailable", 503);
}

let workerRunning = false;
async function workOnce() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const state = readState();
    const now = Date.now();
    const job = state.jobs.find((item) => (
      ["queued", "retry"].includes(item.status) && Date.parse(item.next_attempt_at) <= now
    ));
    if (!job) return;
    job.status = "running";
    job.attempts += 1;
    writeState(state);
    try {
      await projectJob(job);
      job.status = "complete";
      job.completed_at = new Date().toISOString();
      job.error = null;
      state.high_watermarks[job.workspace_id] = Math.max(
        Number(state.high_watermarks[job.workspace_id] ?? -1),
        job.cursor
      );
    } catch (error) {
      job.status = job.attempts >= 10 ? "failed" : "retry";
      job.error = error.code ?? "improvement_failed";
      job.next_attempt_at = new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** job.attempts)).toISOString();
    }
    writeState(state);
  } finally {
    workerRunning = false;
  }
}

async function ready() {
  const response = await fetch(new URL("/healthcheck", GRAPHITI_URL), { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) fail("graphiti_unavailable", 503);
  readState();
}

export function createImprovedServer() {
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
      if (request.method === "GET" && request.url === "/ready") {
        await ready();
        return send(response, 200, { ok: true, graphiti: "ready" });
      }
      if (!authorized(request.headers.authorization)) fail("not_found_or_not_authorized", 404);
      if (request.method === "POST" && request.url === "/v1/improve/notify") {
        const job = enqueue(await readJson(request));
        queueMicrotask(workOnce);
        return send(response, job.status === "already_applied" ? 200 : 202, { ok: true, job });
      }
      if (request.method === "GET" && request.url === "/v1/improve/status") {
        const state = readState();
        return send(response, 200, {
          ok: true,
          queued: state.jobs.filter((job) => ["queued", "retry", "running"].includes(job.status)).length,
          failed: state.jobs.filter((job) => job.status === "failed").length,
          high_watermarks: state.high_watermarks
        });
      }
      fail("not_found_or_not_authorized", 404);
    } catch (error) {
      send(response, error.status ?? 500, { ok: false, error: error.code ?? "improved_failed" });
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const timer = setInterval(workOnce, 1_000);
  timer.unref();
  createImprovedServer().listen(PORT, HOST);
}
