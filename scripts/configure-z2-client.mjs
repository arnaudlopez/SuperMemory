#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createFullDeploymentRuntimeV5 } from "./lib/codex-runtime-config.mjs";
import { resolveProjectMarkerBinding } from "./lib/project-registry.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function argument(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function absolute(value, code) {
  if (!value || !path.isAbsolute(value)) fail(code);
  return path.resolve(value);
}

function secureRegularFile(filePath, code) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail(code);
}

function ensureDirectory(directory) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("z2_client_directory_invalid");
  } else fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function atomicWrite(filePath, content) {
  ensureDirectory(path.dirname(filePath));
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plist({ projectRoot, runtimeRoot, sshHost }) {
  const args = [
    "/usr/bin/ssh", "-N", "-T",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "TCPKeepAlive=yes",
    "-o", "ConnectTimeout=10",
    "-L", "4310:127.0.0.1:4310",
    "-L", "8765:127.0.0.1:8765",
    "-L", "9999:127.0.0.1:9999",
    "-L", "8888:127.0.0.1:8888",
    "-L", "8787:127.0.0.1:8787",
    sshHost
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    "  <string>com.supermemory.z2-tunnel</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((value) => `    <string>${xml(value)}</string>`),
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  <string>${xml(projectRoot)}</string>`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>NetworkState</key>",
    "    <true/>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "  <key>ThrottleInterval</key>",
    "  <integer>10</integer>",
    "  <key>Umask</key>",
    "  <integer>63</integer>",
    "  <key>StandardOutPath</key>",
    `  <string>${xml(path.join(runtimeRoot, "logs", "z2-tunnel.stdout.log"))}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xml(path.join(runtimeRoot, "logs", "z2-tunnel.stderr.log"))}</string>`,
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
}

export function configureZ2Client({
  projectRoot,
  runtimeRoot,
  keyFile,
  tokenFile,
  graphTokenFile,
  configRoot,
  launchAgentPath,
  sshHost = "z2",
  apply = false
} = {}) {
  const project = absolute(projectRoot, "z2_client_project_invalid");
  const runtime = absolute(runtimeRoot, "z2_client_runtime_invalid");
  const key = absolute(keyFile, "z2_client_key_invalid");
  const token = absolute(tokenFile, "z2_client_token_invalid");
  const graphToken = absolute(graphTokenFile, "z2_client_graph_token_invalid");
  const configs = absolute(configRoot, "z2_client_config_invalid");
  const agent = absolute(launchAgentPath, "z2_client_launch_agent_invalid");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(sshHost)) fail("z2_client_ssh_host_invalid");
  for (const [filePath, code] of [
    [key, "z2_client_key_insecure"],
    [token, "z2_client_token_insecure"],
    [graphToken, "z2_client_graph_token_insecure"]
  ]) secureRegularFile(filePath, code);
  const binding = resolveProjectMarkerBinding(project);
  if (binding.status !== "bound") fail("z2_client_project_unbound");
  const runtimeContract = createFullDeploymentRuntimeV5({
    graphEndpoint: "http://127.0.0.1:8787",
    graphTokenFile: graphToken
  });
  const contractPath = path.join(configs, "runtime-contract.json");
  const hook = {
    schema: "supermemory.hook-runtime.v1",
    client_mode: "remote",
    runtime_root: runtime,
    daemon_endpoint: "http://127.0.0.1:8765",
    key_file: key,
    token_file: token,
    capture_mode: "hooks_primary",
    runtime_contract_file: contractPath,
    expected_workspace_id: binding.workspaceId,
    expected_project_id: binding.projectId,
    expected_checkout_id: binding.checkoutId
  };
  const mcp = {
    schema: "supermemory.mcp-runtime.v1",
    client_mode: "remote",
    daemon_endpoint: "http://127.0.0.1:8765",
    daemon_token_file: token,
    runtime_contract_file: contractPath,
    max_results: 20,
    expected_workspace_id: binding.workspaceId,
    expected_project_id: binding.projectId,
    expected_checkout_id: binding.checkoutId
  };
  const files = {
    runtime_contract: contractPath,
    hook_runtime: path.join(configs, "hook-runtime.json"),
    mcp_runtime: path.join(configs, "mcp-runtime.json"),
    launch_agent: agent
  };
  if (apply) {
    ensureDirectory(runtime);
    ensureDirectory(path.join(runtime, "logs"));
    atomicWrite(files.runtime_contract, json(runtimeContract));
    atomicWrite(files.hook_runtime, json(hook));
    atomicWrite(files.mcp_runtime, json(mcp));
    atomicWrite(files.launch_agent, plist({ projectRoot: project, runtimeRoot: runtime, sshHost }));
  }
  return {
    schema: "supermemory.z2-client-plan.v1",
    applied: apply,
    ssh_host: sshHost,
    binding: {
      workspace_id: binding.workspaceId,
      project_id: binding.projectId,
      checkout_id: binding.checkoutId
    },
    files
  };
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const argv = process.argv.slice(2);
    const projectRoot = argument(argv, "--project-root", process.cwd());
    const runtimeRoot = argument(argv, "--runtime-root", path.join(os.homedir(), ".supermemory/runtime/codex"));
    const configRoot = argument(argv, "--config-root", path.join(projectRoot, ".codex/supermemory"));
    const report = configureZ2Client({
      projectRoot,
      runtimeRoot,
      configRoot,
      keyFile: argument(argv, "--key-file", path.join(runtimeRoot, "archive.key")),
      tokenFile: argument(argv, "--token-file", path.join(runtimeRoot, "daemon.token")),
      graphTokenFile: argument(argv, "--graph-token-file", path.join(runtimeRoot, "graphd.token")),
      launchAgentPath: argument(
        argv,
        "--launch-agent",
        path.join(os.homedir(), "Library/LaunchAgents/com.supermemory.z2-tunnel.plist")
      ),
      sshHost: argument(argv, "--ssh-host", "z2"),
      apply: argv.includes("--apply")
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error?.code ?? error?.message ?? "z2_client_failed" })}\n`);
    process.exitCode = 1;
  }
}
