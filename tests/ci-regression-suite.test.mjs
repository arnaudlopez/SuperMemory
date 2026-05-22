import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/verify-ci-regression-suite.mjs"], {
  encoding: "utf8"
});

assert.equal(
  result.status,
  0,
  `verify-ci-regression-suite should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
);
