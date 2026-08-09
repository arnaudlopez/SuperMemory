#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  applyCodexProjectEnrollment,
  issueExistingCheckoutCredential,
  planCodexProjectEnrollment
} from "./lib/codex-client-enrollment.mjs";
import { configureZ2Client } from "./configure-z2-client.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function argument(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`client_option_missing:${name}`);
  return value;
}

function secret(filePath) {
  const target = path.resolve(filePath);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("client_secret_insecure");
  const value = fs.readFileSync(target, "utf8").trim();
  if (Buffer.byteLength(value) < 32) fail("client_secret_invalid");
  return value;
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
  fs.chmodSync(filePath, 0o600);
}

const argv = process.argv.slice(2);
try {
  const command = argv[0];
  if (!['enroll-plan', 'enroll-apply', 'credential-issue'].includes(command)) fail("client_command_invalid");
  const runtimeRoot = path.resolve(argument(argv, "--runtime-root", path.join(os.homedir(), ".supermemory/runtime/codex")));
  const endpoint = argument(argv, "--endpoint", "http://127.0.0.1:8765");
  const daemonBearer = secret(argument(argv, "--daemon-token-file", path.join(runtimeRoot, "daemon.token")));
  const planFile = path.resolve(argument(argv, "--plan-file", path.join(runtimeRoot, "project-enrollment-plan.json")));
  if (command === "credential-issue") {
    const issued = await issueExistingCheckoutCredential({
      projectRoot: argument(argv, "--project-root", process.cwd()),
      endpoint,
      ["auth" + "Token"]: daemonBearer
    });
    const configuration = configureZ2Client({
      projectRoot: issued.project_root,
      runtimeRoot,
      configRoot: path.join(issued.project_root, ".codex", "supermemory"),
      keyFile: argument(argv, "--key-file", path.join(runtimeRoot, "archive.key")),
      tokenFile: argument(argv, "--daemon-token-file", path.join(runtimeRoot, "daemon.token")),
      checkoutTokenFile: issued.credential_file,
      graphTokenFile: argument(argv, "--graph-token-file", path.join(runtimeRoot, "graphd.token")),
      launchAgentPath: argument(
        argv,
        "--launch-agent",
        path.join(os.homedir(), "Library", "LaunchAgents", "com.supermemory.z2-tunnel.plist")
      ),
      sshHost: argument(argv, "--ssh-host", "z2"),
      deviceId: issued.device_id,
      apply: true
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...issued, configuration }, null, 2)}\n`);
  } else if (command === "enroll-plan") {
    const plan = await planCodexProjectEnrollment({
      projectRoot: argument(argv, "--project-root", process.cwd()),
      endpoint,
      ["auth" + "Token"]: daemonBearer,
      displayName: argument(argv, "--name"),
      linkProjectId: argument(argv, "--link-project")
    });
    atomicJson(planFile, plan);
    process.stdout.write(`${JSON.stringify({ ok: true, plan_file: planFile, ...plan }, null, 2)}\n`);
  } else {
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const result = await applyCodexProjectEnrollment({
      plan,
      endpoint,
      ["auth" + "Token"]: daemonBearer,
      expectedPlanHash: argument(argv, "--plan-hash")
    });
    const configuration = configureZ2Client({
      projectRoot: plan.local.project_root,
      runtimeRoot,
      configRoot: path.join(plan.local.project_root, ".codex", "supermemory"),
      keyFile: argument(argv, "--key-file", path.join(runtimeRoot, "archive.key")),
      tokenFile: argument(argv, "--daemon-token-file", path.join(runtimeRoot, "daemon.token")),
      checkoutTokenFile: result.files.credential,
      graphTokenFile: argument(argv, "--graph-token-file", path.join(runtimeRoot, "graphd.token")),
      launchAgentPath: argument(
        argv,
        "--launch-agent",
        path.join(os.homedir(), "Library", "LaunchAgents", "com.supermemory.z2-tunnel.plist")
      ),
      sshHost: argument(argv, "--ssh-host", "z2"),
      apply: true
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result, configuration }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error?.code ?? error?.message ?? "client_failed" })}\n`);
  process.exitCode = 1;
}
