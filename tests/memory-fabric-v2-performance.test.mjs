import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexCaptureStore } from "../scripts/lib/codex-capture-store.mjs";
import { createCodexWorkingOffload } from "../scripts/lib/codex-working-offload.mjs";
import { createCodexWorkingRecall } from "../scripts/lib/codex-working-recall.mjs";

const FIXTURE = JSON.parse(fs.readFileSync(
  "tests/fixtures/memory-fabric-v2/long-task.v1.json",
  "utf8"
));
const KEY = Buffer.alloc(32, 0x68);
const WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789ac";
const PROJECT = "prj_018f1234-5678-7abc-8def-0123456789ab";
const NOW = "2026-08-08T12:00:00.000Z";

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function timed(operation) {
  const started = performance.now();
  const result = operation();
  return { result, duration: performance.now() - started };
}

test("100K long-task guard meets local deterministic SLOs and offload reduces visible tokens without success loss", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-fabric-v2-performance-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createCodexCaptureStore({
    vaultRoot: vault,
    encryptionKey: KEY,
    clock: () => NOW,
    workingMemory: { enabled: true, capacityTokens: FIXTURE.working_set.capacity_tokens }
  });
  const eventTypes = ["prompt.submitted", "tool.completed", "file.changed", "assistant.completed"];
  const captureDurations = [];
  let lastCapture;
  for (let index = 1; index <= FIXTURE.working_set.regular_events; index += 1) {
    const measured = timed(() => store.ingest({
      adapter: "hook",
      adapter_version: "1.0.0",
      external_event_id: `long-task-${index}`,
      project_id: PROJECT,
      workspace_id: WORKSPACE,
      checkout_id: "co_018f1234-5678-7abc-8def-0123456789ad",
      session_id: "ses_hook:long-task-performance",
      thread_id: "long-task-performance",
      turn_id: `turn_long-task:${index}`,
      item_id: `item-long-task-${index}`,
      event_type: eventTypes[(index - 1) % eventTypes.length],
      occurred_at: NOW,
      capture_level: "standard",
      sequence: index,
      payload: { marker: "needle-memory-fabric", output: String(index).padStart(2, "0") + "x".repeat(FIXTURE.working_set.regular_payload_chars) }
    }));
    captureDurations.push(measured.duration);
    lastCapture = measured.result;
  }
  const largeSequence = FIXTURE.working_set.regular_events + 1;
  const largePayload = {
    marker: "needle-memory-fabric",
    expected_result: "deployment-ready",
    output: "L".repeat(FIXTURE.working_set.large_payload_chars)
  };
  const largeMeasured = timed(() => store.ingest({
    adapter: "hook",
    adapter_version: "1.0.0",
    external_event_id: "long-task-large-output",
    project_id: PROJECT,
    workspace_id: WORKSPACE,
    checkout_id: "co_018f1234-5678-7abc-8def-0123456789ad",
    session_id: "ses_hook:long-task-performance",
    thread_id: "long-task-performance",
    turn_id: `turn_long-task:${largeSequence}`,
    item_id: "item-long-task-large",
    event_type: "tool.completed",
    occurred_at: NOW,
    capture_level: "standard",
    sequence: largeSequence,
    payload: largePayload
  }));
  captureDurations.push(largeMeasured.duration);
  lastCapture = largeMeasured.result;

  const state = store.workingStore.resolveWorkingSet({
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    workingSetId: lastCapture.working.working_set_id
  });
  assert.ok(state.manifest.selected_tokens >= FIXTURE.working_set.minimum_selected_tokens);
  assert.ok(state.manifest.selected_tokens <= FIXTURE.working_set.capacity_tokens);
  const largeEntry = state.entries.find((entry) => entry.evidence_id === lastCapture.working.evidence_id);
  assert.equal(largeEntry.status, "selected");

  const recall = createCodexWorkingRecall({
    workingStore: store.workingStore,
    captureStore: store,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    clock: () => NOW
  });
  const searchDurations = [];
  for (let iteration = 0; iteration < 20; iteration += 1) {
    searchDurations.push(timed(() => recall.search({
      working_set_id: lastCapture.working.working_set_id,
      query: "needle memory fabric",
      limit: 20
    })).duration);
  }
  const openDurations = [];
  let reopened;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const measured = timed(() => recall.open({
      working_set_id: lastCapture.working.working_set_id,
      evidence_id: lastCapture.working.evidence_id,
      max_tokens: 20_000
    }));
    openDurations.push(measured.duration);
    reopened = measured.result;
  }
  const mapDurations = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    mapDurations.push(timed(() => recall.map({
      working_set_id: lastCapture.working.working_set_id
    })).duration);
  }

  const metrics = {
    capture_p95: percentile95(captureDurations),
    search_100k_p95: percentile95(searchDurations),
    open_20k_p95: percentile95(openDurations),
    map_p95: percentile95(mapDurations)
  };
  for (const [metric, maximum] of Object.entries(FIXTURE.slo_ms)) {
    assert.ok(metrics[metric] <= maximum, `${metric}=${metrics[metric].toFixed(2)}ms > ${maximum}ms`);
  }
  assert.equal(reopened.complete, true);
  assert.equal(reopened.content_hash, largeEntry.content_hash);

  const offload = createCodexWorkingOffload({
    enabled: true,
    replacementSupported: true,
    thresholdTokens: FIXTURE.offload.threshold_tokens,
    allowedTools: ["Bash"]
  }).evaluate({ ...lastCapture.working, status: largeEntry.status, tool_name: "Bash" });
  assert.equal(offload.replacement_enabled, true);
  const originalVisibleTokens = lastCapture.working.token_estimate;
  const replacementVisibleTokens = Math.ceil(Buffer.byteLength(offload.replacement_text) / 4);
  const reduction = 1 - replacementVisibleTokens / originalVisibleTokens;
  assert.ok(reduction >= FIXTURE.offload.minimum_visible_token_reduction);

  const reopenedPayload = reopened.content;
  const baselineSuccess = largePayload.expected_result === "deployment-ready" ? 100 : 0;
  const offloadSuccess = JSON.parse(reopenedPayload).expected_result === "deployment-ready" &&
    reopened.content_hash === largeEntry.content_hash ? 100 : 0;
  assert.ok(baselineSuccess - offloadSuccess <= FIXTURE.offload.maximum_success_regression_points);
  assert.equal(offloadSuccess, 100);
});
