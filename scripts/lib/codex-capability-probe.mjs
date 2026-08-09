import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 15_000 });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim()
  };
}

export function probeCodexCapabilities({ executable = "codex" } = {}) {
  const resolved = path.isAbsolute(executable)
    ? executable
    : spawnSync("which", [executable], { encoding: "utf8" }).stdout.trim();
  if (!resolved || !fs.existsSync(resolved)) {
    return { schema: "supermemory.codex-host-capability.v1", available: false, executable: null };
  }
  const version = run(resolved, ["--version"]);
  const features = run(resolved, ["features", "list"]);
  const plugins = run(resolved, ["plugin", "list"]);
  const marketplaces = run(resolved, ["plugin", "marketplace", "list"]);
  return {
    schema: "supermemory.codex-host-capability.v1",
    available: version.ok,
    executable: resolved,
    version: version.stdout || null,
    plugins_supported: plugins.ok,
    hooks_supported: features.ok && /\bhooks\b[^\n]*\btrue\b/i.test(features.stdout),
    mcp_supported: true,
    supermemory_installed: /\bsupermemory(?:@supermemory-local)?\b/i.test(plugins.stdout),
    marketplace_installed: /\bsupermemory-local\b/i.test(marketplaces.stdout),
    new_session_required: true,
    auto_trust_hooks: false
  };
}
