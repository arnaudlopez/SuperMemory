#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createCodexCaptureStore } from "./lib/codex-capture-store.mjs";
import { createCodexInstaller } from "./lib/codex-installer.mjs";
import { createCodexLifecycle } from "./lib/codex-lifecycle.mjs";
import { createCodexMcpServer } from "./lib/codex-mcp-server.mjs";
import { createCodexMemoryGovernance } from "./lib/codex-memory-governance.mjs";
import { createCodexMemoryRecall } from "./lib/codex-memory-recall.mjs";
import { createCodexMemoryRouter } from "./lib/codex-memory-router.mjs";
import { createCodexSpool } from "./lib/codex-spool.mjs";
import { createTurnSnapshotStore } from "./lib/codex-turn-snapshot.mjs";
import { createCodexWorkingRecall } from "./lib/codex-working-recall.mjs";
import { createCodexWorkingSetStore } from "./lib/codex-working-set-store.mjs";
import { createProjectRegistry } from "./lib/project-registry.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function runChild(executable, args, { cwd, env, input, timeoutMs = 8_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Object.assign(new Error("canary_child_timeout"), { code: "canary_child_timeout" }));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        status: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
    child.stdin.end(input);
  });
}

function defaultPluginDiscovery({ codexExecutable, codexHome, projectRoot }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      codexExecutable,
      ["app-server", "--disable", "remote_plugin"],
      {
        cwd: projectRoot,
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ["pipe", "pipe", "ignore"]
      }
    );
    let response = null;
    let activationAttempted = false;
    const summarize = (message) => {
      const plugins = (message.result?.marketplaces ?? []).flatMap((marketplace) => (
        marketplace.plugins ?? []
      ));
      const plugin = plugins.find((entry) => entry.name === "supermemory");
      return {
        found: Boolean(plugin),
        installed: Boolean(plugin?.installed),
        enabled: Boolean(plugin?.enabled),
        install_policy: plugin?.installPolicy ?? null,
        activation_observed: Boolean(plugin?.installed && plugin?.enabled)
      };
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Object.assign(
        new Error("codex_app_server_canary_timeout"),
        { code: "codex_app_server_canary_timeout" }
      ));
    }, 20_000);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        child.stdin.write(`${JSON.stringify({
          id: 2,
          method: "plugin/list",
          params: { cwds: [projectRoot] }
        })}\n`);
      } else if (message.id === 2) {
        const discovered = summarize(message);
        if (!discovered.found || discovered.installed) {
          response = message;
          child.stdin.end();
          return;
        }
        activationAttempted = true;
        child.stdin.write(`${JSON.stringify({
          id: 3,
          method: "plugin/install",
          params: {
            marketplacePath: path.join(
              projectRoot,
              ".agents",
              "plugins",
              "marketplace.json"
            ),
            pluginName: "supermemory"
          }
        })}\n`);
      } else if (message.id === 3) {
        if (message.error) {
          response = message;
          child.stdin.end();
          return;
        }
        child.stdin.write(`${JSON.stringify({
          id: 4,
          method: "plugin/list",
          params: { cwds: [projectRoot] }
        })}\n`);
      } else if (message.id === 4) {
        response = message;
        child.stdin.end();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !response) {
        reject(Object.assign(
          new Error("codex_app_server_canary_failed"),
          { code: "codex_app_server_canary_failed" }
        ));
        return;
      }
      const summary = summarize(response);
      resolve({ ...summary, activation_attempted: activationAttempted });
    });
    child.stdin.write(`${JSON.stringify({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "supermemory-canary", version: "0.1.0" } }
    })}\n`);
  });
}

function assert(condition, code) {
  if (!condition) fail(code);
}

export function resolveCodexExecutable({
  explicit = process.env.SUPERMEMORY_CODEX_EXECUTABLE ?? null,
  pathValue = process.env.PATH ?? "",
  fallbacks = ["/Applications/ChatGPT.app/Contents/Resources/codex"]
} = {}) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, "codex"));
  }
  candidates.push(...fallbacks);
  const attempts = [];
  for (const candidate of [...new Set(candidates)]) {
    if (!fs.existsSync(candidate)) {
      attempts.push({ executable: candidate, status: "missing" });
      continue;
    }
    const stat = fs.lstatSync(candidate);
    if (stat.isDirectory()) {
      attempts.push({ executable: candidate, status: "invalid" });
      continue;
    }
    const version = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (version.status === 0) {
      return {
        executable: fs.realpathSync(candidate),
        version: version.stdout.trim().split(/\r?\n/)[0],
        attempts
      };
    }
    attempts.push({
      executable: candidate,
      status: "unusable",
      error: String(version.error?.code ?? version.stderr ?? "unknown").trim().slice(0, 240)
    });
  }
  const error = new Error("codex_executable_unavailable");
  error.code = "codex_executable_unavailable";
  error.attempts = attempts;
  throw error;
}

export async function runCodexIntegrationCanary({
  codexExecutable = null,
  pluginSource = path.resolve("plugins/supermemory"),
  hookScript = path.resolve("scripts/supermemory-hook.mjs"),
  mcpScript = path.resolve("scripts/supermemory-mcp.mjs"),
  discoverPlugin = defaultPluginDiscovery,
  keepArtifacts = false,
  clock = () => new Date().toISOString()
} = {}) {
  const resolvedCodex = codexExecutable
    ? resolveCodexExecutable({ explicit: codexExecutable, pathValue: "", fallbacks: [] })
    : resolveCodexExecutable();
  codexExecutable = resolvedCodex.executable;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-codex-canary-"));
  const stages = [];
  let installed = null;
  try {
    const vault = path.join(root, "vault");
    const originalProject = path.join(root, "project-original");
    const project = path.join(root, "project-moved");
    const codexHome = path.join(root, "codex-home");
    const runtime = path.join(root, "runtime");
    const installBackups = path.join(root, "install-backups");
    for (const directory of [vault, originalProject, codexHome, runtime]) {
      fs.mkdirSync(directory, { mode: 0o700 });
    }
    const gitInit = spawnSync("git", ["init", "-q", originalProject], {
      encoding: "utf8"
    });
    assert(gitInit.status === 0, "canary_git_fixture_failed");
    const registry = createProjectRegistry({ vaultRoot: vault });
    const initialized = registry.initProject({ projectRoot: originalProject });
    fs.renameSync(originalProject, project);
    const pendingMove = registry.status(project);
    assert(pendingMove.status === "moved", "canary_move_not_detected");
    registry.initProject({ projectRoot: project });
    const moved = registry.status(project);
    assert(moved.status === "bound", "canary_move_unbound");
    assert(moved.projectId === initialized.projectId, "canary_project_identity_changed");
    assert(moved.workspaceId === initialized.workspaceId, "canary_workspace_identity_changed");
    stages.push({ id: "stable_identity_after_move", status: "pass" });

    const key = crypto.randomBytes(32);
    const token = crypto.randomBytes(32).toString("hex");
    const keyFile = path.join(root, "archive.key");
    const tokenFile = path.join(root, "daemon.token");
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
    fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
    const installer = createCodexInstaller({
      codexHome,
      projectRoot: project,
      pluginSource,
      vaultRoot: vault,
      runtimeRoot: runtime,
      keyFile,
      tokenFile,
      hookScript,
      mcpScript,
      backupsRoot: installBackups,
      daemonEndpoint: "http://127.0.0.1:65530",
      clock
    });
    const installPlan = installer.plan();
    assert(installPlan.writes_performed === false, "canary_install_plan_mutated");
    installed = installer.apply(installPlan, {
      confirmation: `APPLY ${installPlan.plan_hash}`
    });
    const discovery = await discoverPlugin({
      codexExecutable,
      codexHome,
      projectRoot: project
    });
    assert(discovery.found, "canary_plugin_not_discovered");
    assert(
      discovery.activation_observed,
      "canary_plugin_not_installed"
    );
    stages.push({
      id: "reversible_install_and_codex_discovery",
      status: "pass",
      installed_by_default: discovery.install_policy === "INSTALLED_BY_DEFAULT",
      codex_activation_observed: true
    });

    const dynamicSecret = ["sk", "canary", crypto.randomBytes(12).toString("hex")].join("-");
    const hookInput = {
      session_id: "thr_canary",
      transcript_path: null,
      cwd: project,
      hook_event_name: "UserPromptSubmit",
      model: "canary-model",
      permission_mode: "default",
      turn_id: "turn_canary",
      prompt: `Use PostgreSQL for the durable decision. Credential ${dynamicSecret}`
    };
    const bridge = path.join(project, "plugins", "supermemory", "scripts", "hook.mjs");
    const bridged = await runChild(process.execPath, [bridge], {
      cwd: project,
      env: {
        CODEX_HOME: codexHome,
        PLUGIN_ROOT: path.join(project, "plugins", "supermemory"),
        PLUGIN_DATA: path.join(codexHome, "plugin-data", "supermemory")
      },
      input: JSON.stringify(hookInput)
    });
    assert(bridged.status === 0, "canary_hook_bridge_failed");
    assert(JSON.parse(bridged.stdout).continue === true, "canary_hook_output_invalid");
    const spool = createCodexSpool({
      runtimeRoot: runtime,
      workspaceId: moved.workspaceId,
      encryptionKey: key,
      clock
    });
    assert(spool.depth().entries === 1, "canary_spool_missing");
    const workingSetStore = createCodexWorkingSetStore({
      vaultRoot: vault,
      encryptionKey: key,
      clock
    });
    const captures = createCodexCaptureStore({
      vaultRoot: vault,
      encryptionKey: key,
      clock,
      workingMemory: { enabled: true },
      workingSetStore
    });
    let replayedPrepared = null;
    const replay = await spool.replay((prepared) => {
      replayedPrepared = prepared;
      return captures.ingestPrepared(prepared);
    });
    assert(replay.replayed === 1, "canary_spool_replay_failed");
    const duplicate = captures.ingestPrepared(replayedPrepared);
    assert(duplicate.status === "duplicate", "canary_replay_not_idempotent");
    const events = captures.readEvents({
      workspaceId: moved.workspaceId,
      includePayload: true
    });
    assert(events.length === 1, "canary_event_count_invalid");
    assert(!JSON.stringify(events).includes(dynamicSecret), "canary_secret_persisted");
    stages.push({
      id: "plugin_capture_spool_replay_redaction",
      status: "pass",
      logical_events: 1
    });

    const snapshots = createTurnSnapshotStore({
      vaultRoot: vault,
      fingerprintKey: key
    });
    const firstFile = snapshots.createFileSnapshot({
      workspaceId: moved.workspaceId,
      turnId: "turn_canary",
      itemId: "file:1",
      filePath: path.join(project, "decision.md"),
      afterHash: `sha256:${"1".repeat(64)}`
    });
    const turn = snapshots.createTurnSnapshot({
      workspaceId: moved.workspaceId,
      turnId: "turn_canary",
      eventIds: [events[0].envelope.event_id],
      fileSnapshotIds: [firstFile.snapshotId],
      completion: "complete",
      completedAt: clock()
    });
    const projected = [];
    const deleted = [];
    const projection = {
      async project(memory) {
        projected.push(memory.memory_id);
        return { status: "synced", documentId: memory.memory_id };
      },
      async delete(memory) {
        deleted.push(memory.memory_id);
        return { status: "deleted", documentId: memory.memory_id };
      }
    };
    const governance = createCodexMemoryGovernance({
      vaultRoot: vault,
      workspaceId: moved.workspaceId,
      projectId: moved.projectId,
      encryptionKey: key,
      projection,
      admissionMode: "automatic",
      clock
    });
    const archive = governance.archiveTurn({
      sessionId: "thr_canary",
      turnId: "turn_canary",
      visibleMessages: [{ role: "assistant", text: "Use PostgreSQL for durable storage." }],
      toolEventIds: [events[0].envelope.event_id],
      turnSnapshotId: turn.turnSnapshotId,
      retentionClass: "short"
    });
    const candidate = governance.createCandidate({
      archiveId: archive.archive_id,
      eventIds: [events[0].envelope.event_id],
      turnSnapshotId: turn.turnSnapshotId,
      sourceSnapshotIds: [firstFile.snapshotId],
      title: "Durable database decision",
      proposedText: "Use PostgreSQL for durable storage.",
      confidence: 0.98,
      extractor: { model: "canary-deterministic", prompt_version: "v1" }
    });
    const admitted = await governance.admitCandidate(candidate.candidate_id, {
      verification: {
        status: "verified",
        verifier: {
          provider: "canary",
          model: "canary-independent-verifier",
          prompt_version: "canary-verify-v1",
          independent: true
        },
        signals: {
          evidence_entailment: 0.99,
          source_trust: 0.98,
          extraction_agreement: 0.96,
          entity_resolution_confidence: 0.95,
          temporal_consistency: 0.97,
          independent_support: 0.8,
          contradiction_risk: 0,
          scope_valid: true,
          ontology_compatible: true
        }
      }
    });
    assert(admitted.status === "auto_activate", "canary_automatic_admission_missing");
    assert(admitted.admission?.integrity_hash, "canary_admission_attestation_missing");
    assert(projected.includes(admitted.memory.memory_id), "canary_projection_missing");
    stages.push({
      id: "archive_candidate_automatic_admission_projection",
      status: "pass",
      decision: admitted.decision,
      admission_id: admitted.admission.admission_id,
      independently_verified: true,
      review_candidate_called: false
    });

    const durableRecall = createCodexMemoryRecall({
      workspaceStore: governance.workspace,
      clock
    });
    const workingState = workingSetStore.ensure({
      workspaceId: moved.workspaceId,
      projectId: moved.projectId,
      sessionId: "thr_canary"
    });
    const workingRecall = createCodexWorkingRecall({
      workingStore: workingSetStore,
      captureStore: captures,
      workspaceId: moved.workspaceId,
      projectId: moved.projectId,
      clock
    });
    const recall = createCodexMemoryRouter({
      workspaceId: moved.workspaceId,
      projectId: moved.projectId,
      workingRecall,
      durableRecall,
      monotonicNow: () => performance.now(),
      wallClock: clock
    });
    const mcp = createCodexMcpServer({ mode: "bound", recall });
    const recalled = await mcp.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "supermemory_search",
        arguments: {
          working_set_id: workingState.manifest.working_set_id,
          query: "PostgreSQL durable"
        }
      }
    });
    const recalledValue = recalled.result.structuredContent;
    assert(recalledValue.results.length === 1, "canary_mcp_recall_missing");
    assert(
      recalledValue.results[0].citations.some((citation) => (
        citation.locator?.turn_snapshot_id === turn.turnSnapshotId
      )),
      "canary_citation_missing"
    );
    stages.push({
      id: "project_bound_mcp_cited_recall",
      status: "pass",
      mode: recalledValue.strategy_used
    });

    const changedFile = snapshots.createFileSnapshot({
      workspaceId: moved.workspaceId,
      turnId: "turn_canary_changed",
      itemId: "file:2",
      filePath: path.join(project, "decision.md"),
      beforeHash: `sha256:${"1".repeat(64)}`,
      afterHash: `sha256:${"2".repeat(64)}`
    });
    assert(
      changedFile.invalidatedSnapshotIds.includes(firstFile.snapshotId),
      "canary_snapshot_invalidation_missing"
    );
    await governance.invalidateEvidence({
      snapshotIds: changedFile.invalidatedSnapshotIds
    });
    const afterChange = await recall.search({
      working_set_id: workingState.manifest.working_set_id,
      query: "PostgreSQL durable"
    });
    assert(afterChange.results.length === 0, "canary_stale_memory_recalled");
    stages.push({
      id: "source_change_stale_before_projection_delete",
      status: "pass"
    });

    const lifecycle = createCodexLifecycle({
      workspaceStore: governance.workspace,
      archiveStore: governance.archives,
      clock
    });
    const purged = await lifecycle.deleteMemory(admitted.memory.memory_id, {
      confirmation: `DELETE ${admitted.memory.memory_id}`,
      reason: "canary_cleanup"
    });
    assert(purged.status === "purged", "canary_memory_purge_failed");
    const attestation = fs.readFileSync(
      path.join(lifecycle.attestationRoot, `${purged.attestation_id}.json`),
      "utf8"
    );
    assert(!attestation.includes("PostgreSQL"), "canary_attestation_contains_content");
    assert(deleted.includes(admitted.memory.memory_id), "canary_projection_delete_missing");
    stages.push({
      id: "tombstone_projection_delete_purge_attestation",
      status: "pass"
    });

    const rolledBack = installer.rollback(installed, {
      confirmation: `ROLLBACK ${installed.install_id}`
    });
    const afterRollback = await discoverPlugin({
      codexExecutable,
      codexHome,
      projectRoot: project
    });
    assert(rolledBack.vault_preserved, "canary_rollback_lost_vault");
    assert(!afterRollback.found, "canary_rollback_plugin_still_discovered");
    stages.push({
      id: "install_rollback_vault_preserved",
      status: "pass"
    });

    const version = spawnSync(codexExecutable, ["--version"], { encoding: "utf8" });
    return {
      schema: "supermemory.codex-integration-canary.v1",
      generated_at: clock(),
      status: "pass",
      sacrificial_local: true,
      customer_data_used: false,
      live_cloud_writes_performed: false,
      project_id_stable: true,
      workspace_id_stable: true,
      plugin_discovered_by_codex: discovery.found,
      plugin_activation_observed_by_codex: discovery.activation_observed,
      backup_rollback_verified: true,
      secrets_redacted: true,
      codex_cli_observed: version.status === 0,
      codex_executable: codexExecutable,
      codex_version: version.status === 0
        ? version.stdout.trim().split(/\r?\n/)[0]
        : null,
      desktop_ui_observed: false,
      ide_ui_observed: false,
      stages
    };
  } finally {
    if (!keepArtifacts) fs.rmSync(root, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    const executableIndex = process.argv.indexOf("--codex-executable");
    const report = await runCodexIntegrationCanary({
      codexExecutable: executableIndex >= 0 ? process.argv[executableIndex + 1] : null
    });
    process.stdout.write(`${JSON.stringify(report, null, process.argv.includes("--json") ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`SuperMemory Codex canary failed: ${error?.code ?? error?.message}\n`);
    process.exitCode = 1;
  }
}
