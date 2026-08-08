import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { canonicalJson } from "./codex-redaction.mjs";
import { createCodexInstaller } from "./codex-installer.mjs";
import { createProjectRegistry } from "./project-registry.mjs";

const PLAN_SCHEMA = "supermemory.codex-desktop-plan.v1";
const MANIFEST_SCHEMA = "supermemory.codex-desktop-installation.v1";
const FEATURE_PLAN_SCHEMA = "supermemory.codex-desktop-hooks-feature-plan.v1";
const FEATURE_MANIFEST_SCHEMA = "supermemory.codex-desktop-hooks-feature-migration.v1";
const LEGACY_COMPILER = /(?:^|[/\\])claude-memory-compiler(?:[/\\]|$)/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export class CodexDesktopDeploymentError extends Error {
  constructor(code, details = null) {
    super(code);
    this.name = "CodexDesktopDeploymentError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, details = null) {
  throw new CodexDesktopDeploymentError(code, details);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function hashJson(value) {
  return sha256(canonicalJson(value));
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function planHash(value) {
  const copy = structuredClone(value);
  delete copy.plan_hash;
  delete copy.confirmation;
  return hashJson(copy);
}

function fileFingerprint(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, type: null, sha256: null };
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) fail("deployment_target_symlink", { target: filePath });
  if (stat.isFile()) {
    return {
      exists: true,
      type: "file",
      sha256: sha256(fs.readFileSync(filePath)),
      mode: stat.mode & 0o777
    };
  }
  if (!stat.isDirectory()) fail("deployment_target_invalid", { target: filePath });
  const entries = [];
  const walk = (directory, prefix = "") => {
    for (const name of fs.readdirSync(directory).sort()) {
      const current = path.join(directory, name);
      const relative = path.join(prefix, name).split(path.sep).join("/");
      const child = fs.lstatSync(current);
      if (child.isSymbolicLink()) fail("deployment_target_symlink", { target: current });
      if (child.isDirectory()) {
        entries.push({ path: `${relative}/`, type: "directory", mode: child.mode & 0o777 });
        walk(current, relative);
      } else if (child.isFile()) {
        entries.push({
          path: relative,
          type: "file",
          mode: child.mode & 0o777,
          sha256: sha256(fs.readFileSync(current))
        });
      } else {
        fail("deployment_target_invalid", { target: current });
      }
    }
  };
  walk(filePath);
  return {
    exists: true,
    type: "directory",
    sha256: hashJson(entries),
    mode: stat.mode & 0o777
  };
}

function writeFileAtomic(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode, flag: "wx" });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, mode);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function writeJsonAtomic(filePath, value, mode = 0o600) {
  writeFileAtomic(filePath, `${canonicalJson(value)}\n`, mode);
}

function snapshotTarget(target, backupRoot, id) {
  const fingerprint = fileFingerprint(target);
  if (!fingerprint.exists) {
    return { id, target, existed: false, backup: null, fingerprint };
  }
  const backup = path.join(backupRoot, "targets", id);
  fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  fs.cpSync(target, backup, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false
  });
  return {
    id,
    target,
    existed: true,
    backup: path.relative(backupRoot, backup),
    fingerprint
  };
}

function restoreSnapshot(entry, backupRoot) {
  if (fs.existsSync(entry.target)) {
    fs.rmSync(entry.target, { recursive: true, force: true });
  }
  if (!entry.existed) return;
  const backup = path.resolve(backupRoot, entry.backup);
  if (!backup.startsWith(`${path.resolve(backupRoot)}${path.sep}`)) {
    fail("deployment_backup_scope_invalid");
  }
  fs.mkdirSync(path.dirname(entry.target), { recursive: true, mode: 0o700 });
  fs.cpSync(backup, entry.target, { recursive: true, dereference: false });
}

function tableHeader(line) {
  const match = line.match(/^\s*(\[\[?[^\]]+\]\]?)\s*(?:#.*)?$/);
  return match ? match[1] : null;
}

function quotedAssignment(line, key) {
  const pattern = new RegExp(
    `^\\s*${key}\\s*=\\s*(?:\"((?:[^\"\\\\]|\\\\.)*)\"|'([^']*)')\\s*(?:#.*)?$`,
    "i"
  );
  const match = line.match(pattern);
  return match ? (match[1] ?? match[2] ?? "") : null;
}

function eventToStateName(event) {
  return event.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function sectionRanges(lines) {
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = tableHeader(lines[index]);
    if (header) starts.push({ index, header });
  }
  return starts.map((entry, index) => ({
    ...entry,
    end: starts[index + 1]?.index ?? lines.length
  }));
}

export function inspectLegacyCodexHooks(configText) {
  const lines = String(configText).split(/\r?\n/);
  const sections = sectionRanges(lines);
  const hookStarts = sections.filter((section) => {
    const match = section.header.match(/^\[\[hooks\.([A-Za-z][A-Za-z0-9]*)\]\]$/);
    return Boolean(match);
  });
  const groups = [];
  const perEventIndex = new Map();
  for (const start of hookStarts) {
    const event = start.header.match(/^\[\[hooks\.([A-Za-z][A-Za-z0-9]*)\]\]$/)[1];
    const nextTop = hookStarts.find((candidate) => candidate.index > start.index);
    const end = sections.find((candidate) => (
      candidate.index > start.index &&
      candidate.index < (nextTop?.index ?? lines.length) &&
      candidate.header !== `[[hooks.${event}.hooks]]`
    ))?.index ?? nextTop?.index ?? lines.length;
    const groupLines = lines.slice(start.index, end);
    const commands = groupLines
      .map((line) => (
        quotedAssignment(line, "command") ??
        quotedAssignment(line, "command_windows") ??
        quotedAssignment(line, "commandWindows")
      ))
      .filter((value) => value !== null);
    const legacyCommands = commands.filter((command) => LEGACY_COMPILER.test(command));
    const eventIndex = perEventIndex.get(event) ?? 0;
    perEventIndex.set(event, eventIndex + 1);
    if (legacyCommands.length > 0 && legacyCommands.length !== commands.length) {
      fail("legacy_hook_group_mixed", { event, event_index: eventIndex });
    }
    if (legacyCommands.length > 0) {
      groups.push({
        event,
        event_index: eventIndex,
        start: start.index,
        end,
        handler_count: legacyCommands.length,
        command_fingerprints: legacyCommands.map((command) => sha256(command))
      });
    }
  }
  const structuredLegacyAssignments = groups.reduce(
    (total, group) => total + group.handler_count,
    0
  );
  const allLegacyAssignments = lines.filter((line) => {
    const command = (
      quotedAssignment(line, "command") ??
      quotedAssignment(line, "command_windows") ??
      quotedAssignment(line, "commandWindows")
    );
    return command !== null && LEGACY_COMPILER.test(command);
  }).length;
  if (allLegacyAssignments !== structuredLegacyAssignments) {
    fail("legacy_hook_unstructured");
  }
  const stateSections = sections.filter((section) => (
    /^\[hooks\.state\.".*"\]$/.test(section.header)
  ));
  const removedState = [];
  for (const group of groups) {
    const eventName = eventToStateName(group.event);
    for (let handlerIndex = 0; handlerIndex < group.handler_count; handlerIndex += 1) {
      const suffix = `:${eventName}:${group.event_index}:${handlerIndex}`;
      const state = stateSections.find((section) => {
        const key = section.header.slice('[hooks.state."'.length, -2);
        return key.endsWith(suffix);
      });
      if (state) removedState.push({ ...state, event: group.event });
    }
  }
  return {
    legacy_hook_count: groups.reduce((total, group) => total + group.handler_count, 0),
    legacy_group_count: groups.length,
    legacy_state_count: removedState.length,
    events: groups.map((group) => group.event),
    command_fingerprints: groups.flatMap((group) => group.command_fingerprints),
    groups,
    state_sections: removedState
  };
}

export function removeLegacyCodexHooks(configText) {
  const source = String(configText);
  const hadFinalNewline = source.endsWith("\n");
  const lines = source.split(/\r?\n/);
  const inspection = inspectLegacyCodexHooks(source);
  const ranges = [
    ...inspection.groups.map(({ start, end }) => ({ start, end })),
    ...inspection.state_sections.map(({ index, end }) => ({ start: index, end }))
  ].sort((left, right) => left.start - right.start);
  const remove = new Set();
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index += 1) remove.add(index);
  }
  const kept = lines.filter((_, index) => !remove.has(index));
  while (kept.length > 0 && kept.at(-1) === "") kept.pop();
  const transformed = kept.join("\n") + (hadFinalNewline ? "\n" : "");
  const after = inspectLegacyCodexHooks(transformed);
  if (after.legacy_hook_count !== 0) fail("legacy_hook_cutover_incomplete");
  return {
    text: transformed,
    changed: transformed !== source,
    ...inspection
  };
}

function configLineRecords(source) {
  const records = [];
  const pattern = /[^\r\n]*(?:\r\n|\n|$)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match[0] === "") break;
    const newline = match[0].endsWith("\r\n")
      ? "\r\n"
      : (match[0].endsWith("\n") ? "\n" : "");
    records.push({
      content: newline ? match[0].slice(0, -newline.length) : match[0],
      newline,
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return records;
}

function featureAssignment(record, lineIndex, mode) {
  const pattern = mode === "section"
    ? /^(\s*)(codex_hooks|hooks)(\s*=\s*)(true|false)(\s*(?:#.*)?)$/
    : /^(\s*features\.)(codex_hooks|hooks)(\s*=\s*)(true|false)(\s*(?:#.*)?)$/;
  const match = record.content.match(pattern);
  if (!match) return null;
  const keyIndex = mode === "section" ? 2 : 2;
  const separatorIndex = 3;
  const valueIndex = 4;
  const suffixIndex = 5;
  return {
    key: match[keyIndex],
    value: match[valueIndex] === "true",
    mode,
    line_index: lineIndex,
    start: record.start,
    end: record.end,
    newline: record.newline,
    replacement: {
      prefix: match[1],
      separator: match[separatorIndex],
      suffix: match[suffixIndex]
    }
  };
}

export function inspectCodexHooksFeatureFlag(configText) {
  const source = String(configText);
  const records = configLineRecords(source);
  const lines = records.map((record) => record.content);
  const sections = sectionRanges(lines);
  const featureSections = sections.filter((section) => section.header === "[features]");
  if (featureSections.length > 1) fail("codex_hooks_feature_table_duplicate");
  const featureSection = featureSections[0] ?? null;
  const firstSectionIndex = sections[0]?.index ?? lines.length;
  const assignments = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const trimmed = record.content.trimStart();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const inFeatureSection = featureSection &&
      index > featureSection.index &&
      index < featureSection.end;
    if (inFeatureSection) {
      const parsed = featureAssignment(record, index, "section");
      if (parsed) assignments.push(parsed);
      else if (/^\s*(?:codex_hooks|hooks)\s*=/.test(record.content)) {
        fail("codex_hooks_feature_value_unsupported", { line: index + 1 });
      }
    }
    if (index < firstSectionIndex) {
      const parsed = featureAssignment(record, index, "dotted");
      if (parsed) assignments.push(parsed);
      else if (/^\s*features\.(?:codex_hooks|hooks)\s*=/.test(record.content)) {
        fail("codex_hooks_feature_value_unsupported", { line: index + 1 });
      }
    }
  }
  const legacy = assignments.filter((entry) => entry.key === "codex_hooks");
  const canonical = assignments.filter((entry) => entry.key === "hooks");
  if (legacy.length > 1 || canonical.length > 1) {
    fail("codex_hooks_feature_assignment_duplicate");
  }
  if (legacy.length === 1 && canonical.length === 1 &&
      legacy[0].value !== canonical[0].value) {
    fail("codex_hooks_feature_conflict");
  }
  return {
    canonical_present: canonical.length === 1,
    canonical_enabled: canonical[0]?.value === true,
    deprecated_alias_present: legacy.length === 1,
    deprecated_alias_count: legacy.length,
    effective_enabled: canonical[0]?.value ?? legacy[0]?.value ?? false,
    source: canonical[0]?.mode ?? legacy[0]?.mode ?? null,
    feature_table_present: Boolean(featureSection),
    feature_table_line: featureSection?.index ?? null,
    feature_table_end: featureSection?.end ?? null,
    assignments: [...legacy, ...canonical]
  };
}

function rewriteFeatureAssignment(source, assignment, key, value) {
  const { prefix, separator, suffix } = assignment.replacement;
  const replacement = `${prefix}${key}${separator}${value ? "true" : "false"}${suffix}` +
    assignment.newline;
  return {
    start: assignment.start,
    end: assignment.end,
    replacement
  };
}

export function migrateCodexHooksFeatureFlag(configText) {
  const source = String(configText);
  const inspected = inspectCodexHooksFeatureFlag(source);
  const legacy = inspected.assignments.find((entry) => entry.key === "codex_hooks") ?? null;
  const canonical = inspected.assignments.find((entry) => entry.key === "hooks") ?? null;
  const edits = [];
  if (canonical) {
    if (!canonical.value) {
      edits.push(rewriteFeatureAssignment(source, canonical, "hooks", true));
    }
    if (legacy) {
      edits.push({ start: legacy.start, end: legacy.end, replacement: "" });
    }
  } else if (legacy) {
    edits.push(rewriteFeatureAssignment(source, legacy, "hooks", true));
  } else {
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    if (inspected.feature_table_present) {
      const records = configLineRecords(source);
      const header = records[inspected.feature_table_line];
      edits.push({
        start: header.end,
        end: header.end,
        replacement: `${header.newline ? "" : newline}hooks = true${newline}`
      });
    } else {
      const separator = source === "" || source.endsWith("\n") ? "" : newline;
      const leadingBlank = source === "" || source.endsWith(`${newline}${newline}`) ? "" : newline;
      edits.push({
        start: source.length,
        end: source.length,
        replacement: `${separator}${leadingBlank}[features]${newline}hooks = true${newline}`
      });
    }
  }
  let transformed = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    transformed = transformed.slice(0, edit.start) + edit.replacement +
      transformed.slice(edit.end);
  }
  const after = inspectCodexHooksFeatureFlag(transformed);
  if (!after.canonical_enabled || after.deprecated_alias_count !== 0) {
    fail("codex_hooks_feature_migration_incomplete");
  }
  return {
    text: transformed,
    changed: transformed !== source,
    before: inspected,
    after
  };
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plistString(value) {
  return `    <string>${xmlEscape(value)}</string>`;
}

export function createSuperMemoryLaunchAgentPlist({
  label = "com.supermemory.codex-daemon",
  nodePath,
  daemonScript,
  projectRoot,
  vaultRoot,
  keyFile,
  tokenFile,
  runtimeRoot,
  host = "127.0.0.1",
  port = 8765
} = {}) {
  if (!path.isAbsolute(nodePath) || !path.isAbsolute(daemonScript)) {
    fail("launch_agent_executable_invalid");
  }
  if (![projectRoot, vaultRoot, keyFile, tokenFile, runtimeRoot].every(path.isAbsolute)) {
    fail("launch_agent_path_invalid");
  }
  if (!["127.0.0.1", "::1"].includes(host)) fail("launch_agent_host_not_loopback");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail("launch_agent_port_invalid");
  const argumentsList = [
    nodePath,
    daemonScript,
    "--vault-root",
    vaultRoot,
    "--key-file",
    keyFile,
    "--token-file",
    tokenFile,
    "--runtime-root",
    runtimeRoot,
    "--host",
    host,
    "--port",
    String(port)
  ];
  const argumentsXml = argumentsList.map(plistString).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xmlEscape(label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    argumentsXml,
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  <string>${xmlEscape(projectRoot)}</string>`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "  <key>ThrottleInterval</key>",
    "  <integer>5</integer>",
    "  <key>Umask</key>",
    "  <integer>63</integer>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(path.join(runtimeRoot, "logs", "daemon.stdout.log"))}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(path.join(runtimeRoot, "logs", "daemon.stderr.log"))}</string>`,
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
}

function summarizePlugin(result, pluginName) {
  for (const marketplace of result?.marketplaces ?? []) {
    const plugin = (marketplace.plugins ?? []).find((entry) => entry?.name === pluginName);
    if (!plugin) continue;
    return {
      found: true,
      installed: Boolean(plugin.installed),
      enabled: Boolean(plugin.enabled),
      plugin_id: plugin.id ?? plugin.pluginId ?? `${pluginName}@${marketplace.name}`,
      marketplace: marketplace.name ?? null,
      install_policy: plugin.installPolicy ?? null
    };
  }
  return {
    found: false,
    installed: false,
    enabled: false,
    plugin_id: null,
    marketplace: null,
    install_policy: null
  };
}

function summarizeHooks(result, pluginId) {
  const entries = result?.data ?? [];
  const hooks = entries.flatMap((entry) => entry.hooks ?? []);
  const selected = hooks.filter((hook) => (
    hook.source === "plugin" &&
    (!pluginId || hook.pluginId === pluginId || hook.pluginId?.startsWith("supermemory@"))
  ));
  return {
    count: selected.length,
    trusted: selected.length > 0 && selected.every((hook) => (
      hook.trustStatus === "trusted" || hook.trustStatus === "managed"
    )),
    statuses: [...new Set(selected.map((hook) => hook.trustStatus))].sort(),
    events: [...new Set(selected.map((hook) => hook.eventName))].sort(),
    definition_hashes: [...new Set(selected.map((hook) => hook.currentHash).filter(Boolean))].sort()
  };
}

async function withAppServer({
  codexExecutable,
  cwd,
  codexHome = null,
  timeoutMs = 15_000,
  run
}) {
  if (!path.isAbsolute(codexExecutable)) fail("codex_desktop_executable_invalid");
  const child = spawn(codexExecutable, ["app-server", "--disable", "remote_plugin"], {
    cwd,
    env: { ...process.env, ...(codexHome ? { CODEX_HOME: codexHome } : {}) },
    stdio: ["pipe", "pipe", "ignore"]
  });
  const pending = new Map();
  let nextId = 1;
  let closed = false;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new CodexDesktopDeploymentError("codex_app_server_error", {
        method: entry.method,
        code: message.error.code ?? null
      }));
    } else {
      entry.resolve(message.result);
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) {
      reject(new CodexDesktopDeploymentError("codex_app_server_closed"));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    for (const entry of pending.values()) {
      entry.reject(new CodexDesktopDeploymentError("codex_app_server_timeout"));
    }
    pending.clear();
  }, timeoutMs);
  const childError = new Promise((_, reject) => {
    child.once("error", (error) => reject(new CodexDesktopDeploymentError(
      "codex_app_server_start_failed",
      { code: error.code ?? null }
    )));
  });
  try {
    await Promise.race([
      call("initialize", {
        clientInfo: { name: "supermemory-desktop-deployer", version: "0.1.0" }
      }),
      childError
    ]);
    return await run(call);
  } finally {
    closed = true;
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    child.kill("SIGTERM");
  }
}

export async function inspectCodexDesktopHost({
  codexExecutable,
  cwd,
  codexHome = null,
  pluginName = "supermemory",
  timeoutMs
} = {}) {
  return withAppServer({
    codexExecutable,
    cwd,
    codexHome,
    timeoutMs,
    run: async (call) => {
      const listed = await call("plugin/list", { cwds: [cwd] });
      const plugin = summarizePlugin(listed, pluginName);
      const hookResult = await call("hooks/list", { cwds: [cwd] });
      return {
        plugin,
        hooks: summarizeHooks(hookResult, plugin.plugin_id)
      };
    }
  });
}

export function createCodexAppServerController({
  codexExecutable,
  cwd,
  codexHome = null,
  pluginName = "supermemory",
  marketplacePath,
  timeoutMs
} = {}) {
  const inspect = () => inspectCodexDesktopHost({
    codexExecutable,
    cwd,
    codexHome,
    pluginName,
    timeoutMs
  });
  const install = () => withAppServer({
    codexExecutable,
    cwd,
    codexHome,
    timeoutMs,
    run: async (call) => {
      const before = summarizePlugin(
        await call("plugin/list", { cwds: [cwd] }),
        pluginName
      );
      if (!before.found) fail("codex_plugin_not_discovered");
      if (!before.installed) {
        await call("plugin/install", {
          marketplacePath,
          pluginName
        });
      }
      const after = summarizePlugin(
        await call("plugin/list", { cwds: [cwd] }),
        pluginName
      );
      if (!after.installed || !after.enabled) fail("codex_plugin_activation_failed");
      const hookResult = await call("hooks/list", { cwds: [cwd] });
      return {
        before,
        plugin: after,
        hooks: summarizeHooks(hookResult, after.plugin_id)
      };
    }
  });
  const uninstall = (pluginId) => withAppServer({
    codexExecutable,
    cwd,
    codexHome,
    timeoutMs,
    run: async (call) => {
      await call("plugin/uninstall", { pluginId });
      const after = summarizePlugin(
        await call("plugin/list", { cwds: [cwd] }),
        pluginName
      );
      return { plugin: after };
    }
  });
  return { inspect, install, uninstall };
}

export function createLaunchctlController({
  spawnSyncImpl = spawnSync,
  uid = typeof process.getuid === "function" ? process.getuid() : null
} = {}) {
  if (!Number.isInteger(uid) || uid < 0) fail("launchctl_uid_unavailable");
  const domain = `gui/${uid}`;
  const status = (label) => {
    const result = spawnSyncImpl("launchctl", ["print", `${domain}/${label}`], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"]
    });
    return { loaded: result.status === 0 };
  };
  const install = ({ label, plistPath }) => {
    if (status(label).loaded) {
      spawnSyncImpl("launchctl", ["bootout", `${domain}/${label}`], {
        encoding: "utf8",
        stdio: ["ignore", "ignore", "ignore"]
      });
    }
    const bootstrap = spawnSyncImpl("launchctl", ["bootstrap", domain, plistPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (bootstrap.status !== 0) fail("launch_agent_bootstrap_failed");
    const kickstart = spawnSyncImpl(
      "launchctl",
      ["kickstart", "-k", `${domain}/${label}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    if (kickstart.status !== 0) fail("launch_agent_kickstart_failed");
    return status(label);
  };
  const uninstall = ({ label }) => {
    if (!status(label).loaded) return { loaded: false };
    const result = spawnSyncImpl("launchctl", ["bootout", `${domain}/${label}`], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"]
    });
    if (result.status !== 0) fail("launch_agent_bootout_failed");
    return { loaded: false };
  };
  return { status, install, uninstall };
}

async function defaultDaemonHealth({ endpoint, tokenFile, fetchImpl = globalThis.fetch }) {
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetchImpl(`${endpoint.replace(/\/+$/, "")}/health`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(750)
      });
      if (response.ok && (await response.json())?.status === "ready") return { ready: true };
    } catch {
      // LaunchAgent startup is asynchronous. Retry for a bounded interval.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { ready: false };
}

function ensureSecret(filePath, bytes, encoding = null) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
      fail("deployment_secret_insecure", { kind: path.basename(filePath) });
    }
    return { created: false };
  }
  const value = crypto.randomBytes(bytes);
  writeFileAtomic(
    filePath,
    encoding === "hex" ? `${value.toString("hex")}\n` : value,
    0o600
  );
  return { created: true };
}

function parseDaemonEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    fail("daemon_endpoint_invalid");
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    fail("daemon_endpoint_invalid");
  }
  const port = Number(url.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail("daemon_endpoint_invalid");
  }
  return { url, port };
}

function executableVersion(executable, spawnSyncImpl) {
  const result = spawnSyncImpl(executable, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return result.status === 0
    ? result.stdout.trim().split(/\r?\n/)[0]
    : null;
}

export function createCodexDesktopDeployment({
  codexHome,
  projectRoot,
  pluginSource,
  vaultRoot,
  runtimeRoot,
  keyFile,
  tokenFile,
  hookScript,
  mcpScript,
  daemonScript,
  nodePath = process.execPath,
  codexExecutable,
  installBackupsRoot,
  desktopBackupsRoot,
  launchAgentPath,
  launchAgentLabel = "com.supermemory.codex-daemon",
  daemonEndpoint = "http://127.0.0.1:8765",
  projectName = "SuperMemory",
  adoptLegacyWorkspace = false,
  appServerController = null,
  launchctlController = null,
  daemonHealth = defaultDaemonHealth,
  spawnSyncImpl = spawnSync,
  clock = () => new Date().toISOString()
} = {}) {
  const home = path.resolve(codexHome);
  const project = fs.realpathSync(path.resolve(projectRoot));
  const plugin = fs.realpathSync(path.resolve(pluginSource));
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const runtime = path.resolve(runtimeRoot);
  const key = path.resolve(keyFile);
  const token = path.resolve(tokenFile);
  const hook = path.resolve(hookScript);
  const mcp = path.resolve(mcpScript);
  const daemon = path.resolve(daemonScript);
  const node = path.resolve(nodePath);
  const codex = path.resolve(codexExecutable);
  const installBackups = path.resolve(installBackupsRoot);
  const desktopBackups = path.resolve(desktopBackupsRoot);
  const agentPath = path.resolve(launchAgentPath);
  const configPath = path.join(home, "config.toml");
  const marketplacePath = path.join(project, ".agents", "plugins", "marketplace.json");
  if (isInside(vault, installBackups) || isInside(vault, desktopBackups)) {
    fail("deployment_backups_inside_vault");
  }
  if (isInside(vault, runtime)) fail("deployment_runtime_inside_vault");
  const { url: daemonUrl, port: daemonPort } = parseDaemonEndpoint(daemonEndpoint);
  const pluginController = appServerController ?? createCodexAppServerController({
    codexExecutable: codex,
    cwd: project,
    codexHome: home,
    marketplacePath
  });
  const serviceController = launchctlController ?? createLaunchctlController();

  const installer = () => createCodexInstaller({
    codexHome: home,
    projectRoot: project,
    pluginSource: plugin,
    vaultRoot: vault,
    runtimeRoot: runtime,
    keyFile: key,
    tokenFile: token,
    hookScript: hook,
    mcpScript: mcp,
    backupsRoot: installBackups,
    daemonEndpoint: daemonUrl.toString().replace(/\/+$/, ""),
    nodePath: node,
    clock
  });

  const readState = async () => {
    const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const legacy = inspectLegacyCodexHooks(configText);
    const hooksFeature = inspectCodexHooksFeatureFlag(configText);
    let pluginState;
    try {
      pluginState = await pluginController.inspect();
    } catch (error) {
      pluginState = {
        unavailable: true,
        error: error?.code ?? "codex_app_server_unavailable",
        plugin: {
          found: false,
          installed: false,
          enabled: false,
          plugin_id: null
        },
        hooks: { count: 0, trusted: false, statuses: [], events: [] }
      };
    }
    let binding;
    try {
      binding = createProjectRegistry({ vaultRoot: vault }).status(project);
    } catch (error) {
      binding = { status: error?.code ?? "binding_error" };
    }
    const targets = {
      codex_config: fileFingerprint(configPath),
      launch_agent: fileFingerprint(agentPath),
      runtime: fileFingerprint(runtime),
      user_plugin: fileFingerprint(path.join(home, "plugins", "supermemory")),
      plugin_data: fileFingerprint(path.join(home, "plugin-data", "supermemory")),
      project_runtime: fileFingerprint(path.join(project, ".codex", "supermemory")),
      project_plugin: fileFingerprint(path.join(project, "plugins", "supermemory")),
      marketplace: fileFingerprint(marketplacePath)
    };
    const state = {
      codex_version: executableVersion(codex, spawnSyncImpl),
      binding_status: binding.status,
      plugin: pluginState.plugin,
      plugin_hooks: pluginState.hooks,
      app_server_available: !pluginState.unavailable,
      app_server_error: pluginState.error ?? null,
      legacy: {
        hook_count: legacy.legacy_hook_count,
        group_count: legacy.legacy_group_count,
        state_count: legacy.legacy_state_count,
        events: legacy.events,
        command_fingerprints: legacy.command_fingerprints
      },
      hooks_feature: {
        canonical_present: hooksFeature.canonical_present,
        canonical_enabled: hooksFeature.canonical_enabled,
        deprecated_alias_present: hooksFeature.deprecated_alias_present,
        deprecated_alias_count: hooksFeature.deprecated_alias_count,
        effective_enabled: hooksFeature.effective_enabled
      },
      launch_agent_loaded: serviceController.status(launchAgentLabel).loaded,
      inputs: {
        plugin_source: fileFingerprint(plugin),
        hook_script: fileFingerprint(hook),
        mcp_script: fileFingerprint(mcp),
        daemon_script: fileFingerprint(daemon)
      },
      targets
    };
    return { ...state, source_state_hash: hashJson(state) };
  };

  const plan = async () => {
    const state = await readState();
    const allowedBindingStates = new Set(["bound", "unbound", "legacy_unbound"]);
    const blockers = [];
    if (!state.codex_version) blockers.push("codex_desktop_runtime_unavailable");
    if (!state.app_server_available) blockers.push("codex_app_server_unavailable");
    if (!allowedBindingStates.has(state.binding_status)) {
      blockers.push(`project_binding_${state.binding_status}`);
    }
    if (state.binding_status === "legacy_unbound" && !adoptLegacyWorkspace) {
      blockers.push("legacy_workspace_adoption_not_confirmed");
    }
    if (state.plugin.installed || state.plugin.enabled) {
      blockers.push("supermemory_plugin_already_active");
    }
    const body = {
      schema: PLAN_SCHEMA,
      generated_at: clock(),
      mode: "plan",
      writes_performed: false,
      source_state_hash: state.source_state_hash,
      scope_fingerprints: {
        codex_home: sha256(home),
        project_root: sha256(project),
        plugin_source: sha256(plugin),
        vault_root: sha256(vault),
        runtime_root: sha256(runtime),
        launch_agent: sha256(agentPath)
      },
      observed: state,
      actions: {
        backup_before_mutation: true,
        bind_project: state.binding_status !== "bound",
        adopt_legacy_workspace: Boolean(adoptLegacyWorkspace),
        remove_legacy_codex_hooks: state.legacy.hook_count,
        migrate_hooks_feature_flag: (
          !state.hooks_feature.canonical_enabled ||
          state.hooks_feature.deprecated_alias_count > 0
        ),
        preserve_claude_hooks: true,
        bootstrap_private_secrets: true,
        install_plugin: true,
        install_launch_agent: true,
        daemon_loopback_only: true,
        trust_plugin_hooks_automatically: false
      },
      blockers,
      ready_to_apply: blockers.length === 0,
      confirmation: null
    };
    const result = { ...body, plan_hash: planHash(body) };
    result.confirmation = `DEPLOY ${result.plan_hash}`;
    return result;
  };

  const rollbackSnapshots = (snapshots, backupRoot) => {
    for (const entry of [...snapshots].reverse()) restoreSnapshot(entry, backupRoot);
  };

  const apply = async (installPlan, { confirmation } = {}) => {
    if (installPlan?.schema !== PLAN_SCHEMA || planHash(installPlan) !== installPlan.plan_hash) {
      fail("desktop_plan_tampered");
    }
    if (confirmation !== `DEPLOY ${installPlan.plan_hash}`) fail("exact_confirmation_required");
    if (!installPlan.ready_to_apply || installPlan.blockers.length > 0) {
      fail("desktop_plan_blocked", { blockers: installPlan.blockers });
    }
    const current = await readState();
    if (current.source_state_hash !== installPlan.source_state_hash) {
      fail("desktop_plan_stale");
    }
    const installId = `desktop_${installPlan.plan_hash.slice("sha256:".length, 30)}`;
    const backupRoot = path.join(desktopBackups, installId);
    if (fs.existsSync(backupRoot)) fail("desktop_backup_exists");
    fs.mkdirSync(path.join(backupRoot, "targets"), { recursive: true, mode: 0o700 });
    const snapshots = [
      snapshotTarget(configPath, backupRoot, "codex-config"),
      snapshotTarget(agentPath, backupRoot, "launch-agent"),
      snapshotTarget(runtime, backupRoot, "runtime")
    ];
    const backupIndex = { schema: "supermemory.desktop-backup-index.v1", snapshots };
    writeJsonAtomic(path.join(backupRoot, "backup-index.json"), backupIndex);
    let installerManifest = null;
    let installedPlugin = null;
    let serviceTouched = false;
    let binding = null;
    try {
      fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
      fs.chmodSync(runtime, 0o700);
      fs.mkdirSync(path.join(runtime, "logs"), { recursive: true, mode: 0o700 });
      const keyResult = ensureSecret(key, 32);
      const tokenResult = ensureSecret(token, 32, "hex");

      if (fs.existsSync(configPath)) {
        const beforeConfig = fs.readFileSync(configPath, "utf8");
        if (sha256(beforeConfig) !== installPlan.observed.targets.codex_config.sha256) {
          fail("desktop_config_changed");
        }
        const cutover = removeLegacyCodexHooks(beforeConfig);
        if (cutover.legacy_hook_count !== installPlan.observed.legacy.hook_count) {
          fail("legacy_hook_count_changed");
        }
        const featureMigration = migrateCodexHooksFeatureFlag(cutover.text);
        if (cutover.changed || featureMigration.changed) {
          writeFileAtomic(configPath, featureMigration.text, 0o600);
        }
      } else if (installPlan.observed.legacy.hook_count > 0) {
        fail("legacy_hook_source_missing");
      }

      const registry = createProjectRegistry({ vaultRoot: vault });
      const status = registry.status(project);
      binding = status.status === "bound"
        ? status
        : registry.initProject({
          projectRoot: project,
          displayName: projectName,
          adoptLegacyWorkspace: Boolean(adoptLegacyWorkspace)
        });

      const installPlanInner = installer().plan();
      if (installPlanInner.checks.duplicate_hook_count > 0) {
        fail("duplicate_supermemory_hooks_detected");
      }
      installerManifest = installer().apply(installPlanInner, {
        confirmation: `APPLY ${installPlanInner.plan_hash}`
      });

      const plist = createSuperMemoryLaunchAgentPlist({
        label: launchAgentLabel,
        nodePath: node,
        daemonScript: daemon,
        projectRoot: project,
        vaultRoot: vault,
        keyFile: key,
        tokenFile: token,
        runtimeRoot: runtime,
        host: daemonUrl.hostname === "[::1]" ? "::1" : daemonUrl.hostname,
        port: daemonPort
      });
      writeFileAtomic(agentPath, plist, 0o644);
      serviceTouched = true;
      const launchStatus = serviceController.install({
        label: launchAgentLabel,
        plistPath: agentPath
      });
      if (!launchStatus.loaded) fail("launch_agent_not_loaded");
      const health = await daemonHealth({
        endpoint: daemonUrl.toString().replace(/\/+$/, ""),
        tokenFile: token
      });
      if (!health?.ready) fail("supermemory_daemon_not_ready");

      installedPlugin = await pluginController.install();
      if (!installedPlugin.plugin?.installed || !installedPlugin.plugin?.enabled) {
        fail("codex_plugin_activation_failed");
      }
      const postState = await readState();
      const manifest = {
        schema: MANIFEST_SCHEMA,
        install_id: installId,
        applied_at: clock(),
        plan_hash: installPlan.plan_hash,
        backup_root: backupRoot,
        backup_index: "backup-index.json",
        snapshots,
        installer_manifest: installerManifest,
        plugin_before: installedPlugin.before,
        plugin_after: installedPlugin.plugin,
        plugin_hooks: installedPlugin.hooks,
        binding: {
          status: "bound",
          project_id: binding.projectId,
          workspace_id: binding.workspaceId,
          checkout_id: binding.checkoutId,
          preserved_on_rollback: true
        },
        secrets: {
          key_created: keyResult.created,
          token_created: tokenResult.created,
          values_recorded: false
        },
        launch_agent: {
          label: launchAgentLabel,
          loaded: true,
          loopback_only: true
        },
        trust: {
          automatically_granted: false,
          required: !installedPlugin.hooks?.trusted,
          status: installedPlugin.hooks?.statuses ?? []
        },
        post_apply_state_hash: postState.source_state_hash,
        post_apply_targets: postState.targets,
        vault_preserved: true,
        rollback_confirmation: `ROLLBACK ${installId}`
      };
      const manifestPath = path.join(backupRoot, "manifest.json");
      writeJsonAtomic(manifestPath, manifest);
      return {
        status: manifest.trust.required ? "installed_trust_required" : "installed",
        install_id: installId,
        manifest_path: manifestPath,
        backup_verified: snapshots.every((entry) => (
          !entry.existed || fileFingerprint(path.join(backupRoot, entry.backup)).sha256 ===
            entry.fingerprint.sha256
        )),
        plugin_installed: true,
        plugin_enabled: true,
        hook_trust_required: manifest.trust.required,
        daemon_ready: true,
        project_bound: true,
        legacy_codex_hooks_active: 0,
        hooks_feature_canonical: true,
        vault_preserved: true,
        rollback_confirmation: manifest.rollback_confirmation
      };
    } catch (error) {
      let pluginToRemove = installedPlugin?.plugin ?? null;
      if (!pluginToRemove) {
        const observedAfterFailure = await pluginController.inspect().catch(() => null);
        pluginToRemove = observedAfterFailure?.plugin ?? null;
      }
      if (pluginToRemove?.installed && !installPlan.observed.plugin?.installed) {
        await pluginController.uninstall(pluginToRemove.plugin_id).catch(() => {});
      }
      if (serviceTouched) {
        try {
          serviceController.uninstall({ label: launchAgentLabel });
        } catch {
          // Continue restoring filesystem state; surface the original failure.
        }
      }
      if (installerManifest) {
        installer().rollback(installerManifest, {
          confirmation: `ROLLBACK ${installerManifest.install_id}`
        });
      }
      rollbackSnapshots(snapshots, backupRoot);
      const previousAgent = snapshots.find((entry) => entry.id === "launch-agent");
      if (previousAgent?.existed && installPlan.observed.launch_agent_loaded) {
        try {
          serviceController.install({ label: launchAgentLabel, plistPath: agentPath });
        } catch {
          // The pre-image remains restored even if launchctl cannot reload it.
        }
      }
      throw error;
    }
  };

  const rollback = async (manifest, { confirmation } = {}) => {
    if (manifest?.schema !== MANIFEST_SCHEMA) fail("desktop_manifest_invalid");
    if (confirmation !== `ROLLBACK ${manifest.install_id}`) fail("exact_confirmation_required");
    const backupRoot = path.resolve(manifest.backup_root);
    if (!backupRoot.startsWith(`${desktopBackups}${path.sep}`)) {
      fail("desktop_backup_scope_invalid");
    }
    const stored = JSON.parse(fs.readFileSync(path.join(backupRoot, "manifest.json"), "utf8"));
    if (hashJson(stored) !== hashJson(manifest)) fail("desktop_manifest_tampered");
    const backupIndex = JSON.parse(
      fs.readFileSync(path.join(backupRoot, manifest.backup_index), "utf8")
    );
    for (const entry of backupIndex.snapshots) {
      if (entry.existed) {
        const backup = path.join(backupRoot, entry.backup);
        if (fileFingerprint(backup).sha256 !== entry.fingerprint.sha256) {
          fail("desktop_backup_tampered", { id: entry.id });
        }
      }
    }
    for (const id of ["codex-config", "launch-agent"]) {
      const entry = backupIndex.snapshots.find((item) => item.id === id);
      const targetKey = id === "codex-config" ? "codex_config" : "launch_agent";
      const expected = manifest.post_apply_targets?.[targetKey];
      if (entry && expected && hashJson(fileFingerprint(entry.target)) !== hashJson(expected)) {
        fail("rollback_target_changed", { id });
      }
    }
    const currentRuntimeSafety = path.join(backupRoot, "post-apply-runtime-safety");
    if (fs.existsSync(runtime) && !fs.existsSync(currentRuntimeSafety)) {
      fs.cpSync(runtime, currentRuntimeSafety, { recursive: true, dereference: false });
    }
    if (manifest.plugin_after?.installed && !manifest.plugin_before?.installed) {
      await pluginController.uninstall(manifest.plugin_after.plugin_id);
    }
    serviceController.uninstall({ label: launchAgentLabel });
    installer().rollback(manifest.installer_manifest, {
      confirmation: `ROLLBACK ${manifest.installer_manifest.install_id}`
    });
    rollbackSnapshots(backupIndex.snapshots, backupRoot);
    if (backupIndex.snapshots.find((entry) => (
      entry.id === "launch-agent" && entry.existed
    ))) {
      serviceController.install({ label: launchAgentLabel, plistPath: agentPath });
    }
    const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    return {
      status: "rolled_back",
      install_id: manifest.install_id,
      profile_restored: fileFingerprint(configPath).sha256 ===
        installPlanFingerprint(manifest, "codex-config"),
      previous_launch_agent_restored: Boolean(
        backupIndex.snapshots.find((entry) => entry.id === "launch-agent" && entry.existed)
      ),
      runtime_safety_copy: fs.existsSync(currentRuntimeSafety),
      binding_preserved: true,
      vault_preserved: fs.existsSync(vault),
      legacy_codex_hooks_active: inspectLegacyCodexHooks(configText).legacy_hook_count
    };
  };

  const hooksFeaturePlan = () => {
    const fingerprint = fileFingerprint(configPath);
    if (!fingerprint.exists || fingerprint.type !== "file") {
      fail("codex_config_missing");
    }
    const configText = fs.readFileSync(configPath, "utf8");
    const inspected = inspectCodexHooksFeatureFlag(configText);
    const migration = migrateCodexHooksFeatureFlag(configText);
    const body = {
      schema: FEATURE_PLAN_SCHEMA,
      generated_at: clock(),
      mode: "plan",
      writes_performed: false,
      scope_fingerprint: sha256(configPath),
      observed: {
        codex_config: fingerprint,
        hooks_feature: {
          canonical_present: inspected.canonical_present,
          canonical_enabled: inspected.canonical_enabled,
          deprecated_alias_present: inspected.deprecated_alias_present,
          deprecated_alias_count: inspected.deprecated_alias_count,
          effective_enabled: inspected.effective_enabled
        }
      },
      actions: {
        backup_before_mutation: migration.changed,
        replace_deprecated_alias: inspected.deprecated_alias_present,
        enable_canonical_hooks: !inspected.canonical_enabled,
        preserve_unrelated_config: true
      },
      blockers: [],
      ready_to_apply: migration.changed,
      confirmation: null
    };
    const result = { ...body, plan_hash: planHash(body) };
    result.confirmation = migration.changed ? `MIGRATE ${result.plan_hash}` : null;
    return result;
  };

  const applyHooksFeatureMigration = (migrationPlan, { confirmation } = {}) => {
    if (migrationPlan?.schema !== FEATURE_PLAN_SCHEMA ||
        planHash(migrationPlan) !== migrationPlan.plan_hash) {
      fail("hooks_feature_plan_tampered");
    }
    if (confirmation !== `MIGRATE ${migrationPlan.plan_hash}`) {
      fail("exact_confirmation_required");
    }
    if (!migrationPlan.ready_to_apply || migrationPlan.blockers.length > 0) {
      fail("hooks_feature_plan_blocked", { blockers: migrationPlan.blockers });
    }
    const currentFingerprint = fileFingerprint(configPath);
    if (hashJson(currentFingerprint) !== hashJson(migrationPlan.observed.codex_config)) {
      fail("hooks_feature_plan_stale");
    }
    const beforeConfig = fs.readFileSync(configPath, "utf8");
    const migration = migrateCodexHooksFeatureFlag(beforeConfig);
    if (!migration.changed) fail("hooks_feature_migration_not_needed");
    const migrationId = `hooks_feature_${migrationPlan.plan_hash.slice("sha256:".length, 30)}`;
    const backupRoot = path.join(desktopBackups, migrationId);
    if (fs.existsSync(backupRoot)) fail("desktop_backup_exists");
    fs.mkdirSync(path.join(backupRoot, "targets"), { recursive: true, mode: 0o700 });
    const snapshot = snapshotTarget(configPath, backupRoot, "codex-config");
    const backupIndex = {
      schema: "supermemory.desktop-backup-index.v1",
      snapshots: [snapshot]
    };
    writeJsonAtomic(path.join(backupRoot, "backup-index.json"), backupIndex);
    try {
      const backupFingerprint = fileFingerprint(path.join(backupRoot, snapshot.backup));
      if (backupFingerprint.sha256 !== snapshot.fingerprint.sha256) {
        fail("desktop_backup_tampered", { id: snapshot.id });
      }
      writeFileAtomic(configPath, migration.text, 0o600);
      const afterText = fs.readFileSync(configPath, "utf8");
      const after = inspectCodexHooksFeatureFlag(afterText);
      if (!after.canonical_enabled || after.deprecated_alias_count !== 0) {
        fail("codex_hooks_feature_migration_incomplete");
      }
      const manifest = {
        schema: FEATURE_MANIFEST_SCHEMA,
        migration_id: migrationId,
        applied_at: clock(),
        plan_hash: migrationPlan.plan_hash,
        backup_root: backupRoot,
        backup_index: "backup-index.json",
        snapshots: [snapshot],
        before: migrationPlan.observed.hooks_feature,
        after: {
          canonical_present: after.canonical_present,
          canonical_enabled: after.canonical_enabled,
          deprecated_alias_present: after.deprecated_alias_present,
          deprecated_alias_count: after.deprecated_alias_count,
          effective_enabled: after.effective_enabled
        },
        post_apply_target: fileFingerprint(configPath),
        rollback_confirmation: `ROLLBACK ${migrationId}`
      };
      const manifestPath = path.join(backupRoot, "manifest.json");
      writeJsonAtomic(manifestPath, manifest);
      return {
        status: "migrated",
        migration_id: migrationId,
        manifest_path: manifestPath,
        backup_verified: true,
        hooks_feature_canonical: true,
        deprecated_alias_active: false,
        rollback_confirmation: manifest.rollback_confirmation
      };
    } catch (error) {
      restoreSnapshot(snapshot, backupRoot);
      throw error;
    }
  };

  const rollbackHooksFeatureMigration = (manifest, { confirmation } = {}) => {
    if (manifest?.schema !== FEATURE_MANIFEST_SCHEMA) {
      fail("hooks_feature_manifest_invalid");
    }
    if (confirmation !== `ROLLBACK ${manifest.migration_id}`) {
      fail("exact_confirmation_required");
    }
    const backupRoot = path.resolve(manifest.backup_root);
    if (!backupRoot.startsWith(`${desktopBackups}${path.sep}`)) {
      fail("desktop_backup_scope_invalid");
    }
    const stored = JSON.parse(fs.readFileSync(path.join(backupRoot, "manifest.json"), "utf8"));
    if (hashJson(stored) !== hashJson(manifest)) fail("hooks_feature_manifest_tampered");
    const backupIndex = JSON.parse(
      fs.readFileSync(path.join(backupRoot, manifest.backup_index), "utf8")
    );
    const snapshot = backupIndex.snapshots.find((entry) => entry.id === "codex-config");
    if (!snapshot?.existed) fail("hooks_feature_backup_invalid");
    const backup = path.join(backupRoot, snapshot.backup);
    if (fileFingerprint(backup).sha256 !== snapshot.fingerprint.sha256) {
      fail("desktop_backup_tampered", { id: snapshot.id });
    }
    if (hashJson(fileFingerprint(configPath)) !== hashJson(manifest.post_apply_target)) {
      fail("rollback_target_changed", { id: snapshot.id });
    }
    restoreSnapshot(snapshot, backupRoot);
    return {
      status: "rolled_back",
      migration_id: manifest.migration_id,
      profile_restored: fileFingerprint(configPath).sha256 === snapshot.fingerprint.sha256
    };
  };

  const status = async () => {
    const state = await readState();
    let daemonReady = false;
    if (fs.existsSync(token)) {
      daemonReady = Boolean((await daemonHealth({
        endpoint: daemonUrl.toString().replace(/\/+$/, ""),
        tokenFile: token
      })).ready);
    }
    return {
      schema: "supermemory.codex-desktop-status.v1",
      generated_at: clock(),
      ready: (
        state.binding_status === "bound" &&
        state.plugin.installed &&
        state.plugin.enabled &&
        state.plugin_hooks.trusted &&
        state.legacy.hook_count === 0 &&
        state.hooks_feature.canonical_enabled &&
        state.hooks_feature.deprecated_alias_count === 0 &&
        state.launch_agent_loaded &&
        daemonReady
      ),
      binding: state.binding_status,
      plugin: state.plugin,
      hooks: state.plugin_hooks,
      hooks_feature: state.hooks_feature,
      legacy_codex_hooks_active: state.legacy.hook_count,
      launch_agent_loaded: state.launch_agent_loaded,
      daemon_ready: daemonReady,
      codex_version: state.codex_version,
      cloud_web_coverage: "none",
      remote_host_coverage: "requires_separate_host_install"
    };
  };

  return {
    plan,
    apply,
    rollback,
    hooksFeaturePlan,
    applyHooksFeatureMigration,
    rollbackHooksFeatureMigration,
    status,
    readState
  };
}

function installPlanFingerprint(manifest, id) {
  return manifest.snapshots.find((entry) => entry.id === id)?.fingerprint?.sha256 ?? null;
}
