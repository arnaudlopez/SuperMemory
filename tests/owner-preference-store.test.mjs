import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOwnerPreferenceStore } from "../scripts/lib/owner-preference-store.mjs";

test("owner preferences require explicit governed promotion and return owner citations", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-owner-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const store = createOwnerPreferenceStore({
    vaultRoot: vault,
    encryptionKey: Buffer.alloc(32, 4),
    ownerScope: {
      workspaceId: "ws_018f7c0e-7b7d-7abc-8def-0123456789aa",
      projectId: "prj_018f7c0e-7b7d-7abc-8def-0123456789ab"
    }
  });
  assert.throws(() => store.promote({
    title: "Style",
    text: "Répondre en français",
    category: "personal_preference",
    evidenceIds: ["wev_1"]
  }), /owner_promotion_invalid/);
  store.promote({
    title: "Style",
    text: "Répondre en français",
    category: "personal_preference",
    sourceProjectId: "prj_source",
    evidenceIds: ["wev_1"],
    confirmation: "PROMOTE OWNER"
  });
  const recalled = await store.search({ query: "français", limit: 5 });
  assert.equal(recalled.results.length, 1);
  assert.equal(recalled.results[0].citations[0].scope, "owner");
});
