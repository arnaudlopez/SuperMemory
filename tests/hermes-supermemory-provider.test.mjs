import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve("integrations/hermes/plugins/memory/supermemory_fabric");

test("Hermes provider package has no direct memory-engine credentials or runtime upgrades", () => {
  const sources = ["__init__.py", "client.py", "schemas.py", "spool.py"]
    .map((name) => fs.readFileSync(path.join(ROOT, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(sources, /HINDSIGHT_API_KEY|NEO4J_PASSWORD|GRAPHD_TOKEN|bank_id/i);
  assert.doesNotMatch(sources, /pip\s+install|subprocess.*pip|auto.?upgrade/i);
  assert.match(sources, /\/v1\/personal-manager\/context/);
  assert.match(sources, /pm_recall/);
  assert.match(sources, /pm_add/);
  assert.match(sources, /AESGCM/);
  assert.doesNotMatch(sources, /capture_\*\.json["']/);
});

test("Home 101 reconciler activates the canonical provider without replacing connector settings", () => {
  const reconciler = fs.readFileSync(path.resolve("deploy/home101/configure-hermes.py"), "utf8");
  const readme = fs.readFileSync(path.resolve("deploy/home101/README.md"), "utf8");
  assert.match(reconciler, /retained = \[line for line in lines if line\.split\("=", 1\)\[0\] not in OWNED_ENV\]/);
  assert.match(reconciler, /model\["provider"\] = "openai-codex"/);
  assert.match(reconciler, /model\["default"\] = "gpt-5\.6-luna"/);
  assert.match(reconciler, /config\["fallback_providers"\] = \[\]/);
  assert.match(reconciler, /config\.setdefault\("memory", \{\}\)\["provider"\] = "supermemory-fabric"/);
  assert.match(readme, /\/home\/agent\/\.hermes\/plugins\/supermemory-fabric\//);
  assert.match(readme, /command="\/bin\/false"/);
});
