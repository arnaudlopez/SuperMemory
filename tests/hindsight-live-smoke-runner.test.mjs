import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/verify-hindsight-live-smoke-runner.mjs"], {
  encoding: "utf8",
  env: {
    ...process.env,
    HINDSIGHT_API_KEY: "",
    HINDSIGHT_BANK_ID: "",
    HINDSIGHT_BASE_URL: "",
    SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: ""
  }
});

assert.equal(
  result.status,
  0,
  `verify-hindsight-live-smoke-runner should pass\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
);
