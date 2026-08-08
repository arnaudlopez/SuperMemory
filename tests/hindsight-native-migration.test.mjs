import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHindsightNativeMigrator } from "../scripts/lib/hindsight-native-migration.mjs";

const WORKSPACE = "ws_018f7c0e-7b7d-7abc-8def-0123456789ab";

test("HN-AC22: fresh-volume migration reproduces GraphD hash and every active Hindsight memory", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-native-migration-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projected = [];
  let rebuilt = 0;
  const graphHash = `sha256:${"a".repeat(64)}`;
  const migrator = createHindsightNativeMigrator({
    vaultRoot: vault,
    encryptionKey: Buffer.alloc(32, 0x55),
    workspaceId: WORKSPACE,
    graphAdapter: {
      projectionHash: () => graphHash,
      rebuildProjectionAsync: async () => {
        rebuilt += 1;
        return { projected: true, projection_hash: graphHash };
      }
    },
    gateway: {
      ensureBankTemplate: async () => ({ status: "applied" }),
      project: async (memory) => {
        projected.push(memory.memory_id);
        return { operation_id: memory.memory_id.endsWith("1")
          ? "018f7c0e-7b7d-5abc-8def-0123456789a1"
          : "018f7c0e-7b7d-5abc-8def-0123456789a2" };
      },
      consolidate: async () => ({ operation_id: "018f7c0e-7b7d-5abc-8def-0123456789a3" })
    },
    activeMemorySource: () => [
      { workspace_id: WORKSPACE, memory_id: "mem_1", status: "active" },
      { workspace_id: WORKSPACE, memory_id: "mem_2", status: "active" },
      { workspace_id: WORKSPACE, memory_id: "mem_revoked", status: "revoked" }
    ],
    bankTemplate: { version: "1", bank: { enable_temporal_retrieval: true } },
    clock: () => "2026-08-08T12:00:00.000Z"
  });
  const plan = migrator.plan();
  assert.deepEqual(plan.memory_ids, ["mem_1", "mem_2"]);
  assert.equal(plan.immutable_vault_rewrite, false);
  await assert.rejects(migrator.execute({ planHash: `sha256:${"0".repeat(64)}` }), /hindsight_migration_plan_mismatch/);
  const receipt = await migrator.execute({ planHash: plan.plan_hash });
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.graph_projection_hash, graphHash);
  assert.equal(receipt.memories_projected, 2);
  assert.deepEqual(projected, ["mem_1", "mem_2"]);
  assert.equal(rebuilt, 1);
  const sealed = fs.readFileSync(path.join(migrator.root, "hindsight-native-v090.aead.json"), "utf8");
  assert.doesNotMatch(sealed, /mem_1|mem_2|complete/);
  const replay = await migrator.execute({ planHash: plan.plan_hash });
  assert.deepEqual(replay, receipt);
  assert.equal(rebuilt, 1);
});
