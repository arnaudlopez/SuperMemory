import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/verify-m1-hindsight-promotion-recall-fixture.mjs"], {
  encoding: "utf8"
});

assert.equal(
  result.status,
  0,
  `verify-m1-hindsight-promotion-recall-fixture should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
);
