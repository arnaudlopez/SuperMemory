#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const options = { json: false };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function loopbackHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function commandCheck(spawnSyncImpl, command, args, id) {
  const result = spawnSyncImpl(command, args, { encoding: "utf8" });
  return {
    id,
    ok: result.status === 0,
    detail: result.status === 0
      ? (result.stdout || "").trim().split(/\r?\n/)[0] || "available"
      : (result.stderr || result.stdout || `${command} unavailable`).trim().slice(0, 240)
  };
}

async function fetchJson(fetchImpl, url, timeoutMs = 3_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    return { ok: false, status: null, data: null, error: error?.name || "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDoctor({
  env = process.env,
  fetchImpl = globalThis.fetch,
  spawnSyncImpl = spawnSync,
  cwd = process.cwd(),
  nodeVersion = process.versions.node
} = {}) {
  const vaultRoot = path.resolve(cwd, env.SUPERMEMORY_VAULT_ROOT || "identity-vault");
  const backupsRoot = path.resolve(
    cwd,
    env.SUPERMEMORY_BACKUPS_ROOT || path.join(os.homedir(), ".supermemory", "backups")
  );
  const baseUrl = env.HINDSIGHT_BASE_URL || "http://127.0.0.1:8888";
  const ollamaUrl = env.SUPERMEMORY_OLLAMA_URL || "http://127.0.0.1:11434";
  const model = env.HINDSIGHT_OLLAMA_MODEL || "llama3:latest";
  const checks = [];

  const major = Number.parseInt(String(nodeVersion).split(".")[0], 10);
  checks.push({
    id: "node",
    ok: Number.isInteger(major) && major >= 18,
    detail: `Node ${nodeVersion}`
  });

  for (const dependency of ["mammoth", "pdfjs-dist"]) {
    const packagePath = path.join(cwd, "node_modules", dependency, "package.json");
    checks.push({
      id: `dependency_${dependency}`,
      ok: fs.existsSync(packagePath),
      detail: fs.existsSync(packagePath) ? "installed" : "run npm ci --ignore-scripts"
    });
  }

  let vaultOk = false;
  let vaultDetail = vaultRoot;
  try {
    fs.mkdirSync(vaultRoot, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(vaultRoot);
    vaultOk = stat.isDirectory() && !stat.isSymbolicLink();
    if (vaultOk) fs.accessSync(vaultRoot, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    vaultDetail = `${vaultRoot}: ${error.code || error.message}`;
  }
  checks.push({ id: "vault", ok: vaultOk, detail: vaultDetail });

  let backupsOk = !isInside(vaultRoot, backupsRoot);
  let backupsDetail = backupsRoot;
  if (backupsOk) {
    try {
      fs.mkdirSync(backupsRoot, { recursive: true, mode: 0o700 });
      const stat = fs.lstatSync(backupsRoot);
      backupsOk = stat.isDirectory() && !stat.isSymbolicLink();
      if (backupsOk) fs.accessSync(backupsRoot, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      backupsOk = false;
      backupsDetail = `${backupsRoot}: ${error.code || error.message}`;
    }
  } else {
    backupsDetail = `${backupsRoot}: must be outside the canonical vault`;
  }
  checks.push({ id: "backups", ok: backupsOk, detail: backupsDetail });

  checks.push({
    id: "hindsight_loopback",
    ok: loopbackHttpUrl(baseUrl),
    detail: baseUrl
  });
  const ollamaLoopback = loopbackHttpUrl(ollamaUrl);
  checks.push({
    id: "ollama_loopback",
    ok: ollamaLoopback,
    detail: ollamaUrl
  });
  checks.push(commandCheck(spawnSyncImpl, "docker", ["version", "--format", "{{.Server.Version}}"], "docker"));
  checks.push(commandCheck(spawnSyncImpl, "ollama", ["--version"], "ollama"));

  const ollama = ollamaLoopback
    ? await fetchJson(fetchImpl, `${ollamaUrl}/api/tags`)
    : { ok: false, data: null };
  const models = ollama.data?.models ?? [];
  checks.push({
    id: "ollama_model",
    ok: ollama.ok && models.some((item) => item.name === model || item.model === model),
    detail: ollama.ok
      ? models.some((item) => item.name === model || item.model === model)
        ? `${model} installed`
        : `${model} missing; install it explicitly with: ollama pull ${model}`
      : `Ollama unavailable at ${ollamaUrl}`
  });

  const hindsight = await fetchJson(fetchImpl, `${baseUrl.replace(/\/+$/, "")}/health`);
  checks.push({
    id: "hindsight",
    ok: hindsight.ok && hindsight.data?.status === "healthy",
    detail: hindsight.ok ? JSON.stringify(hindsight.data) : `unavailable at ${baseUrl}`
  });

  const blockers = checks.filter((check) => !check.ok);
  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    ready: blockers.length === 0,
    mode: "local-product-doctor",
    remoteCallsAllowed: false,
    modelDownloaded: false,
    vaultRoot,
    backupsRoot,
    hindsightBaseUrl: baseUrl,
    ollamaModel: model,
    checks,
    blockers: blockers.map((check) => ({
      code: check.id,
      action: check.detail
    }))
  };
}

function printText(report) {
  process.stdout.write(`${report.ready ? "READY" : "BLOCKED"} SuperMemory local doctor\n`);
  for (const check of report.checks) {
    process.stdout.write(`${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.detail}\n`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node scripts/supermemory-doctor.mjs [--json]\n");
    } else {
      const report = await runDoctor();
      if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else printText(report);
      if (!report.ready) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
