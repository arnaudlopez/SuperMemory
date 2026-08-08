import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMemoryExceptionStore } from "../scripts/lib/memory-exception-store.mjs";

const KEY = Buffer.alloc(32, 6);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exception-store-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = Date.parse("2026-08-08T10:00:00Z");
  return {
    store: createMemoryExceptionStore({
      vaultRoot: vault, encryptionKey: KEY, workspaceId: "ws", projectId: "prj",
      visibleMinAgeMs: 1000, clock: () => new Date(now).toISOString()
    }),
    advance: (ms) => { now += ms; }
  };
}

test("QA-AC06/07: exceptions deduplicate and remain latent until persistent", (t) => {
  const { store, advance } = fixture(t);
  const first = store.upsert({ topicId: "topic-a", claimIds: ["a", "b"], reasonCodes: ["active_conflict"] });
  const second = store.upsert({ topicId: "topic-a", claimIds: ["b", "a"], reasonCodes: ["active_conflict"] });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(second.evaluation_count, 2);
  assert.equal(store.query({ topicId: "topic-a" }).length, 0);
  advance(1001);
  const visible = store.reevaluate({ fingerprint: first.fingerprint, context: { real_value: true } });
  assert.equal(visible.level, "visible");
  assert.equal(store.query({ topicId: "topic-a" }).length, 1);
});

test("QA-AC08/09/10: blocking requires every action-boundary gate", (t) => {
  const { store } = fixture(t);
  const exception = store.upsert({
    topicId: "topic-a", claimIds: ["a", "b"], reasonCodes: ["permission_conflict"],
    impact: "high", irreversibility: "permission"
  });
  const notBlocking = store.reevaluate({ fingerprint: exception.fingerprint, context: {
    plausible_states: 2, operation_waiting: true, impact: "high", irreversibility: "permission",
    conservative_fallback_available: true
  } });
  assert.notEqual(notBlocking.level, "blocking");
  const blocking = store.reevaluate({ fingerprint: exception.fingerprint, context: {
    plausible_states: 2, operation_waiting: true, impact: "high", irreversibility: "permission",
    conservative_fallback_available: false, owner_directive_available: false, rule_available: false
  } });
  assert.equal(blocking.level, "blocking");
});

test("QA-AC11/15: automatic and owner resolutions carry audit receipts", (t) => {
  const { store } = fixture(t);
  const automatic = store.upsert({ topicId: "topic-a", claimIds: ["a", "b"], reasonCodes: ["active_conflict"] });
  const resolved = store.reevaluate({ fingerprint: automatic.fingerprint, resolved: true, resolution: { reason: "fresh_primary_source" } });
  assert.equal(resolved.status, "resolved");
  assert.match(resolved.resolution.receipt_id, /^xrc_/);
  const owner = store.upsert({ topicId: "topic-a", claimIds: ["c", "d"], reasonCodes: ["owner_choice"] });
  const ownerResolved = store.resolveOwner({ fingerprint: owner.fingerprint, decision: "prefer c" });
  assert.equal(ownerResolved.resolution.kind, "owner");
  assert.match(ownerResolved.resolution.receipt_id, /^xrc_/);
});
