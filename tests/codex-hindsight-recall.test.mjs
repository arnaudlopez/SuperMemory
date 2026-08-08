import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexHindsight } from "../scripts/lib/codex-hindsight.mjs";
import { createCodexMemoryRecall } from "../scripts/lib/codex-memory-recall.mjs";
import { createCodexWorkspaceStore } from "../scripts/lib/codex-workspace-store.mjs";

const PROJECT_A = "prj_018f1234-5678-7abc-8def-0123456789a1";
const PROJECT_B = "prj_018f1234-5678-7abc-8def-0123456789b1";
const WORKSPACE_A = "ws_018f1234-5678-7abc-8def-0123456789a2";
const WORKSPACE_B = "ws_018f1234-5678-7abc-8def-0123456789b2";
const NOW = "2026-07-24T18:00:00.000Z";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-recall-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { vault };
}

async function approved(store, suffix, text = "Use PostgreSQL for durable state.") {
  const candidate = store.createCandidate({
    workspace_id: store.workspaceId,
    project_id: store.projectId,
    archive_id: `arc_018f1234-5678-7abc-8def-0123456789${suffix}`,
    event_ids: [`evt_${suffix[0].repeat(64)}`],
    turn_snapshot_id: `tsnap_${suffix[1].repeat(64)}`,
    source_snapshot_ids: [`snap_${suffix[2].repeat(64)}`],
    title: "Database architecture",
    proposed_text: text,
    type: "decision",
    confidence: 0.96,
    uncertainty: "",
    sensitivity: "standard",
    extractor: { model: "fixture", prompt_version: "v1" }
  });
  return store.reviewCandidate(candidate.candidate_id, { action: "approve" });
}

test("Hindsight uses one opaque bank per workspace and all-strict Codex tags", async () => {
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url, request });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [] })
    };
  };
  const a = createCodexHindsight({ workspaceId: WORKSPACE_A, fetchImpl });
  const b = createCodexHindsight({ workspaceId: WORKSPACE_B, fetchImpl });
  assert.notEqual(a.bankId, b.bankId);
  assert.equal(a.bankId.includes(WORKSPACE_A), false);
  const memory = {
    memory_id: "mem_018f1234-5678-7abc-8def-0123456789aa",
    workspace_id: WORKSPACE_A,
    project_id: PROJECT_A,
    candidate_id: "cand_018f1234-5678-7abc-8def-0123456789ab",
    evidence: [`evt_${"1".repeat(64)}`],
    title: "Architecture",
    text: "Use PostgreSQL.",
    status: "active",
    sensitivity: "standard",
    allowed_consumers: ["codex"]
  };
  await a.project(memory);
  await a.recall("database");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url.includes(a.bankId)));
  const projectBody = JSON.parse(calls[0].request.body);
  assert.deepEqual(projectBody.items[0].tags, a.requiredTags);
  const recallBody = JSON.parse(calls[1].request.body);
  assert.equal(recallBody.tags_match, "all_strict");
  assert.deepEqual(recallBody.tags, a.requiredTags);
});

test("Hindsight rebuild deterministically reprojects active canonical memory", async () => {
  const calls = [];
  const hindsight = createCodexHindsight({
    workspaceId: WORKSPACE_A,
    fetchImpl: async (_url, request) => {
      calls.push(JSON.parse(request.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({}) };
    }
  });
  const memory = (id, title) => ({
    memory_id: id,
    workspace_id: WORKSPACE_A,
    project_id: PROJECT_A,
    candidate_id: "cand_018f1234-5678-7abc-8def-0123456789ab",
    evidence: [`evt_${"1".repeat(64)}`],
    title,
    text: `${title} body`,
    status: "active",
    sensitivity: "standard",
    allowed_consumers: ["codex"]
  });
  const second = memory("mem_018f1234-5678-7abc-8def-0123456789bb", "Second");
  const first = memory("mem_018f1234-5678-7abc-8def-0123456789aa", "First");
  const result = await hindsight.rebuild([second, first]);
  assert.equal(result.synced, 2);
  assert.deepEqual(calls.map((body) => body.items[0].metadata.memory_id), [
    first.memory_id,
    second.memory_id
  ]);
  assert.ok(calls.every((body) => body.items[0].tags.join("|") === (
    calls[0].items[0].tags.join("|")
  )));
});

test("gateway revalidates every Hindsight result against active vault memory", async (t) => {
  const { vault } = fixture(t);
  const store = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_A,
    projectId: PROJECT_A,
    clock: () => NOW
  });
  const approval = await approved(store, "456");
  const hindsight = {
    enabled: true,
    async recall() {
      return {
        results: [
          { memoryId: `mem_${"f".repeat(64)}`, score: 1 },
          { memoryId: approval.memory.memory_id, score: 0.91 }
        ],
        trace: { bankId: "opaque-test" }
      };
    },
    async status() {
      return { status: "ready", available: true, bankId: "opaque-test" };
    }
  };
  const recall = createCodexMemoryRecall({
    workspaceStore: store,
    hindsight,
    clock: () => NOW
  });
  const result = await recall.search({ query: "database", limit: 5 });
  assert.equal(result.mode, "hindsight");
  assert.deepEqual(result.results.map((entry) => entry.memory_id), [approval.memory.memory_id]);
  assert.equal(result.trace.ignored_unknown_hindsight_results, 1);
  assert.equal(result.results[0].citation.archive_id, undefined);
  assert.match(result.results[0].citation.turn_snapshot_id, /^tsnap_/);
});

test("Hindsight failure declares local fallback with identical vault policy and citations", async (t) => {
  const { vault } = fixture(t);
  const store = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_A,
    projectId: PROJECT_A,
    clock: () => NOW
  });
  const approval = await approved(store, "789", "Keep the database migration reversible.");
  const recall = createCodexMemoryRecall({
    workspaceStore: store,
    hindsight: {
      enabled: true,
      async recall() {
        const error = new Error("down");
        error.code = "hindsight_unavailable";
        throw error;
      },
      async status() {
        return { status: "unavailable", available: false, bankId: "opaque-test" };
      }
    },
    clock: () => NOW
  });
  const result = await recall.search({ query: "database migration", limit: 99 });
  assert.equal(result.mode, "local_fallback");
  assert.equal(result.fallback_reason, "hindsight_unavailable");
  assert.equal(result.bounded, true);
  assert.equal(result.results[0].memory_id, approval.memory.memory_id);
  assert.equal(result.results[0].citation.locator.kind, "turn_snapshot");
});

test("get refuses inactive and cross-workspace memory IDs", async (t) => {
  const { vault } = fixture(t);
  const a = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_A,
    projectId: PROJECT_A,
    clock: () => NOW
  });
  const b = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_B,
    projectId: PROJECT_B,
    clock: () => NOW
  });
  const activeA = await approved(a, "abc");
  const activeB = await approved(b, "def");
  const recall = createCodexMemoryRecall({ workspaceStore: a, clock: () => NOW });
  assert.throws(() => recall.get({ memory_id: activeB.memory.memory_id }), (error) => (
    error.code === "scope_mismatch"
  ));
  await a.revokeMemory(activeA.memory.memory_id, { reason: "Superseded." });
  assert.throws(() => recall.get({ memory_id: activeA.memory.memory_id }), (error) => (
    error.code === "memory_not_active"
  ));
  assert.throws(() => recall.get({
    memory_id: activeA.memory.memory_id,
    workspace_id: WORKSPACE_B
  }), (error) => error.code === "scope_argument_forbidden");
});
