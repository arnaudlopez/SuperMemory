import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/verify-source-refresh-connector-boundary.mjs"], {
  encoding: "utf8"
});

assert.equal(
  result.status,
  0,
  `verify-source-refresh-connector-boundary should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
);
