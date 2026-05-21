import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/verify-source-change-t0-t1.mjs"], {
  encoding: "utf8"
});

assert.equal(
  result.status,
  0,
  `verify-source-change-t0-t1 should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
);
