import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-redaction.mjs";
import { discoverCodexHistory, fingerprintCodexHistoryFile } from "./codex-history-discovery.mjs";
import {
  CODEX_HISTORY_READER_VERSION,
  inspectCodexRolloutHistory,
  iterateCodexRolloutHistory
} from "./codex-history-readers.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function planHash(value) {
  const copy = structuredClone(value);
  delete copy.plan_hash;
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(copy)).digest("hex")}`;
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
  fs.chmodSync(filePath, 0o600);
}

export function buildCodexHistoryImportPlan({
  historyRoot,
  historyRoots = null,
  resolveBinding,
  from = null,
  to = null,
  maxEventBytes = 524_288,
  maxFileBytes = 2 * 1024 * 1024 * 1024,
  allowedSources = ["vscode", "cli"],
  excludedSessionIds = [],
  clock = () => new Date().toISOString()
} = {}) {
  if (typeof resolveBinding !== "function") fail("history_binding_resolver_required");
  const requestedRoots = historyRoots ?? [historyRoot];
  if (!Array.isArray(requestedRoots) || !requestedRoots.length || requestedRoots.some((root) => !root)) {
    fail("history_roots_required");
  }
  const discoveries = requestedRoots.map((root) => discoverCodexHistory({
    root,
    maxFileBytes,
    allowedSources,
    excludedSessionIds
  }));
  const sessions = [];
  const ambiguous = [];
  const seenSessions = new Set();
  for (const source of discoveries.flatMap((item) => item.sessions)) {
    if (from && Date.parse(source.started_at) < Date.parse(from)) continue;
    if (to && Date.parse(source.started_at) > Date.parse(to)) continue;
    if (seenSessions.has(source.session_id)) {
      ambiguous.push({ source_hash: source.source_hash, reason: "duplicate_session_id" });
      continue;
    }
    seenSessions.add(source.session_id);
    let binding;
    try {
      binding = resolveBinding(source.cwd, source);
    } catch (error) {
      binding = { status: "error", error: error?.code ?? error?.message ?? "binding_failed" };
    }
    if (binding?.status !== "bound") {
      ambiguous.push({
        source_hash: source.source_hash,
        session_id: source.session_id,
        cwd: source.cwd,
        reason: `project_${binding?.status ?? "unknown"}`,
        detail: binding?.error ?? null
      });
      continue;
    }
    const inspection = inspectCodexRolloutHistory(source);
    sessions.push({
      source,
      binding: {
        projectId: binding.projectId,
        workspaceId: binding.workspaceId,
        checkoutId: binding.checkoutId,
        deviceId: binding.deviceId ?? null,
        routeId: binding.routeId ?? null,
        displayName: binding.displayName ?? null
      },
      inspection,
      event_count: inspection.event_count
    });
  }
  sessions.sort((left, right) => (
    left.source.started_at.localeCompare(right.source.started_at) ||
    left.source.file.localeCompare(right.source.file)
  ));
  const excluded = discoveries.flatMap((item) => item.excluded);
  const unsupported = discoveries.flatMap((item) => item.unsupported);
  const plan = {
    schema: "supermemory.session-import-plan.v2",
    plan_id: `hplan_${crypto.randomUUID()}`,
    created_at: clock(),
    reader_version: CODEX_HISTORY_READER_VERSION,
    history_roots: discoveries.map((item) => item.root),
    filters: {
      from,
      to,
      allowed_sources: [...allowedSources],
      active_sessions_excluded: excludedSessionIds.length,
      max_file_bytes: maxFileBytes,
      max_event_bytes: maxEventBytes
    },
    sessions,
    excluded,
    unsupported,
    ambiguous,
    totals: {
      discovered: discoveries.reduce((total, item) => total + item.sessions.length + item.excluded.length + item.unsupported.length, 0),
      eligible: discoveries.reduce((total, item) => total + item.sessions.length, 0),
      importable: sessions.length,
      excluded: excluded.length,
      unsupported: unsupported.length,
      ambiguous: ambiguous.length,
      events: sessions.reduce((total, item) => total + item.event_count, 0),
      bytes: sessions.reduce((total, item) => total + item.source.bytes, 0)
    }
  };
  plan.plan_hash = planHash(plan);
  return plan;
}

export async function applyCodexHistoryImportPlan({
  plan,
  expectedPlanHash,
  capture,
  checkpointFile,
  maxEventBytes = 524_288,
  maxParallelProjects = 4,
  clock = () => new Date().toISOString()
} = {}) {
  if (
    plan?.schema !== "supermemory.session-import-plan.v2" ||
    plan.reader_version !== CODEX_HISTORY_READER_VERSION ||
    planHash(plan) !== expectedPlanHash
  ) {
    fail("history_plan_invalid");
  }
  if (typeof capture !== "function") fail("history_capture_required");
  if (!Number.isSafeInteger(maxParallelProjects) || maxParallelProjects < 1 || maxParallelProjects > 8) {
    fail("history_parallelism_invalid");
  }
  const checkpoint = fs.existsSync(checkpointFile)
    ? JSON.parse(fs.readFileSync(checkpointFile, "utf8"))
    : { schema: "supermemory.session-import-checkpoint.v1", plan_hash: expectedPlanHash, sessions: {} };
  if (checkpoint.plan_hash !== expectedPlanHash) fail("history_checkpoint_mismatch");
  const summary = { imported: 0, duplicates: 0, spooled: 0, failed: 0, sessions: 0 };
  const processSession = async (item) => {
    if (checkpoint.sessions[item.source.source_hash]?.status === "complete") return;
    const currentHash = fingerprintCodexHistoryFile(item.source.file);
    if (currentHash !== item.source.source_hash) fail("history_source_changed");
    const events = iterateCodexRolloutHistory(item.source, {
      binding: item.binding,
      maxEventBytes,
      observedAt: clock(),
      inspection: item.inspection
    });
    const state = checkpoint.sessions[item.source.source_hash] ?? { next_sequence: 0, status: "running" };
    for (const event of events) {
      if (event.sequence < state.next_sequence) continue;
      try {
        const result = await capture(event);
        if (["applied", "delivered"].includes(result.status)) summary.imported += 1;
        else if (result.status === "duplicate") summary.duplicates += 1;
        else if (result.status === "spooled") summary.spooled += 1;
        else summary.failed += 1;
        state.next_sequence = event.sequence + 1;
        checkpoint.sessions[item.source.source_hash] = state;
        atomicJson(checkpointFile, checkpoint);
      } catch {
        summary.failed += 1;
        checkpoint.sessions[item.source.source_hash] = state;
        atomicJson(checkpointFile, checkpoint);
        throw Object.assign(new Error("history_import_interrupted"), { code: "history_import_interrupted" });
      }
    }
    state.status = "complete";
    state.completed_at = clock();
    checkpoint.sessions[item.source.source_hash] = state;
    atomicJson(checkpointFile, checkpoint);
    summary.sessions += 1;
  };
  const grouped = new Map();
  for (const item of plan.sessions) {
    const key = `${item.binding.workspaceId}:${item.binding.projectId}`;
    const sessions = grouped.get(key) ?? [];
    sessions.push(item);
    grouped.set(key, sessions);
  }
  const projects = [...grouped.values()];
  let nextProject = 0;
  let interrupted = false;
  const worker = async () => {
    while (!interrupted) {
      const index = nextProject++;
      if (index >= projects.length) return;
      try {
        for (const item of projects[index]) await processSession(item);
      } catch (error) {
        interrupted = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxParallelProjects, projects.length) }, worker));
  return { schema: "supermemory.session-import-result.v1", plan_hash: expectedPlanHash, ...summary };
}
