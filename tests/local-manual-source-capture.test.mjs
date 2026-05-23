import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/verify-local-manual-source-capture.mjs"], {
  encoding: "utf8"
});

assert.equal(
  result.status,
  0,
  `verify-local-manual-source-capture should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
);
