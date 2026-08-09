import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createCodexCaptureStore, prepareCodexCapture } from "./codex-capture-store.mjs";
import { createCodexMemoryCompiler } from "./codex-memory-compiler.mjs";
import { createCodexSpool } from "./codex-spool.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertToken(authToken) {
  if (typeof authToken !== "string" || Buffer.byteLength(authToken) < 32) {
    fail("daemon_auth_token_invalid");
  }
}

function isLoopbackUrl(url) {
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1")
  );
}

function authorized(header, expected) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

function validHostHeader(value) {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.startsWith("localhost:") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.0.0.1:") ||
    normalized === "[::1]" ||
    normalized.startsWith("[::1]:")
  );
}

function sendJson(response, statusCode, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(Object.assign(new Error("daemon_body_too_large"), { code: "daemon_body_too_large" }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("daemon_json_invalid"), { code: "daemon_json_invalid" }));
      }
    });
    request.on("error", reject);
  });
}

function errorStatus(error) {
  if (error?.code === "daemon_body_too_large") return 413;
  if (error?.code === "not_authorized") return 404;
  if (
    error?.code === "scope_unresolved" ||
    error?.code === "event_envelope_invalid" ||
    error?.name === "CodexEventError"
  ) return 400;
  return 422;
}

function recallErrorStatus(error) {
  if (["not_found_or_not_authorized", "not_authorized"].includes(error?.code)) return 404;
  if (error?.code === "backend_unavailable") return 503;
  if (error?.code === "daemon_timeout") return 504;
  return 400;
}

function recallErrorBody(error) {
  const code = ["not_found_or_not_authorized", "not_authorized"].includes(error?.code)
    ? "not_authorized"
    : error?.code ?? "invalid_request";
  return {
    ok: false,
    error: {
      code,
      message: code === "not_authorized"
        ? "Memory is unavailable"
        : "Recall request failed",
      retryable: ["backend_unavailable", "daemon_timeout"].includes(code),
      request_id: `req_${crypto.randomUUID()}`
    }
  };
}

function runtimeSpoolWorkspaces(runtimeRoot) {
  if (!runtimeRoot) return [];
  const resolved = path.resolve(runtimeRoot);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("daemon_runtime_root_invalid");
  const spoolRoot = path.join(fs.realpathSync(resolved), "spool");
  if (!fs.existsSync(spoolRoot)) return [];
  const spoolStat = fs.lstatSync(spoolRoot);
  if (spoolStat.isSymbolicLink() || !spoolStat.isDirectory()) {
    fail("daemon_spool_root_invalid");
  }
  return fs.readdirSync(spoolRoot, { withFileTypes: true })
    .map((entry) => {
      if (entry.isSymbolicLink()) fail("daemon_spool_root_invalid");
      return entry;
    })
    .filter((entry) => entry.isDirectory() && /^ws_[0-9a-f-]{36}$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function createSuperMemoryDaemon({
  vaultRoot,
  encryptionKey,
  authToken,
  host = "127.0.0.1",
  port = 0,
  clock = () => new Date().toISOString(),
  maxBodyBytes = 1024 * 1024,
  ollamaBaseUrl = "http://127.0.0.1:11434",
  ollamaModel = "qwen3.5:9b",
  ollamaTimeoutMs = 20_000,
  fetchImpl = globalThis.fetch,
  memoryCompiler = null,
  compilerExtractor = null,
  compilerVerifier = null,
  compilerAdmissionMode = "legacy_manual",
  compilerAdmissionPolicy = null,
  runtimeRoot = null,
  workingMemory = null,
  workingSetStore = null,
  canonicalWorker = null,
  canonicalWorkerFactory = null,
  memoryRouter = null,
  memoryRouterFactory = null,
  runtimeSupervisor = null,
  runtimeSupervisorFactory = null,
  requestScopeResolver = null,
  projectRegistry = null,
  enrollmentService = null,
  checkoutCredentialStore = null,
  historyImportService = null,
  ownerPreferenceStore = null
} = {}) {
  if (!LOOPBACK_HOSTS.has(host)) fail("daemon_host_not_loopback");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) fail("daemon_port_invalid");
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1024) fail("daemon_body_limit_invalid");
  assertToken(authToken);
  const store = createCodexCaptureStore({
    vaultRoot,
    encryptionKey,
    clock,
    workingMemory,
    workingSetStore
  });
  const router = memoryRouter ?? (typeof memoryRouterFactory === "function"
    ? memoryRouterFactory({ captureStore: store })
    : null);
  const supervisor = runtimeSupervisor ?? (typeof runtimeSupervisorFactory === "function"
    ? runtimeSupervisorFactory({ captureStore: store })
    : null);
  const worker = canonicalWorker ?? (typeof canonicalWorkerFactory === "function"
    ? canonicalWorkerFactory({ captureStore: store, memoryRouter: router })
    : null);
  const compiler = memoryCompiler ?? createCodexMemoryCompiler({
    vaultRoot,
    encryptionKey,
    captureStore: store,
    extractor: compilerExtractor,
    verifier: compilerVerifier,
    admissionMode: compilerAdmissionMode,
    admissionPolicy: compilerAdmissionPolicy,
    ollamaBaseUrl,
    ollamaModel,
    ollamaTimeoutMs,
    fetchImpl,
    clock
  });
  if (
    typeof compiler.notifyCapture !== "function" ||
    typeof compiler.recover !== "function" ||
    typeof compiler.stop !== "function" ||
    typeof compiler.stats !== "function"
  ) fail("daemon_compiler_invalid");
  if (worker && (
    typeof worker.notifySessionClosed !== "function" ||
    typeof worker.recover !== "function" ||
    typeof worker.status !== "function"
  )) fail("daemon_canonical_worker_invalid");
  if (router && [
    "recall", "workingSearch", "workingOpen", "workingNeighbors", "workingMap",
    "graphQuery", "explainPath", "search", "get", "explainCitation", "status"
  ].some((method) => typeof router[method] !== "function")) fail("daemon_memory_router_invalid");
  if (supervisor && (
    typeof supervisor.forScope !== "function" || typeof supervisor.forProject !== "function" ||
    typeof supervisor.recover !== "function" || typeof supervisor.status !== "function" ||
    typeof supervisor.close !== "function" || typeof requestScopeResolver !== "function"
  )) fail("daemon_runtime_supervisor_invalid");
  const recallRoutes = new Map([
    ["/v1/recall", "recall"],
    ["/v1/reflect", "reflect"],
    ["/v1/working/search", "workingSearch"],
    ["/v1/working/open", "workingOpen"],
    ["/v1/working/neighbors", "workingNeighbors"],
    ["/v1/working/map", "workingMap"],
    ["/v1/topic/resolve", "resolveTopic"],
    ["/v1/topic/checkpoint", "topicCheckpoint"],
    ["/v1/topic/context", "topicContext"],
    ["/v1/topic/search", "topicSearch"],
    ["/v1/recall/plan", "recallPlan"],
    ["/v1/recall/coverage", "recallCoverage"],
    ["/v1/authority/explain", "authorityExplain"],
    ["/v1/exceptions/query", "exceptionsQuery"],
    ["/v1/exceptions/resolve", "exceptionsResolve"],
    ["/v1/admin/rebuild", "rebuildFabric"],
    ["/v1/graph/query", "graphQuery"],
    ["/v1/graph/explain-path", "explainPath"],
    ["/v1/memory/search", "search"],
    ["/v1/memory/get", "get"],
    ["/v1/memory/explain-citation", "explainCitation"],
    ["/v1/memory/status", "status"]
  ]);
  const startedAt = clock();
  const counters = {
    requests: 0,
    applied: 0,
    duplicates: 0,
    rejected: 0
  };
  const handleWorkingLifecycle = async ({ envelope, working, activeRouter = router, notifyWorker = true }) => {
    const sessionEnd = envelope?.event_type === "assistant.completed";
    const compaction = envelope?.event_type === "context.compacted";
    if ((!sessionEnd && !compaction) || !working?.working_set_id) return;
    if (sessionEnd && store.workingStore?.closeSession) {
      store.workingStore.closeSession({
        workspaceId: envelope.workspace_id,
        projectId: envelope.project_id,
        sessionId: envelope.session_id,
        workingSetId: working.working_set_id,
        closedAt: envelope.occurred_at
      });
    }
    if (typeof activeRouter?.topicCheckpoint === "function") {
      Promise.resolve(activeRouter.topicCheckpoint({
        working_set_id: working.working_set_id,
        kind: sessionEnd ? "session_end" : "compaction",
        created_at: envelope.occurred_at
      })).catch(() => {});
    }
    if (sessionEnd && notifyWorker) {
      if (supervisor) {
        Promise.resolve(supervisor.notifySessionClosed({
          workspaceId: envelope.workspace_id,
          projectId: envelope.project_id,
          checkoutId: envelope.checkout_id
        }, { sessionId: envelope.session_id })).catch(() => {});
      } else if (worker) {
        Promise.resolve(worker.notifySessionClosed({ sessionId: envelope.session_id })).catch(() => {});
      }
    }
  };
  let listening = false;
  let recoveryPromise = null;
  let spoolReplay = {
    status: runtimeRoot ? "pending" : "disabled",
    workspaces: 0,
    replayed: 0,
    duplicates: 0,
    failed: 0,
    retained: 0,
    expired: 0
  };
  let fabricRecovery = {
    status: supervisor || typeof router?.rebuildFabric === "function" ? "pending" : "disabled",
    error: null
  };
  const completeFabricRecovery = (rebuilt) => ({
    status: "complete",
    error: null,
    schema: rebuilt.schema ?? null,
    graph: rebuilt.graph?.projected === true ? "projected" : rebuilt.graph?.status ?? "unchanged",
    topics: rebuilt.topics?.working_sets ?? 0,
    authority_states: rebuilt.authority_states ?? 0,
    exceptions: rebuilt.exceptions ?? 0
  });
  const completeSupervisorRecovery = (recovered) => ({
    status: recovered.failures?.length > 0 ? "degraded" : "complete",
    error: recovered.failures?.length > 0 ? "workspace_recovery_partial" : null,
    schema: "supermemory.multi-workspace-recovery.v1",
    graph: "workspace_partitioned",
    topics: 0,
    authority_states: 0,
    exceptions: 0,
    recovered_workspaces: recovered.recovered ?? 0,
    failures: recovered.failures ?? []
  });

  const scopedRouter = (request, input, capability) => {
    if (!supervisor) return { activeRouter: router, scope: null };
    const ownerProjectId = request.headers["x-supermemory-owner-project-id"];
    if (typeof ownerProjectId === "string" && projectRegistry) {
      const project = projectRegistry.snapshot().projects.find((item) => (
        item.projectId === ownerProjectId && item.status === "active"
      ));
      if (!project) fail("not_authorized");
      const assertions = [
        input?.workspace_id ?? input?.workspaceId,
        input?.project_id ?? input?.projectId
      ];
      if (
        (assertions[0] !== undefined && assertions[0] !== project.workspaceId) ||
        (assertions[1] !== undefined && assertions[1] !== project.projectId)
      ) fail("not_authorized");
      return {
        activeRouter: supervisor.forProject({ workspaceId: project.workspaceId, projectId: project.projectId }),
        scope: { workspaceId: project.workspaceId, projectId: project.projectId, ownerProxy: true }
      };
    }
    const scope = requestScopeResolver({ headers: request.headers, input, capability });
    return { activeRouter: supervisor.forScope(scope), scope };
  };

  const server = http.createServer(async (request, response) => {
    counters.requests += 1;
    if (!LOOPBACK_HOSTS.has(request.socket.localAddress) || !validHostHeader(request.headers.host)) {
      counters.rejected += 1;
      sendJson(response, 421, { ok: false, error: "daemon_host_rejected" });
      return;
    }
    if (!authorized(request.headers.authorization, authToken)) {
      counters.rejected += 1;
      sendJson(response, 401, { ok: false, error: "daemon_unauthorized" });
      return;
    }
    const recovering = [spoolReplay.status, fabricRecovery.status]
      .some((status) => ["pending", "running"].includes(status));
    if (recovering && !(request.method === "GET" && request.url === "/health")) {
      sendJson(response, 503, { ok: false, error: "daemon_recovering", retryable: true });
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      const recoveryStates = [spoolReplay.status, fabricRecovery.status];
      const runtimeStatus = recoveryStates.some((status) => ["pending", "running"].includes(status))
        ? "starting"
        : recoveryStates.includes("degraded")
          ? "degraded"
          : "ready";
      sendJson(response, 200, {
        ok: true,
        status: runtimeStatus,
        started_at: startedAt,
        capture: store.stats(),
        compiler: compiler.stats(),
        canonical_worker: supervisor?.status() ?? worker?.status() ?? { enabled: false, status: "disabled" },
        memory: supervisor
          ? supervisor.status()
          : router
            ? await router.status().catch((error) => ({ status: "degraded", error: error?.code ?? "memory_status_failed" }))
            : { status: "disabled" },
        fabric_rebuild: { ...fabricRecovery },
        spool_replay: { ...spoolReplay },
        counters: { ...counters }
      });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/projects") {
      if (!projectRegistry || typeof projectRegistry.snapshot !== "function") {
        sendJson(response, 503, { ok: false, error: "backend_unavailable" });
        return;
      }
      sendJson(response, 200, { ok: true, ...projectRegistry.snapshot() });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/owner/preferences") {
      if (!ownerPreferenceStore) {
        sendJson(response, 503, { ok: false, error: "backend_unavailable" });
        return;
      }
      sendJson(response, 200, { ok: true, memories: ownerPreferenceStore.list() });
      return;
    }
    if (request.method === "POST" && request.url === "/v1/owner/preferences/promote") {
      try {
        if (!ownerPreferenceStore) fail("backend_unavailable");
        const input = await readJsonBody(request, maxBodyBytes);
        sendJson(response, 201, { ok: true, memory: ownerPreferenceStore.promote({
          title: input.title,
          text: input.text,
          category: input.category,
          sourceProjectId: input.source_project_id,
          evidenceIds: input.evidence_ids,
          confirmation: input.confirmation
        }) });
      } catch (error) {
        sendJson(response, errorStatus(error), { ok: false, error: error?.code ?? "owner_promotion_failed" });
      }
      return;
    }
    if (request.method === "POST" && request.url === "/v1/projects/enrollment/plan") {
      try {
        const input = await readJsonBody(request, maxBodyBytes);
        sendJson(response, 200, { ok: true, ...enrollmentService.plan(input) });
      } catch (error) {
        sendJson(response, errorStatus(error), { ok: false, error: error?.code ?? "enrollment_plan_failed" });
      }
      return;
    }
    if (request.method === "POST" && request.url === "/v1/projects/enrollment/apply") {
      try {
        const input = await readJsonBody(request, maxBodyBytes);
        sendJson(response, 201, { ok: true, ...enrollmentService.apply({
          planId: input.plan_id,
          planHash: input.plan_hash
        }) });
      } catch (error) {
        sendJson(response, errorStatus(error), { ok: false, error: error?.code ?? "enrollment_apply_failed" });
      }
      return;
    }
    const credentialRoute = /^\/v1\/projects\/([^/]+)\/checkouts\/([^/]+)\/(issue|rotate|revoke)$/.exec(request.url ?? "");
    if (request.method === "POST" && credentialRoute) {
      try {
        if (!checkoutCredentialStore) fail("backend_unavailable");
        const [, projectId, checkoutId, action] = credentialRoute;
        const checkout = projectRegistry?.snapshot().checkouts.find((item) => (
          item.checkoutId === checkoutId && item.projectId === projectId
        ));
        if (!checkout) fail("not_authorized");
        const input = await readJsonBody(request, maxBodyBytes);
        const result = action === "issue"
          ? checkoutCredentialStore.issue({
            checkoutId,
            projectId,
            workspaceId: checkout.workspaceId,
            deviceId: input.device_id,
            capabilities: ["capture", "recall", "status", "history_import"]
          })
          : action === "rotate"
            ? checkoutCredentialStore.rotate({ checkoutId, deviceId: input.device_id })
            : checkoutCredentialStore.revoke({ checkoutId });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, recallErrorStatus(error), recallErrorBody(error));
      }
      return;
    }
    if (request.method === "POST" && request.url === "/v1/history/import/plan") {
      try {
        if (!historyImportService) fail("backend_unavailable");
        const input = await readJsonBody(request, maxBodyBytes);
        sendJson(response, 200, { ok: true, ...(await historyImportService.plan(input)) });
      } catch (error) {
        sendJson(response, errorStatus(error), { ok: false, error: error?.code ?? "history_plan_failed" });
      }
      return;
    }
    if (request.method === "POST" && request.url === "/v1/history/import/apply") {
      try {
        if (!historyImportService) fail("backend_unavailable");
        const input = await readJsonBody(request, maxBodyBytes);
        sendJson(response, 202, { ok: true, ...(await historyImportService.apply(input)) });
      } catch (error) {
        sendJson(response, errorStatus(error), { ok: false, error: error?.code ?? "history_apply_failed" });
      }
      return;
    }
    if (request.method === "GET" && request.url === "/v1/memory/status") {
      if (!router && !supervisor) {
        sendJson(response, 503, { ok: false, error: "backend_unavailable" });
        return;
      }
      try {
        const { activeRouter } = scopedRouter(request, {}, "status");
        sendJson(response, 200, { ok: true, ...(await activeRouter.status()) });
      } catch (error) {
        sendJson(response, recallErrorStatus(error), recallErrorBody(error));
      }
      return;
    }
    if (request.method === "POST" && recallRoutes.has(request.url)) {
      const method = recallRoutes.get(request.url);
      if (!router && !supervisor) {
        sendJson(response, 503, { ok: false, error: "backend_unavailable" });
        return;
      }
      try {
        const input = await readJsonBody(request, maxBodyBytes);
        const { activeRouter } = scopedRouter(request, input, method === "rebuildFabric" ? "status" : "recall");
        if (!activeRouter || typeof activeRouter[method] !== "function") fail("backend_unavailable");
        if (method === "rebuildFabric") fabricRecovery = { status: "running", error: null };
        const result = await activeRouter[method](input);
        if (method === "rebuildFabric") fabricRecovery = completeFabricRecovery(result);
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        if (method === "rebuildFabric") {
          fabricRecovery = { status: "degraded", error: error?.code ?? "fabric_rebuild_failed" };
        }
        counters.rejected += 1;
        sendJson(response, recallErrorStatus(error), recallErrorBody(error));
      }
      return;
    }
    if (request.method === "POST" && request.url === "/v1/events") {
      try {
        const input = await readJsonBody(request, maxBodyBytes);
        const { activeRouter } = scopedRouter(request, input, "capture");
        const result = store.ingest(input);
        let topic = null;
        if (typeof activeRouter?.resolveTopic === "function" && result.working?.working_set_id) {
          try {
            topic = await activeRouter.resolveTopic({
              working_set_id: result.working.working_set_id,
              title: input.payload?.prompt ?? input.payload?.text ?? "Sujet sans titre"
            });
          } catch (error) {
            topic = { status: "degraded", error: error?.code ?? "topic_resolution_failed" };
          }
        }
        if (result.status === "duplicate") counters.duplicates += 1;
        else counters.applied += 1;
        compiler.notifyCapture(input);
        await handleWorkingLifecycle({ envelope: input, working: result.working, activeRouter });
        sendJson(response, 202, { ok: true, ...result, topic });
      } catch (error) {
        counters.rejected += 1;
        sendJson(response, errorStatus(error), {
          ok: false,
          error: error?.code ?? error?.message ?? "capture_ingest_failed"
        });
      }
      return;
    }
    if (request.method === "POST" && request.url === "/v1/events/prepared") {
      try {
        const prepared = await readJsonBody(request, maxBodyBytes);
        const { activeRouter } = scopedRouter(request, prepared.envelope, "capture");
        const result = store.ingestPrepared(prepared);
        const envelope = prepared.envelope;
        let topic = null;
        if (typeof activeRouter?.resolveTopic === "function" && result.working?.working_set_id) {
          try {
            topic = await activeRouter.resolveTopic({
              working_set_id: result.working.working_set_id,
              title: prepared.payload?.prompt ?? prepared.payload?.text ?? "Sujet sans titre"
            });
          } catch (error) {
            topic = { status: "degraded", error: error?.code ?? "topic_resolution_failed" };
          }
        }
        if (result.status === "duplicate") counters.duplicates += 1;
        else counters.applied += 1;
        compiler.notifyCapture(envelope);
        await handleWorkingLifecycle({ envelope, working: result.working, activeRouter });
        sendJson(response, 202, { ok: true, ...result, topic });
      } catch (error) {
        counters.rejected += 1;
        sendJson(response, errorStatus(error), {
          ok: false,
          error: error?.code ?? error?.message ?? "capture_replay_failed"
        });
      }
      return;
    }
    sendJson(response, 404, { ok: false, error: "daemon_route_not_found" });
  });

  const start = () => new Promise((resolve, reject) => {
    if (listening) {
      const address = server.address();
      resolve({
        host,
        port: address.port,
        url: `http://${host === "::1" ? `[${host}]` : host}:${address.port}`
      });
      return;
    }
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      listening = true;
      const address = server.address();
      if (!address || typeof address === "string" || !LOOPBACK_HOSTS.has(address.address)) {
        server.close();
        reject(Object.assign(new Error("daemon_bound_outside_loopback"), {
          code: "daemon_bound_outside_loopback"
        }));
        return;
      }
      recoveryPromise = (async () => {
        if (supervisor) {
          fabricRecovery = { status: "running", error: null };
          try {
            fabricRecovery = completeSupervisorRecovery(await supervisor.recover());
          } catch (error) {
            fabricRecovery = {
              status: "degraded",
              error: error?.code ?? "workspace_recovery_failed"
            };
          }
        } else if (typeof router?.rebuildFabric === "function") {
          fabricRecovery = { status: "running", error: null };
          try {
            const rebuilt = await router.rebuildFabric({});
            fabricRecovery = completeFabricRecovery(rebuilt);
          } catch (error) {
            fabricRecovery = {
              status: "degraded",
              error: error?.code ?? "fabric_rebuild_failed"
            };
          }
        }
        if (runtimeRoot) {
          spoolReplay = { ...spoolReplay, status: "running" };
          try {
            const summary = await replayRuntimeSpools();
            spoolReplay = {
              status: summary.failed > 0 ? "degraded" : "complete",
              ...summary
            };
          } catch {
            spoolReplay = { ...spoolReplay, status: "degraded", failed: spoolReplay.failed + 1 };
          }
        }
        compiler.recover();
        if (worker) await worker.recover();
      })();
      const completeStart = () => resolve({
        host: address.address,
        port: address.port,
        url: `http://${address.address === "::1" ? `[${address.address}]` : address.address}:${address.port}`
      });
      recoveryPromise.then(completeStart, () => {
        spoolReplay = { ...spoolReplay, status: "degraded", failed: spoolReplay.failed + 1 };
        completeStart();
      });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port, exclusive: true });
  });

  const closeServer = () => new Promise((resolve, reject) => {
    if (!listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else {
        listening = false;
        resolve();
      }
    });
  });

  const stop = async () => {
    await closeServer();
    if (recoveryPromise) await recoveryPromise;
    await compiler.stop();
    if (supervisor) await supervisor.close();
  };

  const replaySpool = async (spool) => {
    const completedScopes = new Map();
    const result = await spool.replay(async (prepared) => {
      const activeRouter = supervisor ? supervisor.forProject({
        workspaceId: prepared.envelope.workspace_id,
        projectId: prepared.envelope.project_id
      }) : router;
      const ingest = store.ingestPrepared(prepared);
      if (typeof activeRouter?.resolveTopic === "function" && ingest.working?.working_set_id) {
        try {
          await activeRouter.resolveTopic({
            working_set_id: ingest.working.working_set_id,
            title: prepared.payload?.prompt ?? prepared.payload?.text ?? "Sujet sans titre"
          });
        } catch {
          // Capture replay stays durable even when topic projection needs repair.
        }
      }
      await handleWorkingLifecycle({
        envelope: prepared.envelope,
        working: ingest.working,
        activeRouter,
        notifyWorker: false
      });
      if (prepared.envelope.event_type === "assistant.completed") {
        const scope = {
          workspaceId: prepared.envelope.workspace_id,
          projectId: prepared.envelope.project_id,
          sessionId: prepared.envelope.session_id
        };
        completedScopes.set(`${scope.workspaceId}\0${scope.sessionId}`, scope);
      }
      return ingest;
    });
    for (const scope of completedScopes.values()) {
      compiler.schedule(scope);
      if (supervisor) {
        Promise.resolve(supervisor.notifySessionClosed({
          workspaceId: scope.workspaceId,
          projectId: scope.projectId
        }, { sessionId: scope.sessionId })).catch(() => {});
      } else if (worker && worker.workspaceId === scope.workspaceId) {
        Promise.resolve(worker.notifySessionClosed({ sessionId: scope.sessionId })).catch(() => {});
      }
    }
    return result;
  };

  const replayRuntimeSpools = async () => {
    const summary = {
      workspaces: 0,
      replayed: 0,
      duplicates: 0,
      failed: 0,
      retained: 0,
      expired: 0
    };
    for (const workspaceId of runtimeSpoolWorkspaces(runtimeRoot)) {
      summary.workspaces += 1;
      const spool = createCodexSpool({
        runtimeRoot,
        workspaceId,
        encryptionKey,
        clock
      });
      const replay = await replaySpool(spool);
      for (const key of ["replayed", "duplicates", "failed", "retained", "expired"]) {
        summary[key] += Number(replay[key] ?? 0);
      }
    }
    return summary;
  };

  return {
    host,
    store,
    compiler,
    canonicalWorker: worker,
    memoryRouter: router,
    runtimeSupervisor: supervisor,
    start,
    stop,
    replaySpool,
    replayRuntimeSpools,
    counters: () => ({ ...counters })
  };
}

function checkoutHeaders(checkoutAuth) {
  if (!checkoutAuth) return {};
  const { checkoutId, deviceId, token } = checkoutAuth;
  if (
    typeof checkoutId !== "string" || typeof deviceId !== "string" ||
    typeof token !== "string" || token.length < 32
  ) fail("daemon_checkout_auth_invalid");
  return {
    "x-supermemory-checkout-id": checkoutId,
    "x-supermemory-device-id": deviceId,
    "x-supermemory-checkout-token": token
  };
}

function postJson(endpoint, route, value, authToken, timeoutMs, checkoutAuth = null) {
  const url = new URL(route, endpoint);
  if (!isLoopbackUrl(url)) return Promise.reject(Object.assign(
    new Error("daemon_endpoint_not_loopback"),
    { code: "daemon_endpoint_not_loopback" }
  ));
  const body = Buffer.from(JSON.stringify(value));
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authToken}`,
        "content-type": "application/json",
        "content-length": body.length,
        ...checkoutHeaders(checkoutAuth)
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          reject(Object.assign(new Error("daemon_response_invalid"), {
            code: "daemon_response_invalid"
          }));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300 || parsed.ok !== true) {
          const responseError = typeof parsed.error === "object" && parsed.error
            ? parsed.error.code
            : parsed.error;
          reject(Object.assign(new Error(responseError ?? "daemon_request_failed"), {
            code: responseError ?? "daemon_request_failed"
          }));
          return;
        }
        resolve(parsed);
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(Object.assign(new Error("daemon_timeout"), { code: "daemon_timeout" }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

export function createSuperMemoryDaemonClient({
  endpoint,
  authToken,
  spool,
  checkoutAuth = null,
  encryptionKey = null,
  timeoutMs = 250
} = {}) {
  assertToken(authToken);
  const parsed = new URL(endpoint);
  if (!isLoopbackUrl(parsed)) fail("daemon_endpoint_not_loopback");
  if (!spool || typeof spool.enqueue !== "function") fail("daemon_spool_required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10) fail("daemon_timeout_invalid");

  const capture = async (input) => {
    const preparedInput = encryptionKey ? prepareCodexCapture(input, { encryptionKey }) : null;
    let spoolReplay = null;
    try {
      spoolReplay = await spool.replay(async (prepared) => {
        const response = await postJson(
          parsed,
          "/v1/events/prepared",
          prepared,
          authToken,
          timeoutMs,
          checkoutAuth
        );
        return response;
      }, { maxEntries: 1 });
    } catch {
      spoolReplay = { status: "degraded" };
    }
    try {
      const response = await postJson(
        parsed,
        preparedInput ? "/v1/events/prepared" : "/v1/events",
        preparedInput ?? input,
        authToken,
        timeoutMs,
        checkoutAuth
      );
      return {
        ...response,
        status: "delivered",
        eventId: response.eventId,
        spoolReplay
      };
    } catch (daemonError) {
      try {
        return {
          ...(preparedInput && typeof spool.enqueuePrepared === "function"
            ? spool.enqueuePrepared(preparedInput)
            : spool.enqueue(input)),
          fallback: true,
          daemonError: daemonError?.code ?? "daemon_unavailable"
        };
      } catch (spoolError) {
        return {
          status: "dropped",
          reason: "spool_unavailable",
          fallback: true,
          daemonError: daemonError?.code ?? "daemon_unavailable",
          spoolError: spoolError?.code ?? spoolError?.message ?? "spool_unavailable"
        };
      }
    }
  };

  return { capture };
}

export function createSuperMemoryRecallClient({
  endpoint,
  authToken,
  checkoutAuth = null,
  timeoutMs = 1_500
} = {}) {
  assertToken(authToken);
  const parsed = new URL(endpoint);
  if (!isLoopbackUrl(parsed)) fail("daemon_endpoint_not_loopback");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000) {
    fail("daemon_timeout_invalid");
  }
  const invoke = async (route, input = {}, requestTimeoutMs = timeoutMs) => {
    const { ok, ...result } = await postJson(
      parsed,
      route,
      input,
      authToken,
      requestTimeoutMs,
      checkoutAuth
    );
    return result;
  };
  const workingSetPattern = /^wset_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const assertBound = ({ working_set_id: workingSetId } = {}) => {
    if (typeof workingSetId !== "string" || !workingSetPattern.test(workingSetId)) {
      fail("not_found_or_not_authorized");
    }
    return { working_set_id: workingSetId, authority: "daemon" };
  };
  return Object.freeze({
    assertBound,
    recall: (input) => invoke("/v1/recall", input),
    reflect: (input) => invoke("/v1/reflect", input, Math.max(timeoutMs, 30_000)),
    search: (input) => invoke("/v1/memory/search", input),
    get: (input) => invoke("/v1/memory/get", input),
    explainCitation: (input) => invoke("/v1/memory/explain-citation", input),
    workingMap: (input) => invoke("/v1/working/map", input),
    workingSearch: (input) => invoke("/v1/working/search", input),
    workingOpen: (input) => invoke("/v1/working/open", input),
    workingNeighbors: (input) => invoke("/v1/working/neighbors", input),
    resolveTopic: (input) => invoke("/v1/topic/resolve", input),
    topicCheckpoint: (input) => invoke("/v1/topic/checkpoint", input, Math.max(timeoutMs, 30_000)),
    topicContext: (input) => invoke("/v1/topic/context", input),
    topicSearch: (input) => invoke("/v1/topic/search", input),
    recallPlan: (input) => invoke("/v1/recall/plan", input),
    recallCoverage: (input) => invoke("/v1/recall/coverage", input),
    authorityExplain: (input) => invoke("/v1/authority/explain", input),
    exceptionsQuery: (input) => invoke("/v1/exceptions/query", input),
    exceptionsResolve: (input) => invoke("/v1/exceptions/resolve", input),
    rebuildFabric: () => invoke("/v1/admin/rebuild", {}, Math.max(timeoutMs, 30_000)),
    graphQuery: (input) => invoke("/v1/graph/query", input),
    explainPath: (input) => invoke("/v1/graph/explain-path", input),
    status: () => invoke("/v1/memory/status", {})
  });
}
