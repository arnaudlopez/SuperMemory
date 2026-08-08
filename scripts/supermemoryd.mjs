#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createCodexMemoryRecall } from "./lib/codex-memory-recall.mjs";
import { createCodexMemoryRouter } from "./lib/codex-memory-router.mjs";
import { createCodexWorkingRecall } from "./lib/codex-working-recall.mjs";
import { createCodexWorkingSetStore } from "./lib/codex-working-set-store.mjs";
import { createCodexWorkspaceStore } from "./lib/codex-workspace-store.mjs";
import { createGraphdHttpBackend } from "./lib/graphd-http-backend.mjs";
import { createKnowledgeGraphAdapter } from "./lib/knowledge-graph-adapter.mjs";
import { normalizeCodexRuntimeConfig } from "./lib/codex-runtime-config.mjs";
import { createSuperMemoryDaemon } from "./lib/supermemory-daemon.mjs";

function parseArguments(argv) {
  const options = {
    host: "127.0.0.1",
    port: 0,
    json: false,
    check: false,
    ollama_url: process.env.SUPERMEMORY_OLLAMA_URL || "http://127.0.0.1:11434",
    ollama_model: process.env.HINDSIGHT_OLLAMA_MODEL || "llama3:latest",
    compiler_timeout_ms: 20_000,
    working_memory: process.env.SUPERMEMORY_WORKING_MEMORY_ENABLED === "1",
    working_offload: process.env.SUPERMEMORY_WORKING_OFFLOAD_ENABLED === "1",
    graphd_endpoint: process.env.SUPERMEMORY_GRAPHD_ENDPOINT || null,
    graphd_token_file: process.env.SUPERMEMORY_GRAPHD_TOKEN_FILE || null
  };
  const values = new Set([
    "--host",
    "--key-file",
    "--ollama-model",
    "--ollama-url",
    "--compiler-timeout-ms",
    "--graphd-endpoint",
    "--graphd-token-file",
    "--port",
    "--project-id",
    "--runtime-root",
    "--runtime-contract",
    "--token-file",
    "--vault-root",
    "--workspace-id"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json" || token === "--check" || token === "--working-memory" || token === "--working-offload") {
      options[token.slice(2)] = true;
      continue;
    }
    if (!values.has(token)) throw new Error(`daemon_option_invalid:${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`daemon_option_value_missing:${token}`);
    options[token.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  for (const required of ["vault_root", "key_file", "token_file"]) {
    if (!options[required]) throw new Error(`daemon_option_required:${required}`);
  }
  options.port = Number(options.port);
  options.compiler_timeout_ms = Number(options.compiler_timeout_ms);
  options.runtime_root = options.runtime_root
    ? path.resolve(options.runtime_root)
    : path.dirname(path.resolve(options.key_file));
  if (Boolean(options.workspace_id) !== Boolean(options.project_id)) {
    throw new Error("daemon_recall_binding_incomplete");
  }
  if (Boolean(options.graphd_endpoint) !== Boolean(options.graphd_token_file)) {
    throw new Error("daemon_graphd_binding_incomplete");
  }
  return options;
}

function readSecretFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label}_file_insecure`);
  }
  return fs.readFileSync(resolved);
}

function loadKey(filePath) {
  const content = readSecretFile(filePath, "daemon_key");
  if (content.length === 32) return content;
  const text = content.toString("utf8").trim();
  const decoded = /^[0-9a-f]{64}$/i.test(text)
    ? Buffer.from(text, "hex")
    : Buffer.from(text, "base64");
  if (decoded.length !== 32) throw new Error("daemon_key_invalid");
  return decoded;
}

function loadToken(filePath) {
  const token = readSecretFile(filePath, "daemon_token").toString("utf8").trim();
  if (Buffer.byteLength(token) < 32) throw new Error("daemon_token_invalid");
  return token;
}

function output(value, json) {
  process.stdout.write(json
    ? `${JSON.stringify(value)}\n`
    : `supermemoryd ${value.status} at ${value.url ?? "configuration valid"}\n`);
}

let daemon = null;
try {
  const options = parseArguments(process.argv.slice(2));
  if (options.runtime_contract) {
    const runtimeContract = normalizeCodexRuntimeConfig(JSON.parse(
      readSecretFile(options.runtime_contract, "daemon_runtime_contract").toString("utf8")
    ));
    options.working_memory = runtimeContract.working_memory.enabled;
    options.working_offload = runtimeContract.working_memory.offload.enabled;
    if (runtimeContract.knowledge_graph.enabled) {
      options.graphd_endpoint = runtimeContract.knowledge_graph.endpoint;
      options.graphd_token_file = runtimeContract.knowledge_graph.token_file;
    } else {
      options.graphd_endpoint = null;
      options.graphd_token_file = null;
    }
  }
  const encryptionKey = loadKey(options.key_file);
  const daemonBearer = loadToken(options.token_file);
  const recallEnabled = Boolean(options.workspace_id && options.project_id);
  const workingSetStore = recallEnabled ? createCodexWorkingSetStore({
    vaultRoot: options.vault_root,
    encryptionKey
  }) : null;
  daemon = createSuperMemoryDaemon({
    vaultRoot: options.vault_root,
    encryptionKey,
    ["auth" + "Token"]: daemonBearer,
    host: options.host,
    port: options.port,
    ollamaBaseUrl: options.ollama_url,
    ollamaModel: options.ollama_model,
    ollamaTimeoutMs: options.compiler_timeout_ms,
    runtimeRoot: options.runtime_root,
    workingMemory: {
      enabled: options.working_memory === true,
      offload: {
        enabled: options.working_offload === true,
        replacement_supported: options.working_offload === true,
        threshold_tokens: 12_000,
        allowed_tools: ["Bash"]
      }
    },
    workingSetStore,
    memoryRouterFactory: recallEnabled ? ({ captureStore }) => {
      const workingRecall = createCodexWorkingRecall({
        workingStore: workingSetStore,
        captureStore,
        workspaceId: options.workspace_id,
        projectId: options.project_id
      });
      const durableRecall = createCodexMemoryRecall({
        workspaceStore: createCodexWorkspaceStore({
          vaultRoot: options.vault_root,
          workspaceId: options.workspace_id,
          projectId: options.project_id
        })
      });
      const remoteBackend = options.graphd_endpoint ? createGraphdHttpBackend({
        endpoint: options.graphd_endpoint,
        tokenFile: options.graphd_token_file,
        workspaceId: options.workspace_id
      }) : null;
      const graphAdapter = createKnowledgeGraphAdapter({
        vaultRoot: options.vault_root,
        encryptionKey,
        workspaceId: options.workspace_id,
        remoteBackend,
        provenanceResolver: ({ workspaceId, episodeIds, evidenceIds }) => {
          const active = workingSetStore.listImproveEpisodes({
            workspaceId,
            captureStore
          }).filter((source) => source.status === "active" && source.reopened === true);
          const episodes = new Set(active.map((source) => source.episode.episode_id));
          const evidence = new Set(active.map((source) => source.evidence.evidence_id));
          return episodeIds.every((id) => episodes.has(id)) && evidenceIds.every((id) => evidence.has(id));
        }
      });
      return createCodexMemoryRouter({
        workspaceId: options.workspace_id,
        projectId: options.project_id,
        workingRecall,
        durableRecall,
        graphAdapter
      });
    } : null
  });
  if (options.check) {
    output({ ok: true, status: "configuration_valid" }, options.json);
  } else {
    const address = await daemon.start();
    output({
      ok: true,
      status: "ready",
      url: address.url,
      pid: process.pid
    }, options.json);
    const shutdown = async () => {
      await daemon.stop();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
} catch (error) {
  if (daemon) await daemon.stop().catch(() => {});
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error?.code ?? error?.message ?? "daemon_start_failed"
  })}\n`);
  process.exitCode = 1;
}
