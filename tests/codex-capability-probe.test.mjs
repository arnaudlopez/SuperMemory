import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { probeCodexCapabilities } from "../scripts/lib/codex-capability-probe.mjs";

function fakeCodex(root, status) {
  const executable = path.join(root, `codex-${status.replaceAll(/\W+/g, "-")}`);
  fs.writeFileSync(executable, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli fixture"; exit 0; fi
if [ "$1" = "features" ]; then echo "hooks true"; exit 0; fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ]; then echo "supermemory-local /fixture"; exit 0; fi
if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then
  echo "supermemory@supermemory-local  ${status}  1.0.0  /fixture"
  exit 0
fi
exit 1
`, { mode: 0o700 });
  return executable;
}

test("Codex capability probe does not confuse not installed with installed", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-capability-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const absent = probeCodexCapabilities({ executable: fakeCodex(root, "not installed") });
  assert.equal(absent.marketplace_installed, true);
  assert.equal(absent.supermemory_installed, false);
  const present = probeCodexCapabilities({ executable: fakeCodex(root, "installed, enabled") });
  assert.equal(present.supermemory_installed, true);
});
