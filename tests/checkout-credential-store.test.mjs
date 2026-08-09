import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCheckoutCredentialStore } from "../scripts/lib/checkout-credential-store.mjs";

const BINDING = {
  checkoutId: "co_018f7c0e-7b7d-7abc-8def-0123456789ab",
  projectId: "prj_018f7c0e-7b7d-7abc-8def-0123456789ac",
  workspaceId: "ws_018f7c0e-7b7d-7abc-8def-0123456789ad",
  deviceId: "device_fixture-mac"
};

test("checkout credentials are scoped, rotatable and revocable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-credentials-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createCheckoutCredentialStore({ vaultRoot: root });
  const issued = store.issue(BINDING);
  assert.match(issued.token, /^smco_/);
  assert.deepEqual(store.authenticate({
    checkoutId: BINDING.checkoutId,
    deviceId: BINDING.deviceId,
    token: issued.token,
    capability: "recall"
  }), {
    workspaceId: BINDING.workspaceId,
    projectId: BINDING.projectId,
    checkoutId: BINDING.checkoutId,
    deviceId: BINDING.deviceId,
    capabilities: ["capture", "recall", "status"]
  });
  assert.throws(() => store.authenticate({
    checkoutId: BINDING.checkoutId,
    deviceId: "device_wrong-mac",
    token: issued.token,
    capability: "recall"
  }), /not_authorized/);
  const rotated = store.rotate({ checkoutId: BINDING.checkoutId, deviceId: BINDING.deviceId });
  assert.throws(() => store.authenticate({ ...BINDING, token: issued.token, capability: "recall" }), /not_authorized/);
  assert.equal(store.authenticate({ ...BINDING, token: rotated.token, capability: "recall" }).projectId, BINDING.projectId);
  store.revoke({ checkoutId: BINDING.checkoutId });
  assert.throws(() => store.authenticate({ ...BINDING, token: rotated.token, capability: "recall" }), /not_authorized/);
});
