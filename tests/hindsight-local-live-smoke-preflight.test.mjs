import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runPreflight(env = {}) {
  return spawnSync("node", ["scripts/hindsight-local-live-smoke-preflight.mjs", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "",
      HINDSIGHT_BANK_ID: "",
      HINDSIGHT_BASE_URL: "",
      SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: "",
      ...env
    }
  });
}

function parseJson(result) {
  assert.equal(result.status, 0, `preflight failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const blocked = parseJson(runPreflight());
assert.equal(["ready", "blocked"].includes(blocked.status), true);
assert.equal(blocked.mode, "local-live-preflight");
assert.equal(blocked.live_writes_performed, false);
assert.equal(blocked.network_writes, false);
assert.equal(blocked.default_base_url, "http://127.0.0.1:8888");
assert.equal(blocked.cloud_fallback_allowed, false);
assert.equal(blocked.env.HINDSIGHT_API_KEY, "not_set");
assert.equal(blocked.env.HINDSIGHT_BANK_ID, "not_set");
assert.equal(blocked.env.HINDSIGHT_BASE_URL, "not_set");
assert.equal(blocked.env.SUPERMEMORY_ALLOW_LIVE_HINDSIGHT, "not_set");
assert.ok(Array.isArray(blocked.blockers));
assert.ok(blocked.blockers.some((blocker) => blocker.code === "missing_live_env"));
assert.ok(blocked.live_command.includes("HINDSIGHT_BASE_URL=http://127.0.0.1:8888"));
assert.ok(blocked.live_command.includes("node scripts/hindsight-live-smoke-runner.mjs --execute-live --json"));
assert.equal(JSON.stringify(blocked).includes("api.hindsight.vectorize.io"), false);
assert.equal(JSON.stringify(blocked).includes("sk-test-secret"), false);

const readyEnv = parseJson(runPreflight({
  HINDSIGHT_API_KEY: "sk-test-secret",
  HINDSIGHT_BANK_ID: "bank-local-smoke",
  HINDSIGHT_BASE_URL: "http://127.0.0.1:8888",
  SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: "1"
}));
assert.equal(readyEnv.env.HINDSIGHT_API_KEY, "set");
assert.equal(readyEnv.env.HINDSIGHT_BANK_ID, "set");
assert.equal(readyEnv.env.HINDSIGHT_BASE_URL, "set");
assert.equal(readyEnv.env.SUPERMEMORY_ALLOW_LIVE_HINDSIGHT, "set");
assert.equal(JSON.stringify(readyEnv).includes("sk-test-secret"), false);
assert.equal(readyEnv.endpoint.base_url, "http://127.0.0.1:8888");
assert.equal(readyEnv.endpoint.is_local, true);
assert.equal(readyEnv.live_writes_performed, false);
assert.equal(readyEnv.network_writes, false);
