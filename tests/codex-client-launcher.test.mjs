import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyStableCodexClient, planStableCodexClient } from "../scripts/lib/codex-client-launcher.mjs";

test("stable Codex client restores runtime and plugin metadata after plugin failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-client-launcher-"));
  try {
    const clientRoot = path.join(root, "client");
    const codexHome = path.join(root, "codex");
    const runtime = path.join(clientRoot, "runtime");
    const pluginData = path.join(codexHome, "plugin-data", "supermemory", "supermemory-plugin.json");
    const executable = path.join(root, "codex-bin");
    fs.mkdirSync(runtime, { recursive: true });
    fs.mkdirSync(path.dirname(pluginData), { recursive: true });
    fs.writeFileSync(path.join(runtime, "previous.txt"), "previous\n");
    fs.writeFileSync(pluginData, '{"previous":true}\n');
    fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const plan = planStableCodexClient({
      repositoryRoot: path.resolve("."),
      clientRoot,
      codexHome,
      executable
    });
    assert.throws(
      () => applyStableCodexClient({ plan, expectedPlanHash: plan.plan_hash }),
      /codex_plugin_install_failed/
    );
    assert.equal(fs.readFileSync(path.join(runtime, "previous.txt"), "utf8"), "previous\n");
    assert.equal(fs.readFileSync(pluginData, "utf8"), '{"previous":true}\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
