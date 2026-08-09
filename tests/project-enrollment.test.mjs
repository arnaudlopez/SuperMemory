import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCheckoutCredentialStore } from "../scripts/lib/checkout-credential-store.mjs";
import { createProjectEnrollmentService } from "../scripts/lib/project-enrollment.mjs";
import { createProjectRegistry } from "../scripts/lib/project-registry.mjs";

test("remote enrollment applies one exact plan and returns a one-time checkout credential", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-enrollment-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const registry = createProjectRegistry({ vaultRoot: vault });
  const credentials = createCheckoutCredentialStore({ vaultRoot: vault });
  const service = createProjectEnrollmentService({
    registry,
    credentialStore: credentials,
    receiptKey: Buffer.alloc(32, 7)
  });
  const plan = service.plan({
    displayName: "Remote Project",
    rootFingerprint: `sha256:${"a".repeat(64)}`,
    gitCommonDirectoryFingerprint: `sha256:${"b".repeat(64)}`,
    deviceId: "device_fixture-mac"
  });
  const applied = service.apply({ planId: plan.plan_id, planHash: plan.plan_hash });
  assert.match(applied.receipt.signature, /^hmac-sha256:/);
  assert.equal(registry.snapshot().projects.length, 1);
  assert.equal(registry.snapshot().checkouts.length, 1);
  assert.equal(credentials.authenticate({
    checkoutId: applied.receipt.binding.checkout_id,
    deviceId: "device_fixture-mac",
    token: applied.credential.token,
    capability: "history_import"
  }).workspaceId, applied.receipt.binding.workspace_id);
  assert.throws(
    () => service.apply({ planId: plan.plan_id, planHash: plan.plan_hash }),
    /enrollment_plan_unavailable/
  );
});
