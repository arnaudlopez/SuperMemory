import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexArchiveStore } from "../scripts/lib/codex-archive-store.mjs";
import { createCodexCaptureStore } from "../scripts/lib/codex-capture-store.mjs";
import {
  createCodexMemoryCompiler,
  createOllamaMemoryExtractor
} from "../scripts/lib/codex-memory-compiler.mjs";
import { createCodexWorkspaceStore } from "../scripts/lib/codex-workspace-store.mjs";

const PROJECT_ID = "prj_018f1234-5678-7abc-8def-0123456789ab";
const WORKSPACE_ID = "ws_018f1234-5678-7abc-8def-0123456789ac";
const CHECKOUT_ID = "co_018f1234-5678-7abc-8def-0123456789ad";
const KEY = Buffer.alloc(32, 0x53);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-compiler-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault };
}

function capture({
  sequence,
  eventType,
  payload,
  turnId = "turn_hook:turn-1",
  occurredAt = `2026-07-25T08:00:${String(sequence).padStart(2, "0")}.000Z`
}) {
  return {
    adapter: "hook",
    adapter_version: "1.0.0",
    external_event_id: `compiler-${sequence}-${eventType}`,
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    checkout_id: CHECKOUT_ID,
    session_id: "ses_hook:compiler-session",
    thread_id: "compiler-session",
    turn_id: turnId,
    item_id: null,
    event_type: eventType,
    occurred_at: occurredAt,
    capture_level: "standard",
    sequence,
    payload
  };
}

function seedCompletedTurn(store, { turnId = "turn_hook:turn-1" } = {}) {
  store.ingest(capture({
    sequence: 0,
    eventType: "prompt.submitted",
    turnId,
    payload: { prompt: "Remember that releases require a verified rollback." }
  }));
  const stop = capture({
    sequence: 1,
    eventType: "assistant.completed",
    turnId,
    payload: {
      last_assistant_message: "All production releases require a verified rollback."
    }
  });
  store.ingest(stop);
  return stop;
}

function governedStores(vault) {
  return {
    workspace: createCodexWorkspaceStore({
      vaultRoot: vault,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID
    }),
    archives: createCodexArchiveStore({
      vaultRoot: vault,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      encryptionKey: KEY
    })
  };
}

test("compiler turns a durable Stop into one encrypted archive and one pending candidate", async (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const stop = seedCompletedTurn(store);
  const compiler = createCodexMemoryCompiler({
    vaultRoot: vault,
    encryptionKey: KEY,
    captureStore: store,
    extractor: {
      model: "test-local",
      promptVersion: "test-v1",
      async extract() {
        return {
          title: "Verified rollback policy",
          proposedText: "Production releases require a verified rollback.",
          type: "constraint",
          confidence: 0.99,
          uncertainty: "",
          sensitivity: "standard"
        };
      }
    }
  });

  assert.equal(compiler.notifyCapture(stop).scheduled, true);
  await compiler.whenIdle();

  const { workspace, archives } = governedStores(vault);
  const candidates = workspace.listCandidates({ status: "pending" });
  assert.equal(candidates.length, 1);
  assert.equal(workspace.listActiveMemories({ consumer: "codex" }).length, 0);
  const metadata = archives.listMetadata();
  assert.equal(metadata.length, 1);
  const opened = archives.openArchive(metadata[0].archive_id);
  assert.deepEqual(opened.content.visible_messages.map((item) => item.role), [
    "user",
    "assistant"
  ]);
  assert.equal(compiler.stats().compiled, 1);
  assert.equal(compiler.stats().candidates, 1);

  compiler.schedule({ workspaceId: WORKSPACE_ID, sessionId: stop.session_id });
  await compiler.whenIdle();
  assert.equal(workspace.listCandidates().length, 1);
  assert.equal(archives.listMetadata().length, 1);
});

test("Ollama failure keeps the archive and is replayable without duplication", async (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const stop = seedCompletedTurn(store);
  let available = false;
  const compiler = createCodexMemoryCompiler({
    vaultRoot: vault,
    encryptionKey: KEY,
    captureStore: store,
    extractor: {
      model: "test-local",
      promptVersion: "test-v1",
      async extract() {
        if (!available) throw Object.assign(new Error("down"), {
          code: "compiler_ollama_unavailable"
        });
        return {
          title: "Verified rollback policy",
          proposedText: "Production releases require a verified rollback.",
          type: "constraint",
          confidence: 0.95,
          uncertainty: "",
          sensitivity: "standard"
        };
      }
    }
  });

  compiler.notifyCapture(stop);
  await compiler.whenIdle();
  let stores = governedStores(vault);
  assert.equal(stores.archives.listMetadata().length, 1);
  assert.equal(stores.workspace.listCandidates().length, 0);
  assert.equal(compiler.stats().retryable, 1);

  available = true;
  compiler.schedule({ workspaceId: WORKSPACE_ID, sessionId: stop.session_id });
  await compiler.whenIdle();
  stores = governedStores(vault);
  assert.equal(stores.archives.listMetadata().length, 1);
  assert.equal(stores.workspace.listCandidates().length, 1);
  assert.equal(compiler.stats().retryable, 0);
});

test("restart recovery compiles unprocessed hook turns, including missing turn ids", async (t) => {
  const { vault } = fixture(t);
  const store = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  seedCompletedTurn(store, { turnId: null });
  const compiler = createCodexMemoryCompiler({
    vaultRoot: vault,
    encryptionKey: KEY,
    captureStore: store,
    extractor: {
      model: "test-local",
      promptVersion: "test-v1",
      async extract() {
        return null;
      }
    }
  });

  assert.equal(compiler.recover().scheduled, 1);
  await compiler.whenIdle();

  const { workspace, archives } = governedStores(vault);
  assert.equal(archives.listMetadata().length, 1);
  assert.match(archives.listMetadata()[0].turn_id, /^turn_hook:auto:[0-9a-f]{32}$/);
  assert.equal(workspace.listCandidates().length, 0);
  assert.equal(compiler.stats().archived_only, 1);
});

test("Ollama extractor is loopback-only and uses a bounded structured response", async () => {
  assert.throws(
    () => createOllamaMemoryExtractor({ baseUrl: "https://ollama.example.com" }),
    /compiler_ollama_remote_forbidden/
  );
  let request;
  const extractor = createOllamaMemoryExtractor({
    model: "llama3:latest",
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            message: {
              content: JSON.stringify({
                should_create: true,
                title: "Local policy",
                proposed_text: "Use only local inference.",
                type: "constraint",
                confidence: 0.9,
                uncertainty: "",
                sensitivity: "standard"
              })
            }
          });
        }
      };
    }
  });
  const result = await extractor.extract({
    messages: [{ role: "assistant", text: "Use only local inference." }]
  });
  assert.equal(request.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(request.body.stream, false);
  assert.equal(request.body.think, false);
  assert.equal(request.body.options.temperature, 0);
  assert.equal(request.body.format.type, "object");
  assert.equal(result.proposedText, "Use only local inference.");
});

test("automatic compiler admission uses an independent verifier and outages remain pending", async (t) => {
  const { vault } = fixture(t);
  const captureStore = createCodexCaptureStore({ vaultRoot: vault, encryptionKey: KEY });
  const stop = seedCompletedTurn(captureStore);
  let available = false;
  const compiler = createCodexMemoryCompiler({
    vaultRoot: vault,
    encryptionKey: KEY,
    captureStore,
    admissionMode: "automatic",
    extractor: {
      model: "extractor-v1",
      promptVersion: "extract-v1",
      async extract() {
        return {
          title: "Verified rollback policy",
          proposedText: "Production releases require a verified rollback.",
          type: "constraint",
          confidence: 1,
          uncertainty: "",
          sensitivity: "standard"
        };
      }
    },
    verifier: {
      async verify() {
        if (!available) throw new Error("verifier down");
        return {
          status: "verified",
          verifier: {
            provider: "fixture",
            model: "independent-verifier-v1",
            prompt_version: "verify-v1",
            independent: true
          },
          signals: {
            evidence_entailment: 0.99,
            source_trust: 0.98,
            extraction_agreement: 0.96,
            scope_valid: true,
            ontology_compatible: true,
            contradiction_risk: 0
          }
        };
      }
    }
  });
  compiler.notifyCapture(stop);
  await compiler.whenIdle();
  let automatic = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    admissionMode: "automatic"
  });
  assert.equal(automatic.listCandidates({ status: "pending_verification" }).length, 1);
  assert.equal(automatic.listActiveMemories().length, 0);

  available = true;
  compiler.schedule({ workspaceId: WORKSPACE_ID, sessionId: stop.session_id });
  await compiler.whenIdle();
  automatic = createCodexWorkspaceStore({
    vaultRoot: vault,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    admissionMode: "automatic"
  });
  assert.equal(automatic.listCandidates({ status: "auto_activate" }).length, 1);
  assert.equal(automatic.listCandidates().length, 1);
  assert.equal(automatic.listActiveMemories({ consumer: "codex" }).length, 1);
});
