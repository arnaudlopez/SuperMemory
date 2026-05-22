import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/verify-review-queues-actions.mjs"], {
  encoding: "utf8"
});

assert.equal(
  result.status,
  0,
  `verify-review-queues-actions should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
);
