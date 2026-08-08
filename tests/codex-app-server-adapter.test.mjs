import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CODEX_APP_SERVER_PROFILE_0_125,
  createCodexAppServerAdapter
} from "../scripts/lib/codex-app-server-adapter.mjs";
import { createCodexCaptureStore } from "../scripts/lib/codex-capture-store.mjs";
import {
  computeLogicalEventId,
  createEventEquivalenceStore
} from "../scripts/lib/codex-event-equivalence.mjs";
import { createProjectRegistry } from "../scripts/lib/project-registry.mjs";
import { createTurnSnapshotStore } from "../scripts/lib/codex-turn-snapshot.mjs";

const KEY = Buffer.alloc(32, 0x55);
const BINDING = {
  projectId: "prj_018f1234-5678-7abc-8def-0123456789ab",
  workspaceId: "ws_018f1234-5678-7abc-8def-0123456789ac",
  checkoutId: "co_018f1234-5678-7abc-8def-0123456789ad"
};
const wrapperScript = path.resolve("scripts/supermemory-app-server.mjs");
const fakeAppServer = path.resolve("tests/fixtures/codex-app-server/fake-app-server.mjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "app-server-adapter-"));
  const vault = path.join(root, "vault");
  const project = path.join(root, "project");
  fs.mkdirSync(vault);
  fs.mkdirSync(project);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault, project };
}

function components(vault) {
  const captureStore = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const equivalenceStore = createEventEquivalenceStore({ vaultRoot: vault });
  const snapshotStore = createTurnSnapshotStore({
    vaultRoot: vault,
    fingerprintKey: KEY
  });
  const adapter = createCodexAppServerAdapter({
    binding: BINDING,
    capture: (event) => captureStore.ingest(event),
    equivalenceStore,
    snapshotStore,
    clock: () => "2026-07-24T15:00:00.000Z"
  });
  return { captureStore, equivalenceStore, snapshotStore, adapter };
}

test("installed Codex profile is explicit and incompatible profiles fail closed", (t) => {
  const { vault } = fixture(t);
  assert.equal(CODEX_APP_SERVER_PROFILE_0_125.codexVersion, "codex-cli 0.125.0");
  assert.equal(CODEX_APP_SERVER_PROFILE_0_125.authoritativeNotification, "item/completed");
  const { captureStore, equivalenceStore, snapshotStore } = components(vault);
  assert.throws(() => createCodexAppServerAdapter({
    binding: BINDING,
    capture: (event) => captureStore.ingest(event),
    equivalenceStore,
    snapshotStore,
    schemaProfile: {
      schema: "supermemory.codex-app-server-profile.v1",
      protocol: "future",
      authoritativeNotification: "item/delta",
      supportedItemTypes: []
    }
  }), /app_server_schema_incompatible/);
});

test("deltas are ephemeral and item/completed is authoritative exactly once", async (t) => {
  const { vault } = fixture(t);
  const { adapter, captureStore, equivalenceStore } = components(vault);
  await adapter.handle({
    method: "thread/started",
    params: { thread: { id: "thr_authoritative" } }
  });
  await adapter.handle({
    method: "turn/started",
    params: { threadId: "thr_authoritative", turn: { id: "turn_authoritative" } }
  });
  const delta = await adapter.handle({
    method: "item/agentMessage/delta",
    params: { threadId: "thr_authoritative", turnId: "turn_authoritative", delta: "partial" }
  });
  assert.equal(delta.status, "telemetry_ignored");
  assert.equal(captureStore.stats().events, 0);

  const message = {
    method: "item/completed",
    params: {
      threadId: "thr_authoritative",
      turnId: "turn_authoritative",
      item: { id: "item_agent_1", type: "agentMessage", text: "Final visible answer" }
    }
  };
  const first = await adapter.handle(message);
  const replay = await adapter.handle(message);
  assert.equal(first.authoritative, true);
  assert.equal(first.appliesEffect, true);
  assert.equal(replay.eventId, first.eventId);
  assert.equal(captureStore.stats().events, 1);
  assert.equal(equivalenceStore.snapshot().logicalEvents[0].observations.length, 1);
});

test("internal reasoning is ignored while visible summary and unknown items are explicit", async (t) => {
  const { vault } = fixture(t);
  const { adapter, captureStore } = components(vault);
  await adapter.handle({
    method: "thread/started",
    params: { thread: { id: "thr_reasoning" } }
  });
  await adapter.handle({
    method: "turn/started",
    params: { threadId: "thr_reasoning", turn: { id: "turn_reasoning" } }
  });
  const hidden = await adapter.handle({
    method: "item/completed",
    params: {
      threadId: "thr_reasoning",
      turnId: "turn_reasoning",
      item: { id: "reasoning_hidden", type: "reasoning", content: "private chain" }
    }
  });
  assert.equal(hidden.status, "reasoning_internal_ignored");
  assert.equal(captureStore.stats().events, 0);

  const visible = await adapter.handle({
    method: "item/completed",
    params: {
      threadId: "thr_reasoning",
      turnId: "turn_reasoning",
      item: {
        id: "reasoning_summary",
        type: "reasoning",
        summary: "Visible reasoning summary",
        content: "must not persist"
      }
    }
  });
  assert.equal(visible.status, "item_captured");
  const payload = captureStore.readEvents({
    workspaceId: BINDING.workspaceId,
    includePayload: true
  })[0].payload;
  assert.equal(payload.visible_summary, "Visible reasoning summary");
  assert.equal(JSON.stringify(payload).includes("must not persist"), false);

  const unknown = await adapter.handle({
    method: "item/completed",
    params: {
      threadId: "thr_reasoning",
      turnId: "turn_reasoning",
      item: { id: "future_item", type: "futureUnknown", opaque: true }
    }
  });
  assert.equal(unknown.status, "capture_gap");
  assert.equal(unknown.coverage, "partial");
});

test("App Server and hook observations share one logical effect without time heuristics", (t) => {
  const { vault } = fixture(t);
  const store = createEventEquivalenceStore({ vaultRoot: vault });
  store.bindSession({
    workspaceId: BINDING.workspaceId,
    sessionId: "thr_equivalent",
    captureMode: "app_server_primary",
    primaryAdapter: "app_server",
    shadowAdapter: "hook"
  });
  const fields = {
    workspaceId: BINDING.workspaceId,
    sessionId: "thr_equivalent",
    canonicalTurnId: "turn_equivalent",
    eventSlot: "assistant.final",
    normalizedPayloadHash: `sha256:${"a".repeat(64)}`
  };
  const app = store.recordObservation({
    ...fields,
    eventId: `evt_${"1".repeat(64)}`,
    adapter: "app_server",
    sequence: 3
  });
  const hook = store.recordObservation({
    ...fields,
    eventId: `evt_${"2".repeat(64)}`,
    adapter: "hook",
    sequence: 3
  });
  assert.equal(app.logicalEventId, hook.logicalEventId);
  assert.equal(app.appliesEffect, true);
  assert.equal(hook.appliesEffect, false);
  const logical = store.snapshot().logicalEvents[0];
  assert.equal(logical.observations.length, 2);
  assert.equal(logical.appliedEventId, `evt_${"1".repeat(64)}`);
  assert.equal(computeLogicalEventId({
    workspaceId: BINDING.workspaceId,
    canonicalSessionId: "thr_equivalent",
    canonicalTurnId: "turn_equivalent",
    eventSlot: "assistant.final",
    normalizedPayloadHash: `sha256:${"a".repeat(64)}`
  }), app.logicalEventId);
});

test("hook failover requires a confirmed primary gap and promotes only post-checkpoint shadow", (t) => {
  const { vault } = fixture(t);
  const store = createEventEquivalenceStore({ vaultRoot: vault });
  store.bindSession({
    workspaceId: BINDING.workspaceId,
    sessionId: "thr_failover",
    captureMode: "app_server_primary",
    primaryAdapter: "app_server",
    shadowAdapter: "hook"
  });
  store.checkpointPrimary({
    workspaceId: BINDING.workspaceId,
    sessionId: "thr_failover",
    sequence: 5
  });
  const observation = (sequence, digit) => store.recordObservation({
    workspaceId: BINDING.workspaceId,
    sessionId: "thr_failover",
    canonicalTurnId: "turn_failover",
    eventSlot: `tool.${sequence}.completed`,
    normalizedPayloadHash: `sha256:${digit.repeat(64)}`,
    eventId: `evt_${digit.repeat(64)}`,
    adapter: "hook",
    sequence
  });
  observation(4, "3");
  observation(6, "4");
  assert.throws(() => store.confirmPrimaryFailure({
    workspaceId: BINDING.workspaceId,
    sessionId: "thr_failover",
    lastPrimarySequence: 5,
    confirmedGap: false
  }), /primary_gap_confirmation_required/);
  const failover = store.confirmPrimaryFailure({
    workspaceId: BINDING.workspaceId,
    sessionId: "thr_failover",
    lastPrimarySequence: 5,
    confirmedGap: true
  });
  assert.equal(failover.coverage, "partial");
  assert.deepEqual(failover.promotedEventIds, [`evt_${"4".repeat(64)}`]);
  const snapshot = store.snapshot();
  assert.equal(snapshot.logicalEvents.find((item) => (
    item.observations[0].sequence === 4
  )).appliedEventId, null);
  assert.equal(snapshot.logicalEvents.find((item) => (
    item.observations[0].sequence === 6
  )).appliedEventId, `evt_${"4".repeat(64)}`);
});

test("turn and file snapshots are content-addressed, path-safe and replay-stable", (t) => {
  const { vault } = fixture(t);
  const snapshots = createTurnSnapshotStore({ vaultRoot: vault, fingerprintKey: KEY });
  const file = snapshots.createFileSnapshot({
    workspaceId: BINDING.workspaceId,
    turnId: "turn_snapshot",
    itemId: "file-item:0",
    filePath: "/Users/alice/Clients/Acme/private.txt",
    beforeHash: null,
    afterHash: `sha256:${"b".repeat(64)}`
  });
  const replayFile = snapshots.createFileSnapshot({
    workspaceId: BINDING.workspaceId,
    turnId: "turn_snapshot",
    itemId: "file-item:0",
    filePath: "/Users/alice/Clients/Acme/private.txt",
    beforeHash: null,
    afterHash: `sha256:${"b".repeat(64)}`
  });
  assert.equal(file.snapshotId, replayFile.snapshotId);
  assert.equal(replayFile.created, false);
  assert.equal(fs.readFileSync(file.path, "utf8").includes("/Users/alice"), false);

  const input = {
    workspaceId: BINDING.workspaceId,
    turnId: "turn_snapshot",
    eventIds: [`evt_${"c".repeat(64)}`],
    fileSnapshotIds: [file.snapshotId],
    completion: "complete",
    completedAt: "2026-07-24T15:00:00.000Z"
  };
  const turn = snapshots.createTurnSnapshot(input);
  const replay = snapshots.createTurnSnapshot(input);
  assert.equal(turn.turnSnapshotId, replay.turnSnapshotId);
  assert.equal(replay.created, false);
  assert.equal(snapshots.readTurnSnapshot(turn.turnSnapshotId).manifest_hash, turn.manifestHash);
});

test("strong rename preserves source identity while ambiguous copies stay distinct and changes invalidate", (t) => {
  const { vault } = fixture(t);
  const snapshots = createTurnSnapshotStore({ vaultRoot: vault, fingerprintKey: KEY });
  const original = snapshots.createFileSnapshot({
    workspaceId: BINDING.workspaceId,
    turnId: "turn_source_1",
    itemId: "file:1",
    filePath: "/workspace/project/old-name.md",
    afterHash: `sha256:${"1".repeat(64)}`
  });
  const renamed = snapshots.createFileSnapshot({
    workspaceId: BINDING.workspaceId,
    turnId: "turn_source_2",
    itemId: "file:2",
    filePath: "/workspace/project/new-name.md",
    renamedFromPath: "/workspace/project/old-name.md",
    beforeHash: `sha256:${"1".repeat(64)}`,
    afterHash: `sha256:${"1".repeat(64)}`
  });
  assert.equal(renamed.sourceId, original.sourceId);
  assert.equal(renamed.continuity, "renamed_strong");
  assert.deepEqual(renamed.invalidatedSnapshotIds, []);

  const ambiguous = snapshots.createFileSnapshot({
    workspaceId: BINDING.workspaceId,
    turnId: "turn_source_3",
    itemId: "file:3",
    filePath: "/workspace/project/copy.md",
    afterHash: `sha256:${"1".repeat(64)}`
  });
  assert.notEqual(ambiguous.sourceId, original.sourceId);
  assert.equal(ambiguous.continuity, "review_required");

  const changed = snapshots.createFileSnapshot({
    workspaceId: BINDING.workspaceId,
    turnId: "turn_source_4",
    itemId: "file:4",
    filePath: "/workspace/project/new-name.md",
    beforeHash: `sha256:${"1".repeat(64)}`,
    afterHash: `sha256:${"2".repeat(64)}`
  });
  assert.equal(changed.sourceId, original.sourceId);
  assert.deepEqual(changed.invalidatedSnapshotIds, [renamed.snapshotId]);
});

test("adapter creates a partial immutable turn snapshot when an unknown item appears", async (t) => {
  const { vault } = fixture(t);
  const { adapter, snapshotStore } = components(vault);
  await adapter.handle({
    method: "thread/started",
    params: { thread: { id: "thr_snapshot" } }
  });
  await adapter.handle({
    method: "turn/started",
    params: { threadId: "thr_snapshot", turn: { id: "turn_snapshot" } }
  });
  await adapter.handle({
    method: "item/completed",
    params: {
      threadId: "thr_snapshot",
      turnId: "turn_snapshot",
      item: {
        id: "file_change",
        type: "fileChange",
        changes: [{
          path: "/workspace/project/src/app.js",
          afterHash: `sha256:${"d".repeat(64)}`
        }]
      }
    }
  });
  await adapter.handle({
    method: "item/completed",
    params: {
      threadId: "thr_snapshot",
      turnId: "turn_snapshot",
      item: { id: "unknown", type: "notInProfile" }
    }
  });
  const complete = await adapter.handle({
    method: "turn/completed",
    params: {
      threadId: "thr_snapshot",
      turn: { id: "turn_snapshot", status: "completed" }
    }
  });
  assert.equal(complete.status, "turn_snapshotted");
  assert.equal(complete.coverage, "partial");
  assert.equal(snapshotStore.readTurnSnapshot(complete.turnSnapshotId).completion, "partial");
  const replay = await adapter.handle({
    method: "turn/completed",
    params: {
      threadId: "thr_snapshot",
      turn: { id: "turn_snapshot", status: "completed" }
    }
  });
  assert.equal(replay.turnSnapshotId, complete.turnSnapshotId);
  assert.equal(replay.replayed, true);
});

test("stdio wrapper forwards App Server JSONL unchanged and captures in an isolated vault", (t) => {
  const { root, vault, project } = fixture(t);
  const binding = createProjectRegistry({ vaultRoot: vault }).initProject({ projectRoot: project });
  const keyFile = path.join(root, "capture.key");
  const configFile = path.join(root, "app-server-runtime.json");
  fs.writeFileSync(keyFile, KEY, { mode: 0o600 });
  fs.writeFileSync(configFile, `${JSON.stringify({
    schema: "supermemory.app-server-runtime.v1",
    vault_root: vault,
    project_root: project,
    key_file: keyFile,
    codex_command: process.execPath
  })}\n`, { mode: 0o600 });
  const result = spawnSync(process.execPath, [
    wrapperScript,
    "--config",
    configFile,
    "--",
    fakeAppServer
  ], {
    cwd: project,
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, CODEX_HOME: path.join(root, "isolated-codex-home") }
  });
  assert.equal(result.status, 0, result.stderr);
  const expected = spawnSync(process.execPath, [fakeAppServer], { encoding: "utf8" });
  assert.equal(result.stdout, expected.stdout);
  const captured = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  assert.equal(captured.stats().events, 2);
  const snapshotFiles = [];
  const turnsRoot = path.join(vault, "00_inbox", "snapshots", "turns");
  for (const prefix of fs.readdirSync(turnsRoot)) {
    snapshotFiles.push(...fs.readdirSync(path.join(turnsRoot, prefix)));
  }
  assert.equal(snapshotFiles.length, 1);
  assert.match(binding.workspaceId, /^ws_/);
});
