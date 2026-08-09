import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyCodexHistoryImportPlan,
  buildCodexHistoryImportPlan
} from "../scripts/lib/codex-history-import.mjs";

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
    { timestamp: "2026-08-01T10:00:00.000Z", type: "session_meta", payload: { id: "native-session", cwd: root, cli_version: "1", model_provider: "openai" } },
    { timestamp: "2026-08-01T10:01:00.000Z", type: "event_msg", payload: { type: "user_message", message: "question" } },
    { timestamp: "2026-08-01T10:01:10.000Z", type: "response_item", payload: { type: "reasoning", encrypted_content: "never" } },
    { timestamp: "2026-08-01T10:02:00.000Z", type: "event_msg", payload: { type: "agent_message", message: "answer" } }
  ];
  fs.writeFileSync(file, `${rows.map(JSON.stringify).join("\n")}\n`);
  const plan = buildCodexHistoryImportPlan({ historyRoot: history, resolveBinding: () => BINDING });
  assert.equal(plan.totals.importable, 1);
  assert.equal(plan.totals.events, 4);
  const captured = [];
  const checkpointFile = path.join(root, "checkpoint.json");
  const first = await applyCodexHistoryImportPlan({
    plan,
    expectedPlanHash: plan.plan_hash,
    checkpointFile,
    capture: async (event) => { captured.push(event); return { status: "delivered" }; }
  });
  assert.equal(first.imported, 4);
  assert.equal(JSON.stringify(captured).includes("never"), false);
  const second = await applyCodexHistoryImportPlan({
    plan,
    expectedPlanHash: plan.plan_hash,
    checkpointFile,
    capture: async () => { throw new Error("must_not_replay"); }
  });
  assert.equal(second.imported, 0);
});
