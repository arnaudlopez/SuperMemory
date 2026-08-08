import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runPreflight() {
  return spawnSync("node", ["scripts/hindsight-local-live-smoke-preflight.mjs", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "",
      HINDSIGHT_BANK_ID: "",
      HINDSIGHT_BASE_URL: "",
      SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: ""
    }
  });
}

test("local Hindsight runtime is strict when present and explicit when unavailable", (t) => {
  const result = runPreflight();
  assert.equal(result.status, 0, `preflight failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);

  const report = JSON.parse(result.stdout);
  const blockerCodes = report.blockers.map((blocker) => blocker.code);
  assert.equal(report.mode, "local-live-preflight");
  assert.equal(report.live_writes_performed, false);
  assert.equal(report.network_writes, false);
  assert.equal(report.cloud_fallback_allowed, false);
  assert.equal(report.endpoint.base_url, "http://127.0.0.1:8888");
  assert.equal(report.endpoint.is_local, true);
  assert.equal(blockerCodes.includes("missing_live_env"), true);

  if (!report.endpoint.health.ok || !report.docker.container_running) {
    assert.equal(report.status, "blocked");
    assert.ok(
      blockerCodes.includes("hindsight_health_unreachable") ||
      blockerCodes.includes("hindsight_container_not_running")
    );
    t.skip("local Hindsight unavailable; preflight recorded explicit blockers without live writes");
    return;
  }

  assert.equal(report.endpoint.health.ok, true);
  assert.equal(report.docker.container_running, true);
  assert.equal(report.docker.localhost_only, true);
  assert.equal(blockerCodes.includes("hindsight_container_not_localhost_bound"), false);
  for (const binding of report.docker.port_bindings) {
    assert.equal(binding.localhost_only, true, `${binding.container_port} should be localhost-only`);
    assert.ok(["127.0.0.1", "::1"].includes(binding.host_ip), `${binding.container_port} host_ip should be local`);
  }
});
