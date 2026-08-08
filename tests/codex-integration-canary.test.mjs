import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runCodexIntegrationCanary } from "../scripts/run-codex-integration-canary.mjs";

test("sacrificial canary proves the complete governed memory oracle and rollback", async () => {
  const report = await runCodexIntegrationCanary({
    codexExecutable: process.execPath,
    discoverPlugin({ projectRoot }) {
      const marketplacePath = path.join(
        projectRoot,
        ".agents",
        "plugins",
        "marketplace.json"
      );
      if (!fs.existsSync(marketplacePath)) {
        return { found: false, installed: false, enabled: false, install_policy: null };
      }
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
      const plugin = marketplace.plugins.find((entry) => entry.name === "supermemory");
      return {
        found: Boolean(plugin),
        installed: plugin?.policy?.installation === "INSTALLED_BY_DEFAULT",
        enabled: Boolean(plugin),
        install_policy: plugin?.policy?.installation ?? null,
        activation_observed: Boolean(plugin)
      };
    },
    clock: () => "2026-07-24T22:00:00.000Z"
  });
  assert.equal(report.status, "pass");
  assert.equal(report.sacrificial_local, true);
  assert.equal(report.customer_data_used, false);
  assert.equal(report.live_cloud_writes_performed, false);
  assert.equal(report.project_id_stable, true);
  assert.equal(report.workspace_id_stable, true);
  assert.equal(report.plugin_discovered_by_codex, true);
  assert.equal(report.plugin_activation_observed_by_codex, true);
  assert.equal(report.backup_rollback_verified, true);
  assert.equal(report.secrets_redacted, true);
  assert.equal(report.desktop_ui_observed, false);
  assert.equal(report.ide_ui_observed, false);
  assert.deepEqual(report.stages.map((stage) => stage.id), [
    "stable_identity_after_move",
    "reversible_install_and_codex_discovery",
    "plugin_capture_spool_replay_redaction",
    "archive_candidate_automatic_admission_projection",
    "project_bound_mcp_cited_recall",
    "source_change_stale_before_projection_delete",
    "tombstone_projection_delete_purge_attestation",
    "install_rollback_vault_preserved"
  ]);
  const admissionStage = report.stages.find(
    (stage) => stage.id === "archive_candidate_automatic_admission_projection"
  );
  assert.equal(admissionStage.decision, "auto_activate");
  assert.equal(admissionStage.independently_verified, true);
  assert.equal(admissionStage.review_candidate_called, false);
  assert.match(admissionStage.admission_id, /^adm_[0-9a-f]{64}$/);
});
