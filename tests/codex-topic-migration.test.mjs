import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateTopicContinuity } from "../scripts/lib/codex-topic-migration.mjs";
import { createCodexTopicStore } from "../scripts/lib/codex-topic-store.mjs";
import { createCodexWorkingSetStore } from "../scripts/lib/codex-working-set-store.mjs";

const WORKSPACE = "ws_018f1234-5678-7abc-8def-0123456789ac";
const PROJECT = "prj_018f1234-5678-7abc-8def-0123456789ab";

test("TC-AC14: migration creates one topic per root and groups only verified forks", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topic-migration-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workingStore = createCodexWorkingSetStore({ vaultRoot: vault, encryptionKey: Buffer.alloc(32, 0x42) });
  const topicStore = createCodexTopicStore({ vaultRoot: vault, encryptionKey: Buffer.alloc(32, 0x42) });
  const first = workingStore.ensure({ workspaceId: WORKSPACE, projectId: PROJECT, sessionId: "session-root-a" });
  const child = workingStore.ensure({
    workspaceId: WORKSPACE, projectId: PROJECT, sessionId: "session-fork-a",
    forkedFromWorkingSetId: first.manifest.working_set_id,
    forkedFromSessionId: first.manifest.session_id,
    forkIdentity: "verified-fork"
  });
  const second = workingStore.ensure({ workspaceId: WORKSPACE, projectId: PROJECT, sessionId: "session-root-b" });
  const migrated = migrateTopicContinuity({ workspaceId: WORKSPACE, projectId: PROJECT, workingStore, topicStore });
  assert.equal(migrated.created_roots, 2);
  assert.equal(migrated.inherited_forks, 1);
  const firstTopic = topicStore.getContext({ workspaceId: WORKSPACE, projectId: PROJECT, workingSetId: first.manifest.working_set_id });
  const childTopic = topicStore.getContext({ workspaceId: WORKSPACE, projectId: PROJECT, workingSetId: child.manifest.working_set_id });
  const secondTopic = topicStore.getContext({ workspaceId: WORKSPACE, projectId: PROJECT, workingSetId: second.manifest.working_set_id });
  assert.equal(firstTopic.topic.topic_id, childTopic.topic.topic_id);
  assert.notEqual(firstTopic.topic.topic_id, secondTopic.topic.topic_id);
  const repeated = migrateTopicContinuity({ workspaceId: WORKSPACE, projectId: PROJECT, workingStore, topicStore });
  assert.equal(repeated.unchanged, 3);
  assert.equal(repeated.created_roots, 0);
});
