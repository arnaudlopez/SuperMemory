import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function run(filePath) {
  return spawnSync("node", ["scripts/verify-secret-hygiene.mjs", "--path", filePath, "--json"], { encoding: "utf8" });
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "secret-hygiene-"));
const safePath = path.join(tmpRoot, "safe.txt");
const unsafePath = path.join(tmpRoot, "unsafe.txt");
fs.writeFileSync(safePath, "HINDSIGHT_API_KEY=<local-key>\napi_key: SHOULD_NOT_LEAK_TO_PLAN\n");
fs.writeFileSync(unsafePath, ["ghp", "_", "a".repeat(36)].join(""));

const safe = run(safePath);
assert.equal(safe.status, 0);
assert.equal(JSON.parse(safe.stdout).status, "pass");

const unsafe = run(unsafePath);
assert.notEqual(unsafe.status, 0);
const unsafeReport = JSON.parse(unsafe.stdout);
assert.equal(unsafeReport.status, "fail");
assert.equal(unsafeReport.findings[0].rule, "github_token");

fs.rmSync(tmpRoot, { recursive: true, force: true });
