import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-redaction.mjs";
import { discoverCodexHistory } from "./codex-history-discovery.mjs";
import { readCodexRolloutHistory } from "./codex-history-readers.mjs";

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
  resolveBinding,
  from = null,
  to = null,
  maxEventBytes = 524_288,
  clock = () => new Date().toISOString()
} = {}) {
  if (typeof resolveBinding !== "function") fail("history_binding_resolver_required");
  const discovery = discoverCodexHistory({ root: historyRoot });
  const sessions = [];
  const ambiguous = [];
  for (const source of discovery.sessions) {
    if (from && Date.parse(source.started_at) < Date.parse(from)) continue;
    if (to && Date.parse(source.started_at) > Date.parse(to)) continue;
    const binding = resolveBinding(source.cwd);
    if (binding?.status !== "bound") {
      ambiguous.push({ source_hash: source.source_hash, reason: `project_${binding?.status ?? "unknown"}` });
      continue;
    }
    const events = readCodexRolloutHistory(source, { binding, maxEventBytes });
    sessions.push({
      source,
      binding: {
        projectId: binding.projectId,
        workspaceId: binding.workspaceId,
        checkoutId: binding.checkoutId
      },
      event_count: events.length
    });
  }
  const plan = {
    schema: "supermemory.session-import-plan.v1",
    plan_id: `hplan_${crypto.randomUUID()}`,
    created_at: clock(),
    history_root: discovery.root,
    filters: { from, to },
    sessions,
    unsupported: discovery.unsupported,
    ambiguous,
    totals: {
      discovered: discovery.sessions.length,
      importable: sessions.length,
      unsupported: discovery.unsupported.length,
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
  clock = () => new Date().toISOString()
} = {}) {
  if (plan?.schema !== "supermemory.session-import-plan.v1" || planHash(plan) !== expectedPlanHash) {
    fail("history_plan_invalid");
  }
  if (typeof capture !== "function") fail("history_capture_required");
  const checkpoint = fs.existsSync(checkpointFile)
    ? JSON.parse(fs.readFileSync(checkpointFile, "utf8"))
    : { schema: "supermemory.session-import-checkpoint.v1", plan_hash: expectedPlanHash, sessions: {} };
  if (checkpoint.plan_hash !== expectedPlanHash) fail("history_checkpoint_mismatch");
  const summary = { imported: 0, duplicates: 0, spooled: 0, failed: 0, sessions: 0 };
  for (const item of plan.sessions) {
    if (checkpoint.sessions[item.source.source_hash]?.status === "complete") continue;
    const currentHash = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(item.source.file)).digest("hex")}`;
    if (currentHash !== item.source.source_hash) fail("history_source_changed");
    const events = readCodexRolloutHistory(item.source, {
      binding: item.binding,
      maxEventBytes,
      observedAt: clock()
    });
    const state = checkpoint.sessions[item.source.source_hash] ?? { next_sequence: 0, status: "running" };
    for (const event of events.slice(state.next_sequence)) {
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
  }
  return { schema: "supermemory.session-import-result.v1", plan_hash: expectedPlanHash, ...summary };
}
