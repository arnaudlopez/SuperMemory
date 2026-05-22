import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/verify-enterprise-living-memory-partial.mjs"], {
  encoding: "utf8"
});

assert.equal(
  result.status,
  0,
  `verify-enterprise-living-memory-partial should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
);
