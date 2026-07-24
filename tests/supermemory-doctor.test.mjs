import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "../scripts/supermemory-doctor.mjs";

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-doctor-"));
  for (const dependency of ["mammoth", "pdfjs-dist"]) {
    const directory = path.join(cwd, "node_modules", dependency);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "package.json"), "{}");
  }
  return cwd;
}

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    }
  };
}

const spawnAvailable = () => ({ status: 0, stdout: "available\n", stderr: "" });

test("doctor reports ready only with local dependencies, installed model and healthy Hindsight", async () => {
  const cwd = fixture();
  const report = await runDoctor({
    cwd,
    env: {},
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url) => String(url).endsWith("/api/tags")
      ? response({ models: [{ name: "llama3:latest" }] })
      : response({ status: "healthy" })
  });
  assert.equal(report.status, "ready");
  assert.equal(report.ready, true);
  assert.equal(report.remoteCallsAllowed, false);
  assert.equal(report.modelDownloaded, false);
  assert.equal(report.blockers.length, 0);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("doctor fails closed without downloading a missing Ollama model", async () => {
  const cwd = fixture();
  const report = await runDoctor({
    cwd,
    env: {},
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url) => String(url).endsWith("/api/tags")
      ? response({ models: [] })
      : response({ status: "healthy" })
  });
  assert.equal(report.ready, false);
  assert.equal(report.modelDownloaded, false);
  assert.ok(report.blockers.some((item) => item.code === "ollama_model"));
  assert.match(report.blockers.find((item) => item.code === "ollama_model").action, /ollama pull/);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("doctor refuses a remote Hindsight endpoint", async () => {
  const cwd = fixture();
  const report = await runDoctor({
    cwd,
    env: { HINDSIGHT_BASE_URL: "https://remote.example.test" },
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url) => String(url).endsWith("/api/tags")
      ? response({ models: [{ name: "llama3:latest" }] })
      : response({ status: "healthy" })
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((item) => item.code === "hindsight_loopback"));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("doctor refuses a remote Ollama endpoint without contacting it", async () => {
  const cwd = fixture();
  const contacted = [];
  const report = await runDoctor({
    cwd,
    env: { SUPERMEMORY_OLLAMA_URL: "https://remote-model.example.test" },
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url) => {
      contacted.push(String(url));
      return response({ status: "healthy" });
    }
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((item) => item.code === "ollama_loopback"));
  assert.ok(contacted.every((url) => !url.includes("remote-model.example.test")));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("doctor refuses backups configured inside the canonical vault", async () => {
  const cwd = fixture();
  const report = await runDoctor({
    cwd,
    env: {
      SUPERMEMORY_VAULT_ROOT: "vault",
      SUPERMEMORY_BACKUPS_ROOT: "vault/backups"
    },
    spawnSyncImpl: spawnAvailable,
    fetchImpl: async (url) => String(url).endsWith("/api/tags")
      ? response({ models: [{ name: "llama3:latest" }] })
      : response({ status: "healthy" })
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((item) => item.code === "backups"));
  fs.rmSync(cwd, { recursive: true, force: true });
});
