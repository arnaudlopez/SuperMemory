import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("daemon working-memory flag is explicit and check mode creates no working artifacts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemoryd-working-"));
  const vault = path.join(root, "vault");
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(vault);
  fs.mkdirSync(runtime);
  const keyFile = path.join(root, "key");
  const tokenFile = path.join(root, "token");
  fs.writeFileSync(keyFile, Buffer.alloc(32, 2), { mode: 0o600 });
  fs.writeFileSync(tokenFile, "daemon-token-0000000000000000000000000000", { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [
    "scripts/supermemoryd.mjs", "--check", "--json", "--working-memory",
    "--vault-root", vault, "--runtime-root", runtime, "--key-file", keyFile, "--token-file", tokenFile
  ], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "configuration_valid");
  assert.equal(fs.existsSync(path.join(vault, "00_inbox/supermemory-product/codex-working-sets")), false);
});
