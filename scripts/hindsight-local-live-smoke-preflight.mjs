#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";

const defaultBaseUrl = "http://127.0.0.1:8888";
const containerName = "supermemory-hindsight-local";
const requiredEnv = [
  "HINDSIGHT_API_KEY",
  "HINDSIGHT_BANK_ID",
  "HINDSIGHT_BASE_URL",
  "SUPERMEMORY_ALLOW_LIVE_HINDSIGHT"
];

function parseArgs(argv) {
  const options = { json: false };
  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function trimSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function envStatus(env = process.env) {
  return Object.fromEntries(requiredEnv.map((key) => [key, env[key] ? "set" : "not_set"]));
}

function missingLiveEnv(env = process.env) {
  const missing = [];
  if (!env.HINDSIGHT_API_KEY) missing.push("HINDSIGHT_API_KEY");
  if (!env.HINDSIGHT_BANK_ID) missing.push("HINDSIGHT_BANK_ID");
  if (!env.HINDSIGHT_BASE_URL) missing.push("HINDSIGHT_BASE_URL");
  if (env.SUPERMEMORY_ALLOW_LIVE_HINDSIGHT !== "1") missing.push("SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1");
  return missing;
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 5000
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    error: result.error?.message
  };
}

function isLocalUrl(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

function healthUrl(baseUrl) {
  const url = new URL(trimSlash(baseUrl));
  url.pathname = `${url.pathname.replace(/\/$/, "")}/health`;
  return url;
}

function fetchHealth(baseUrl) {
  return new Promise((resolve) => {
    let url;
    try {
      url = healthUrl(baseUrl);
    } catch (error) {
      resolve({ ok: false, error: `invalid base URL: ${error.message}` });
      return;
    }

    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, { timeout: 3000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        let parsedBody = null;
        try {
          parsedBody = body ? JSON.parse(body) : null;
        } catch {
          parsedBody = body.slice(0, 500);
        }
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          body: parsedBody
        });
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("health check timed out"));
    });
    request.on("error", (error) => {
      resolve({ ok: false, error: error.message });
    });
  });
}

function normalizeBinding(containerPort, item) {
  const hostIp = item?.HostIp ?? "";
  return {
    container_port: containerPort,
    host_ip: hostIp,
    host_port: item?.HostPort ?? "",
    localhost_only: ["127.0.0.1", "::1"].includes(hostIp)
  };
}

function inspectContainer() {
  const docker = run("docker", ["--version"]);
  const compose = run("docker", ["compose", "version"]);
  const report = {
    available: docker.ok,
    version: docker.ok ? docker.stdout : undefined,
    compose_available: compose.ok,
    compose_version: compose.ok ? compose.stdout : undefined,
    container: containerName,
    container_running: false,
    port_bindings: [],
    localhost_only: false
  };

  if (!docker.ok) {
    report.error = docker.error || docker.stderr || "docker is unavailable";
    return report;
  }

  const inspect = run("docker", ["inspect", containerName, "--format", "{{json .}}"]);
  if (!inspect.ok) {
    report.error = inspect.error || inspect.stderr || `container ${containerName} is unavailable`;
    return report;
  }

  let data;
  try {
    data = JSON.parse(inspect.stdout);
  } catch (error) {
    report.error = `could not parse docker inspect output: ${error.message}`;
    return report;
  }

  report.container_running = data.State?.Running === true;
  const bindings = data.HostConfig?.PortBindings ?? {};
  report.port_bindings = Object.entries(bindings).flatMap(([containerPort, items]) =>
    (items ?? []).map((item) => normalizeBinding(containerPort, item))
  );
  report.localhost_only = report.port_bindings.length > 0 && report.port_bindings.every((item) => item.localhost_only);
  return report;
}

function buildLiveCommand(baseUrl) {
  return [
    "HINDSIGHT_API_KEY=<set>",
    "HINDSIGHT_BANK_ID=<set>",
    `HINDSIGHT_BASE_URL=${baseUrl}`,
    "SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1",
    "node scripts/hindsight-live-smoke-runner.mjs --execute-live --json"
  ].join(" ");
}

async function buildReport() {
  const baseUrl = trimSlash(process.env.HINDSIGHT_BASE_URL || defaultBaseUrl);
  const endpoint = {
    base_url: baseUrl,
    is_local: isLocalUrl(baseUrl),
    health: await fetchHealth(baseUrl)
  };
  const docker = inspectContainer();
  const blockers = [];
  const missing = missingLiveEnv();

  if (missing.length > 0) {
    blockers.push({ code: "missing_live_env", missing });
  }
  if (!endpoint.is_local) {
    blockers.push({ code: "hindsight_endpoint_not_local", base_url: baseUrl });
  }
  if (!endpoint.health.ok) {
    blockers.push({ code: "hindsight_health_unreachable", health: endpoint.health });
  }
  if (!docker.available) {
    blockers.push({ code: "docker_unavailable", detail: docker.error });
  } else if (!docker.compose_available) {
    blockers.push({ code: "docker_compose_unavailable" });
  } else if (!docker.container_running) {
    blockers.push({ code: "hindsight_container_not_running", container: containerName, detail: docker.error });
  } else if (!docker.localhost_only) {
    blockers.push({
      code: "hindsight_container_not_localhost_bound",
      container: containerName,
      port_bindings: docker.port_bindings
    });
  }

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    generated_at: new Date().toISOString(),
    mode: "local-live-preflight",
    live_writes_performed: false,
    network_writes: false,
    cloud_fallback_allowed: false,
    default_base_url: defaultBaseUrl,
    env: envStatus(),
    endpoint,
    docker,
    blockers,
    live_command: buildLiveCommand(baseUrl)
  };
}

function printText(report) {
  process.stdout.write(`status=${report.status} mode=${report.mode} endpoint=${report.endpoint.base_url}\n`);
  process.stdout.write(`live_writes_performed=${report.live_writes_performed} network_writes=${report.network_writes}\n`);
  for (const blocker of report.blockers) {
    process.stdout.write(`blocker=${blocker.code}\n`);
  }
  process.stdout.write(`${report.live_command}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildReport();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printText(report);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
