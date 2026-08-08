import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCodexHookAdapter,
  diagnoseCodexHookCoverage,
  SUPERMEMORY_HOOK_EVENTS
} from "../scripts/lib/codex-hook-adapter.mjs";
import { payloadHash } from "../scripts/lib/codex-event-envelope.mjs";
import { createEventEquivalenceStore } from "../scripts/lib/codex-event-equivalence.mjs";
import { buildSessionStartContext } from "../scripts/lib/codex-session-context.mjs";
import { createCodexWorkspaceStore } from "../scripts/lib/codex-workspace-store.mjs";
import { createProjectRegistry } from "../scripts/lib/project-registry.mjs";

const pluginRoot = path.resolve("plugins/supermemory");
const pluginManifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const pluginHooksPath = path.join(pluginRoot, "hooks", "hooks.json");
const pluginHookScript = path.join(pluginRoot, "scripts", "hook.mjs");
const productHookScript = path.resolve("scripts/supermemory-hook.mjs");
const STATE_KEY = Buffer.alloc(32, 0x33);
const BINDING = {
  projectId: "prj_018f1234-5678-7abc-8def-0123456789ab",
  workspaceId: "ws_018f1234-5678-7abc-8def-0123456789ac",
  checkoutId: "co_018f1234-5678-7abc-8def-0123456789ad"
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-hook-"));
  const runtime = path.join(root, "runtime");
  const vault = path.join(root, "vault");
  const project = path.join(root, "project");
  const codexHome = path.join(root, "codex-home");
  fs.mkdirSync(runtime);
  fs.mkdirSync(vault);
  fs.mkdirSync(project);
  fs.mkdirSync(codexHome);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, runtime, vault, project, codexHome };
}

function hookInput(eventName, overrides = {}) {
  return {
    session_id: "thr_fixture_session",
    transcript_path: "/unreadable/transcript-format-is-not-an-api.jsonl",
    cwd: "/fixture/project",
    hook_event_name: eventName,
    model: "gpt-fixture",
    permission_mode: "default",
    turn_id: "turn_fixture",
    ...overrides
  };
}

function runHook(script, input, {
  cwd,
  env = {},
  args = []
} = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 4_000
  });
}

test("repo-local plugin manifest and hooks follow the current Codex contract", () => {
  const manifest = JSON.parse(fs.readFileSync(pluginManifestPath, "utf8"));
  const config = JSON.parse(fs.readFileSync(pluginHooksPath, "utf8"));
  assert.equal(manifest.name, path.basename(pluginRoot));
  assert.equal(manifest.hooks, "./hooks/hooks.json");
  assert.equal(manifest.interface.displayName, "SuperMemory");
  assert.deepEqual(Object.keys(config.hooks).sort(), [...SUPERMEMORY_HOOK_EVENTS].sort());

  for (const [eventName, groups] of Object.entries(config.hooks)) {
    assert.ok(Array.isArray(groups) && groups.length > 0);
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.equal(hook.type, "command");
        assert.match(hook.command, /\$\{PLUGIN_ROOT\}/);
        assert.equal(path.isAbsolute(hook.command), false);
        assert.ok(hook.timeout <= (eventName === "SessionEnd" ? 3 : 2));
      }
    }
  }
  const source = fs.readFileSync(pluginHooksPath, "utf8");
  assert.equal(source.includes("/Users/"), false);
  assert.equal(source.includes(".codex/config.toml"), false);
});

test("coverage diagnostics detect duplicate handlers and never claim rich hook coverage", () => {
  const config = JSON.parse(fs.readFileSync(pluginHooksPath, "utf8"));
  const healthy = diagnoseCodexHookCoverage({
    sources: [{ source: "plugin:supermemory", config }],
    captureMode: "hooks_primary"
  });
  assert.equal(healthy.status, "ok");
  assert.equal(healthy.coverage, "partial");
  assert.equal(healthy.hostedActionsVisible, false);
  assert.deepEqual(healthy.missing, []);
  assert.deepEqual(healthy.duplicates, []);

  const duplicate = diagnoseCodexHookCoverage({
    sources: [
      { source: "plugin:supermemory", config },
      { source: "project:.codex/hooks.json", config }
    ],
    captureMode: "hooks_primary"
  });
  assert.equal(duplicate.status, "error");
  assert.deepEqual(duplicate.duplicates.sort(), [...SUPERMEMORY_HOOK_EVENTS].sort());
});

test("session binding keeps mode and sequence stable across retries and config drift", async (t) => {
  const { runtime } = fixture(t);
  const captured = [];
  const primary = createCodexHookAdapter({
    runtimeRoot: runtime,
    stateKey: STATE_KEY,
    binding: BINDING,
    captureMode: "hooks_primary",
    capture: async (event) => {
      captured.push(event);
      return { status: "delivered", durable: true };
    },
    clock: () => "2026-07-24T14:00:00.000Z"
  });
  const input = hookInput("SessionStart", { source: "startup" });
  const first = await primary.handle(input);
  const retry = await primary.handle(input);
  assert.equal(first.sequence, 0);
  assert.equal(retry.sequence, 0);
  assert.equal(captured[0].external_event_id, captured[1].external_event_id);
  assert.equal(first.captureRole, "primary");
  assert.equal(first.coverage, "partial");
  assert.equal(first.transcriptSchema, "unparsed");

  const driftedConfig = createCodexHookAdapter({
    runtimeRoot: runtime,
    stateKey: STATE_KEY,
    binding: BINDING,
    captureMode: "app_server_primary",
    capture: async (event) => {
      captured.push(event);
      return { status: "delivered", durable: true };
    },
    clock: () => "2026-07-24T14:00:00.000Z"
  });
  const afterDrift = await driftedConfig.handle(input);
  assert.equal(afterDrift.modeMismatch, true);
  assert.equal(afterDrift.captureMode, "hooks_primary");
  assert.equal(afterDrift.captureRole, "primary");
  assert.equal(afterDrift.sequence, 0);
  assert.equal(captured[2].external_event_id, captured[0].external_event_id);

  const shadow = await driftedConfig.handle(hookInput("SessionStart", {
    session_id: "thr_new_shadow_session",
    source: "startup"
  }));
  assert.equal(shadow.captureMode, "app_server_primary");
  assert.equal(shadow.captureRole, "shadow");
});

test("shadow hook observations join App Server equivalence without applying a second effect", async (t) => {
  const { runtime, vault } = fixture(t);
  const equivalenceStore = createEventEquivalenceStore({
    vaultRoot: vault,
    clock: () => "2026-07-24T14:00:00.000Z"
  });
  const hookEventId = `evt_${"8".repeat(64)}`;
  const appEventId = `evt_${"9".repeat(64)}`;
  const adapter = createCodexHookAdapter({
    runtimeRoot: runtime,
    stateKey: STATE_KEY,
    binding: BINDING,
    captureMode: "app_server_primary",
    equivalenceStore,
    capture: async () => ({
      status: "delivered",
      durable: true,
      eventId: hookEventId
    }),
    clock: () => "2026-07-24T14:00:00.000Z"
  });
  const handled = await adapter.handle(hookInput("UserPromptSubmit", {
    prompt: "Remember the approved architecture."
  }));
  assert.equal(handled.captureRole, "shadow");
  assert.equal(handled.equivalence.appliesEffect, false);

  const normalizedPayloadHash = payloadHash({
    item_type: "userMessage",
    authoritative: true,
    content: "Remember the approved architecture."
  });
  const app = equivalenceStore.recordObservation({
    workspaceId: BINDING.workspaceId,
    sessionId: "thr_fixture_session",
    canonicalTurnId: "turn_fixture",
    eventSlot: "prompt.submitted",
    normalizedPayloadHash,
    eventId: appEventId,
    adapter: "app_server",
    sequence: 0
  });
  assert.equal(app.logicalEventId, handled.equivalence.logicalEventId);
  assert.equal(app.appliesEffect, true);
  const logical = equivalenceStore.snapshot().logicalEvents[0];
  assert.equal(logical.observations.length, 2);
  assert.equal(logical.appliedEventId, appEventId);
});

test("all supported hooks map to bounded observations and event-safe outputs", async (t) => {
  const { runtime } = fixture(t);
  const captured = [];
  const adapter = createCodexHookAdapter({
    runtimeRoot: runtime,
    stateKey: STATE_KEY,
    binding: BINDING,
    captureMode: "hooks_primary",
    maxPayloadBytes: 256,
    capture: async (event) => {
      captured.push(event);
      return { status: "spooled", durable: true };
    },
    clock: () => "2026-07-24T14:00:00.000Z"
  });
  const inputs = [
    hookInput("SessionStart", { source: "resume" }),
    hookInput("UserPromptSubmit", { prompt: "p".repeat(2_000) }),
    hookInput("PostToolUse", {
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "true" },
      tool_response: { output: "x".repeat(2_000) }
    }),
    hookInput("PreCompact", { trigger: "auto" }),
    hookInput("PostCompact", { trigger: "auto" }),
    hookInput("Stop", {
      stop_hook_active: false,
      last_assistant_message: "done"
    }),
    hookInput("SessionEnd", { reason: "other" })
  ];
  const expectedTypes = [
    "session.started",
    "prompt.submitted",
    "tool.completed",
    "context.compacted",
    "context.compacted",
    "assistant.completed",
    "session.ended"
  ];
  for (const input of inputs) {
    const result = await adapter.handle(input);
    assert.equal(result.captured, true);
    if (input.hook_event_name === "SessionEnd") assert.equal(result.output, null);
    else assert.equal(result.output.continue, true);
  }
  assert.deepEqual(captured.map((event) => event.event_type), expectedTypes);
  assert.deepEqual(captured.map((event) => event.sequence), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(captured.some((event) => JSON.stringify(event).includes("/unreadable/")), false);
  assert.equal(captured[2].payload.tool_response.truncated, true);
  assert.equal(captured.every((event) => event.payload.transcript === "unparsed"), true);
});

test("SessionStart context is cited, filtered and strictly budgeted", () => {
  const memories = [
    ...Array.from({ length: 7 }, (_, index) => ({
      memory_id: `mem_allowed_${index}`,
      title: `Decision ${index}`,
      text: `Approved fact ${index} ${"x".repeat(80)}`,
      status: "active",
      sensitivity: "standard",
      allowed_consumers: ["codex"],
      priority: 10 - index,
      archive: "must-never-be-injected"
    })),
    {
      memory_id: "mem_restricted",
      title: "Restricted",
      text: "classified content",
      status: "active",
      sensitivity: "restricted",
      allowed_consumers: ["codex"]
    },
    {
      memory_id: "mem_inactive",
      title: "Inactive",
      text: "obsolete",
      status: "stale",
      sensitivity: "standard",
      allowed_consumers: ["codex"]
    }
  ];
  const context = buildSessionStartContext({
    projectId: BINDING.projectId,
    workspaceId: BINDING.workspaceId,
    captureCoverage: "partial",
    daemonStatus: "ready",
    memories,
    maxMemories: 5,
    maxChars: 620,
    maxTokens: 155
  });
  assert.ok(context.chars <= 620);
  assert.ok(context.estimatedTokens <= 155);
  assert.ok(context.usedMemories <= 5);
  assert.match(context.text, /\[mem_allowed_0\]/);
  assert.equal(context.text.includes("classified content"), false);
  assert.equal(context.text.includes("must-never-be-injected"), false);
  assert.equal(context.text.includes("obsolete"), false);
});

test("WM-AC07: compact SessionStart injects the latest exact working-set map", async (t) => {
  const { runtime } = fixture(t);
  const workingSetId = "wset_018f7c0e-7b7d-7abc-8def-0123456789ad";
  let requested;
  const adapter = createCodexHookAdapter({
    runtimeRoot: runtime,
    stateKey: STATE_KEY,
    binding: BINDING,
    captureMode: "hooks_primary",
    capture: async () => ({
      status: "delivered",
      durable: true,
      working: { working_set_id: workingSetId }
    }),
    workingMapProvider: async (input) => {
      requested = input;
      return {
        status: "ready",
        additional_context: "SuperMemory Working Map\n- DATA: objectif [evidence:wev_1]",
        estimated_tokens: 20
      };
    }
  });
  const handled = await adapter.handle(hookInput("SessionStart", { source: "compact" }));
  assert.equal(requested.working_set_id, workingSetId);
  assert.match(handled.output.hookSpecificOutput.additionalContext, /Working Map/);
  assert.match(handled.output.hookSpecificOutput.additionalContext, /wev_1/);
});

test("WM-AC08/09/10: PostToolUse replaces output only with a durable reopen-verified receipt", async (t) => {
  const { runtime } = fixture(t);
  const adapter = createCodexHookAdapter({
    runtimeRoot: runtime,
    stateKey: STATE_KEY,
    binding: BINDING,
    captureMode: "hooks_primary",
    capture: async () => ({
      status: "delivered",
      durable: true,
      working: {
        offload: {
          suppress_original: true,
          replacement_enabled: true,
          replacement_text: "Sortie déchargée; ouvrir [wev_safe] avec supermemory_working_open."
        }
      }
    })
  });
  const handled = await adapter.handle(hookInput("PostToolUse", {
    tool_name: "Bash",
    tool_response: "x".repeat(60_000)
  }));
  assert.equal(handled.output.continue, false);
  assert.match(handled.output.hookSpecificOutput.additionalContext, /wev_safe/);
});

test("product hook and plugin bridge work in isolated roots and spool when daemon is down", async (t) => {
  const { root, runtime, vault, project, codexHome } = fixture(t);
  const projectRegistry = createProjectRegistry({ vaultRoot: vault });
  const binding = projectRegistry.initProject({ projectRoot: project });
  const keyFile = path.join(root, "capture.key");
  const tokenFile = path.join(root, "daemon.token");
  const runtimeConfig = path.join(root, "hook-runtime.json");
  fs.writeFileSync(keyFile, STATE_KEY, { mode: 0o600 });
  fs.writeFileSync(tokenFile, "test-bearer-value-000000000000000000000000\n", { mode: 0o600 });
  fs.writeFileSync(runtimeConfig, `${JSON.stringify({
    schema: "supermemory.hook-runtime.v1",
    vault_root: vault,
    runtime_root: runtime,
    daemon_endpoint: "http://127.0.0.1:9",
    key_file: keyFile,
    token_file: tokenFile,
    daemon_timeout_ms: 30,
    capture_mode: "hooks_primary",
    context_max_chars: 800,
    context_max_tokens: 200,
    context_max_memories: 5
  })}\n`, { mode: 0o600 });
  const memoryStore = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: binding.workspaceId,
    projectId: binding.projectId
  });
  const candidate = memoryStore.createCandidate({
    workspace_id: binding.workspaceId,
    project_id: binding.projectId,
    archive_id: "arc_018f1234-5678-7abc-8def-0123456789aa",
    event_ids: [`evt_${"a".repeat(64)}`],
    turn_snapshot_id: `tsnap_${"b".repeat(64)}`,
    source_snapshot_ids: [`snap_${"c".repeat(64)}`],
    title: "Approved runtime context",
    proposed_text: "Use the governed MCP for durable project decisions.",
    type: "decision",
    confidence: 1,
    uncertainty: "",
    sensitivity: "standard",
    extractor: { model: "fixture", prompt_version: "v1" }
  });
  const approved = await memoryStore.reviewCandidate(candidate.candidate_id, { action: "approve" });

  const direct = runHook(productHookScript, hookInput("SessionStart", {
    cwd: project,
    transcript_path: null,
    source: "startup"
  }), {
    cwd: project,
    env: {
      CODEX_HOME: codexHome,
      SUPERMEMORY_CONFIG: runtimeConfig
    }
  });
  assert.equal(direct.status, 0, direct.stderr);
  const directOutput = JSON.parse(direct.stdout);
  assert.equal(directOutput.continue, true);
  assert.match(directOutput.hookSpecificOutput.additionalContext, new RegExp(binding.projectId));
  assert.match(directOutput.hookSpecificOutput.additionalContext, new RegExp(approved.memory.memory_id));

  const pluginData = path.join(root, "plugin-data");
  fs.mkdirSync(pluginData, { mode: 0o700 });
  fs.writeFileSync(path.join(pluginData, "supermemory-plugin.json"), `${JSON.stringify({
    schema: "supermemory.plugin-runtime.v1",
    node: process.execPath,
    hook_script: productHookScript,
    runtime_config: runtimeConfig,
    timeout_ms: 1_000
  })}\n`, { mode: 0o600 });
  const bridged = runHook(pluginHookScript, hookInput("UserPromptSubmit", {
    cwd: project,
    prompt: "remember this visible prompt"
  }), {
    cwd: project,
    env: {
      CODEX_HOME: codexHome,
      PLUGIN_ROOT: pluginRoot,
      PLUGIN_DATA: pluginData
    }
  });
  assert.equal(bridged.status, 0, bridged.stderr);
  assert.deepEqual(JSON.parse(bridged.stdout), { continue: true });

  const spoolDirectory = path.join(runtime, "spool", binding.workspaceId);
  assert.equal(fs.readdirSync(spoolDirectory).filter((name) => name.endsWith(".aead")).length, 2);
  assert.equal(fs.existsSync(path.join(codexHome, "config.toml")), false);
  assert.equal(fs.existsSync(path.join(codexHome, "hooks.json")), false);
});

test("plugin bridge fails soft on missing configuration and child timeout", (t) => {
  const { root, project, codexHome } = fixture(t);
  const missing = runHook(pluginHookScript, hookInput("Stop", {
    cwd: project,
    transcript_path: null,
    last_assistant_message: "done",
    stop_hook_active: false
  }), {
    cwd: project,
    env: { CODEX_HOME: codexHome, PLUGIN_DATA: "" }
  });
  assert.equal(missing.status, 0);
  assert.deepEqual(JSON.parse(missing.stdout), { continue: true });

  const sleeper = path.join(root, "sleep-hook.mjs");
  const runtimeConfig = path.join(root, "unused.json");
  const pluginData = path.join(root, "plugin-data");
  fs.mkdirSync(pluginData);
  fs.writeFileSync(sleeper, "setTimeout(() => process.stdout.write('{\"continue\":true}\\n'), 1000);\n");
  fs.writeFileSync(runtimeConfig, "{}\n", { mode: 0o600 });
  fs.writeFileSync(path.join(pluginData, "supermemory-plugin.json"), `${JSON.stringify({
    schema: "supermemory.plugin-runtime.v1",
    node: process.execPath,
    hook_script: sleeper,
    runtime_config: runtimeConfig,
    timeout_ms: 50
  })}\n`, { mode: 0o600 });
  const started = performance.now();
  const timedOut = runHook(pluginHookScript, hookInput("UserPromptSubmit", {
    cwd: project,
    prompt: "continue even when memory is down"
  }), {
    cwd: project,
    env: {
      CODEX_HOME: codexHome,
      PLUGIN_ROOT: pluginRoot,
      PLUGIN_DATA: pluginData
    }
  });
  assert.ok(performance.now() - started < 600);
  assert.equal(timedOut.status, 0);
  assert.deepEqual(JSON.parse(timedOut.stdout), { continue: true });
});

test("plugin bridge preserves only the supported safe PostToolUse replacement contract", (t) => {
  const { root, project, codexHome } = fixture(t);
  const runtimeConfig = path.join(root, "runtime.json");
  const pluginData = path.join(root, "plugin-data");
  const safeHook = path.join(root, "safe-offload-hook.mjs");
  const unsafeHook = path.join(root, "unsafe-offload-hook.mjs");
  fs.mkdirSync(pluginData);
  fs.writeFileSync(runtimeConfig, "{}\n", { mode: 0o600 });
  fs.writeFileSync(safeHook, [
    "process.stdout.write(JSON.stringify({",
    "continue:false, stopReason:'supermemory_working_offload',",
    "hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:'Saved as working_set_id=wset_fixture; reopen with supermemory_working_open.'}",
    "})+'\\n');"
  ].join("\n"));
  fs.writeFileSync(unsafeHook, "process.stdout.write(JSON.stringify({continue:false})+'\\n');\n");

  const configure = (hookScript) => fs.writeFileSync(
    path.join(pluginData, "supermemory-plugin.json"),
    `${JSON.stringify({
      schema: "supermemory.plugin-runtime.v1",
      node: process.execPath,
      hook_script: hookScript,
      runtime_config: runtimeConfig,
      timeout_ms: 1_000
    })}\n`,
    { mode: 0o600 }
  );
  const input = hookInput("PostToolUse", { cwd: project, tool_name: "Bash" });
  const environment = {
    CODEX_HOME: codexHome,
    PLUGIN_ROOT: pluginRoot,
    PLUGIN_DATA: pluginData
  };

  configure(safeHook);
  const safe = runHook(pluginHookScript, input, { cwd: project, env: environment });
  assert.equal(safe.status, 0, safe.stderr);
  assert.deepEqual(JSON.parse(safe.stdout), {
    continue: false,
    stopReason: "supermemory_working_offload",
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: "Saved as working_set_id=wset_fixture; reopen with supermemory_working_open."
    }
  });

  configure(unsafeHook);
  const rejected = runHook(pluginHookScript, input, { cwd: project, env: environment });
  assert.equal(rejected.status, 0, rejected.stderr);
  assert.deepEqual(JSON.parse(rejected.stdout), { continue: true });
});
