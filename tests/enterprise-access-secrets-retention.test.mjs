import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/verify-enterprise-access-secrets-retention.mjs"], {
  encoding: "utf8"
});

assert.equal(
  result.status,
  0,
  `verify-enterprise-access-secrets-retention should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
);
