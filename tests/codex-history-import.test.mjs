import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyCodexHistoryImportPlan,
  buildCodexHistoryImportPlan
} from "../scripts/lib/codex-history-import.mjs";
import { discoverCodexHistory } from "../scripts/lib/codex-history-discovery.mjs";
import {
  createCodexHistoryBindingResolver,
  validateCodexHistoryRouting
} from "../scripts/lib/codex-history-routing.mjs";

const BINDING = {
  status: "bound",
  workspaceId: "ws_018f7c0e-7b7d-7abc-8def-0123456789aa",
  projectId: "prj_018f7c0e-7b7d-7abc-8def-0123456789ab",
  checkoutId: "co_018f7c0e-7b7d-7abc-8def-0123456789ac"
};

test("history import is explicit, excludes reasoning and resumes idempotently", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const history = path.join(root, "sessions");
  fs.mkdirSync(history);
  const file = path.join(history, "rollout.jsonl");
  const rows = [
    { timestamp: "2026-08-01T10:00:00.000Z", type: "session_meta", payload: { id: "native-session", cwd: root, source: "vscode", cli_version: "1", model_provider: "openai" } },
    { timestamp: "2026-08-01T10:01:00.000Z", type: "event_msg", payload: { type: "user_message", message: "question" } },
    { timestamp: "2026-08-01T10:01:10.000Z", type: "response_item", payload: { type: "reasoning", encrypted_content: "never" } },
    { timestamp: "2026-08-01T10:01:20.000Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: "never-import-tools" } },
    { timestamp: "2026-08-01T10:01:30.000Z", type: "event_msg", payload: { type: "agent_message", message: "progress-never-import" } },
    { timestamp: "2026-08-01T10:02:00.000Z", type: "event_msg", payload: { type: "agent_message", message: "answer" } },
    { timestamp: "2026-08-01T10:03:00.000Z", type: "event_msg", payload: { type: "user_message", message: "follow-up" } },
    { timestamp: "2026-08-01T10:04:00.000Z", type: "event_msg", payload: { type: "agent_message", message: "final answer" } }
  ];
  fs.writeFileSync(file, `${rows.map(JSON.stringify).join("\n")}\n`);
  const plan = buildCodexHistoryImportPlan({ historyRoot: history, resolveBinding: () => BINDING });
  assert.equal(plan.schema, "supermemory.session-import-plan.v2");
  assert.equal(plan.reader_version, "codex-rollout-jsonl.v3");
  assert.equal(plan.totals.importable, 1);
  assert.equal(plan.totals.events, 6);
  const captured = [];
  const checkpointFile = path.join(root, "checkpoint.json");
  const first = await applyCodexHistoryImportPlan({
    plan,
    expectedPlanHash: plan.plan_hash,
    checkpointFile,
    capture: async (event) => { captured.push(event); return { status: "delivered" }; }
  });
  assert.equal(first.imported, 6);
  assert.equal(JSON.stringify(captured).includes("never"), false);
  assert.equal(captured.some((event) => event.event_type === "tool.completed"), false);
  assert.equal(captured.filter((event) => event.event_type === "assistant.completed").length, 1);
  assert.equal(captured.filter((event) => event.event_type === "turn.completed").length, 1);
  const second = await applyCodexHistoryImportPlan({
    plan,
    expectedPlanHash: plan.plan_hash,
    checkpointFile,
    capture: async () => { throw new Error("must_not_replay"); }
  });
  assert.equal(second.imported, 0);
});

test("history discovery excludes exec and subagent sessions before hashing/import", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-history-source-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = [
    ["human", "vscode"],
    ["cli", "cli"],
    ["exec", "exec"],
    ["agent", { subagent: "goal_worker" }]
  ];
  for (const [id, source] of rows) {
    fs.writeFileSync(path.join(root, `${id}.jsonl`), `${JSON.stringify({
      timestamp: "2026-08-01T10:00:00.000Z",
      type: "session_meta",
      payload: { id, cwd: root, source }
    })}\n`);
  }
  const discovered = discoverCodexHistory({ root });
  assert.deepEqual(discovered.sessions.map((item) => item.session_id), ["cli", "human"]);
  assert.deepEqual(discovered.excluded.map((item) => item.source_kind).sort(), ["exec", "subagent"]);
  assert.equal(discovered.unsupported.length, 0);
});

test("history discovery excludes an actively written top-level session", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-history-active-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "active.jsonl"), `${JSON.stringify({
    timestamp: "2026-08-01T10:00:00.000Z",
    type: "session_meta",
    payload: { id: "active-session", cwd: root, source: "vscode" }
  })}\n`);
  const discovered = discoverCodexHistory({ root, excludedSessionIds: ["active-session"] });
  assert.equal(discovered.sessions.length, 0);
  assert.equal(discovered.excluded[0].reason, "active_session");
});

test("history plan merges active and archived roots and routes aliases before fallback", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-history-roots-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const active = path.join(root, "active");
  const archived = path.join(root, "archived");
  const project = path.join(root, "project");
  const adHoc = path.join(root, "ad-hoc");
  fs.mkdirSync(active); fs.mkdirSync(archived); fs.mkdirSync(project); fs.mkdirSync(adHoc);
  for (const [directory, id, cwd] of [[active, "one", project], [archived, "two", adHoc]]) {
    fs.writeFileSync(path.join(directory, `${id}.jsonl`), `${[
      { timestamp: "2026-08-01T10:00:00.000Z", type: "session_meta", payload: { id, cwd, source: "vscode" } },
      { timestamp: "2026-08-01T10:01:00.000Z", type: "event_msg", payload: { type: "user_message", message: id } }
    ].map(JSON.stringify).join("\n")}\n`);
  }
  const personal = {
    status: "bound",
    workspaceId: "ws_018f7c0e-7b7d-7abc-8def-0123456789ba",
    projectId: "prj_018f7c0e-7b7d-7abc-8def-0123456789bb",
    checkoutId: "co_018f7c0e-7b7d-7abc-8def-0123456789bc"
  };
  const routing = validateCodexHistoryRouting({
    schema: "supermemory.codex-history-routing.v1",
    routes: [
      { route_id: "project", display_name: "Project", roots: [project], binding: { project_id: BINDING.projectId, workspace_id: BINDING.workspaceId, checkout_id: BINDING.checkoutId } },
      { route_id: "personal", display_name: "Personal", roots: [path.join(root, "never")], binding: { project_id: personal.projectId, workspace_id: personal.workspaceId, checkout_id: personal.checkoutId } }
    ],
    fallback_route_id: "personal"
  });
  const plan = buildCodexHistoryImportPlan({
    historyRoots: [active, archived],
    resolveBinding: createCodexHistoryBindingResolver({ routing })
  });
  assert.equal(plan.totals.discovered, 2);
  assert.equal(plan.totals.importable, 2);
  assert.deepEqual(plan.sessions.map((item) => item.binding.routeId), ["project", "personal"]);
  assert.deepEqual(plan.history_roots, [fs.realpathSync(active), fs.realpathSync(archived)]);
});

test("history reader streams long lines, truncates visible text and rejects stale v1 plans", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-history-stream-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "large.jsonl");
  fs.writeFileSync(file, `${[
    { timestamp: "2026-08-01T10:00:00.000Z", type: "session_meta", payload: { id: "large", cwd: root, source: "cli" } },
    { timestamp: "2026-08-01T10:01:00.000Z", type: "event_msg", payload: { type: "user_message", message: "x".repeat(2 * 1024 * 1024) } },
    { timestamp: "2026-08-01T10:02:00.000Z", type: "event_msg", payload: { type: "agent_message", message: "done" } }
  ].map(JSON.stringify).join("\n")}\n`);
  const plan = buildCodexHistoryImportPlan({ historyRoot: root, resolveBinding: () => BINDING, maxEventBytes: 4096 });
  const captured = [];
  await applyCodexHistoryImportPlan({
    plan,
    expectedPlanHash: plan.plan_hash,
    checkpointFile: path.join(root, "checkpoint.json"),
    maxEventBytes: 4096,
    capture: async (event) => { captured.push(event); return { status: "delivered" }; }
  });
  const prompt = captured.find((event) => event.event_type === "prompt.submitted");
  assert.ok(Buffer.byteLength(prompt.payload.prompt) <= 4096);
  assert.match(prompt.payload.prompt, /TRUNCATED sha256:/);
  await assert.rejects(() => applyCodexHistoryImportPlan({
    plan: { ...plan, schema: "supermemory.session-import-plan.v1" },
    expectedPlanHash: plan.plan_hash,
    checkpointFile: path.join(root, "other.json"),
    capture: async () => ({ status: "delivered" })
  }), /history_plan_invalid/);
});
