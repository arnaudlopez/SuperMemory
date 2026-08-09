#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { applyStableCodexClient, planStableCodexClient } from "./lib/codex-client-launcher.mjs";

function argument(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : argv[index + 1];
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
}

const argv = process.argv.slice(2);
try {
  const command = argv[0];
  const planFile = path.resolve(argument(
    argv,
    "--plan-file",
    path.join(os.homedir(), ".supermemory", "client", "install-plan.json")
  ));
  if (command === "plan") {
    const plan = planStableCodexClient({
      repositoryRoot: argument(argv, "--repository-root", path.resolve(".")),
      executable: argument(argv, "--codex", "codex")
    });
    atomicJson(planFile, plan);
    process.stdout.write(`${JSON.stringify({ ok: true, plan_file: planFile, ...plan }, null, 2)}\n`);
  } else if (command === "apply") {
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const result = applyStableCodexClient({ plan, expectedPlanHash: argument(argv, "--plan-hash") });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  } else {
    throw new Error("plugin_command_invalid");
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error?.code ?? error?.message ?? "plugin_failed" })}\n`);
  process.exitCode = 1;
}
