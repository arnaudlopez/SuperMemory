import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { HINDSIGHT_NATIVE_ACCEPTANCE, verifyHindsightNativePlane } from "../scripts/verify-hindsight-native-plane.mjs";

test("the executable Hindsight-native matrix covers exactly HN-AC01 through HN-AC24", () => {
  const expected = Array.from({ length: 24 }, (_, index) => `HN-AC${String(index + 1).padStart(2, "0")}`);
  assert.deepEqual(Object.keys(HINDSIGHT_NATIVE_ACCEPTANCE).sort(), expected.sort());
  assert.equal(verifyHindsightNativePlane().status, "pass");
});

test("runtime source contains no removed Graphiti or improved call", () => {
  const targets = [
    "scripts/lib/graphd-http-backend.mjs",
    "scripts/lib/knowledge-graph-adapter.mjs",
    "scripts/supermemoryd.mjs",
    "services/supermemory-graphd/server.mjs",
    "deploy/portainer/supermemory-ai-stack.yml"
  ];
  const content = targets.map((target) => fs.readFileSync(path.resolve(target), "utf8")).join("\n");
  assert.doesNotMatch(content, /GRAPHITI_URL|IMPROVED_URL|\/v1\/improve\//);
  assert.equal(fs.existsSync("services/supermemory-improved/server.mjs"), false);
  assert.equal(fs.existsSync("services/supermemory-improved/package.json"), false);
  assert.equal(fs.existsSync("scripts/lib/memory-improve-worker.mjs"), false);
});
