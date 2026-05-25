#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["--test", "tests/supermemory-onboard.test.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: {
    ...process.env,
    HINDSIGHT_API_KEY: "",
    HINDSIGHT_BANK_ID: "",
    HINDSIGHT_BASE_URL: "",
    SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: ""
  }
});

if (result.status !== 0) {
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 1;
} else {
  process.stdout.write("PASS supermemory-onboarding: client onboarding plan, staging, commit, and fail-closed guards are valid\n");
}
