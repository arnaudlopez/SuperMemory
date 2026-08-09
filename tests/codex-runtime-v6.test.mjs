import assert from "node:assert/strict";
import test from "node:test";
import {
  createFullDeploymentRuntimeV6,
  migrateCodexRuntimeV5ToV6,
  createFullDeploymentRuntimeV5
} from "../scripts/lib/codex-runtime-config.mjs";

const GRAPH = {
  graphEndpoint: "http://127.0.0.1:8787",
  graphTokenFile: "/run/supermemory/graphd.token"
};

test("runtime v6 activates the dynamic owner plus current project contract", () => {
  const runtime = createFullDeploymentRuntimeV6(GRAPH);
  assert.equal(runtime.schema, "supermemory.codex-runtime.v6");
  assert.equal(runtime.deployment.activation, "enabled");
  assert.equal(runtime.deployment.canary, false);
  assert.equal(runtime.deployment.progressive, false);
  assert.equal(runtime.scope.mode, "owner_plus_current_project");
  assert.equal(runtime.scope.cross_project_mcp, false);
  assert.equal(runtime.history_import.default_capture_level, "backfill");
  assert.equal(runtime.codex_integration.auto_trust_hooks, false);
});

test("runtime v5 migrates to v6 without enabling compatibility flags", () => {
  const migrated = migrateCodexRuntimeV5ToV6(createFullDeploymentRuntimeV5(GRAPH));
  assert.equal(migrated.schema, "supermemory.codex-runtime.v6");
  assert.equal(migrated.migration.source_schema, "supermemory.codex-runtime.v5");
  assert.equal(migrated.migration.compatibility_flags_off, true);
  assert.equal(migrated.migration.immutable_vault_rewrite, false);
});
