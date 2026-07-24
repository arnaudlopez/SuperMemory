#!/usr/bin/env node
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSuperMemoryServer } from "./supermemory-app.mjs";
import { runDoctor } from "./supermemory-doctor.mjs";

function parseArgs(argv) {
  const options = {
    port: 4310,
    vaultRoot: process.env.SUPERMEMORY_VAULT_ROOT || path.resolve("identity-vault"),
    backupsRoot: process.env.SUPERMEMORY_BACKUPS_ROOT || path.join(os.homedir(), ".supermemory", "backups"),
    open: true,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--vault-root") options.vaultRoot = path.resolve(argv[++index]);
    else if (arg === "--backups-root") options.backupsRoot = path.resolve(argv[++index]);
    else if (arg === "--no-open") options.open = false;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error("port_invalid");
  }
  return options;
}

function composeUp() {
  const result = spawnSync("docker", ["compose", "-f", "compose.hindsight.yml", "up", "-d"], {
    encoding: "utf8",
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "docker compose failed").trim());
  }
}

async function waitForHealth(baseUrl, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, {
        signal: AbortSignal.timeout(2_000)
      });
      if (response.ok) return;
    } catch {
      // The pinned local container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("Hindsight local n’est pas devenu sain dans le délai prévu.");
}

function openBrowser(url) {
  if (process.platform === "darwin") {
    const child = spawn("open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  }
}

export async function launch(options) {
  process.env.SUPERMEMORY_VAULT_ROOT = options.vaultRoot;
  process.env.SUPERMEMORY_BACKUPS_ROOT = options.backupsRoot;
  const preflight = await runDoctor();
  const prerequisiteBlockers = preflight.blockers.filter(
    (blocker) => !["hindsight"].includes(blocker.code)
  );
  if (prerequisiteBlockers.length > 0) {
    throw new Error(
      `Prérequis manquants:\n${prerequisiteBlockers.map((item) => `- ${item.action}`).join("\n")}`
    );
  }
  composeUp();
  const baseUrl = process.env.HINDSIGHT_BASE_URL || "http://127.0.0.1:8888";
  await waitForHealth(baseUrl);
  const doctor = await runDoctor();
  if (!doctor.ready) {
    throw new Error(`Diagnostic bloqué:\n${doctor.blockers.map((item) => `- ${item.action}`).join("\n")}`);
  }
  const app = createSuperMemoryServer({
    port: options.port,
    vaultRoot: options.vaultRoot,
    backupsRoot: options.backupsRoot
  });
  const runtime = await app.start();
  if (options.open) openBrowser(runtime.url);
  return { app, runtime, doctor };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/supermemory-launch.mjs [--port 4310] [--vault-root <path>] [--backups-root <path>] [--no-open] [--json]\n"
    );
    return;
  }
  const launched = await launch(options);
  const report = {
    status: "ready",
    url: launched.runtime.url,
    vaultRoot: launched.runtime.vaultRoot,
    backupsRoot: launched.doctor.backupsRoot,
    hindsight: launched.doctor.hindsightBaseUrl,
    ollamaModel: launched.doctor.ollamaModel
  };
  process.stdout.write(options.json ? `${JSON.stringify(report)}\n` : [
    `SuperMemory est prêt : ${report.url}`,
    `Vault : ${report.vaultRoot}`,
    `Sauvegardes : ${report.backupsRoot}`,
    `Hindsight : ${report.hindsight}`,
    `Modèle local : ${report.ollamaModel}`,
    "Fermez cette fenêtre ou appuyez sur Ctrl-C pour arrêter l’application."
  ].join("\n") + "\n");

  const shutdown = async () => {
    await launched.app.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
