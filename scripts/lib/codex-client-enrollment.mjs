import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitCommonFingerprint, inspectProjectLayout, rootIdentity } from "./project-registry.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function loopbackEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "::1", "[::1]", "localhost"].includes(url.hostname)) {
    fail("client_endpoint_invalid");
  }
  return url;
}

function deviceId() {
  const material = `${os.hostname()}\0${process.getuid?.() ?? "unknown"}\0supermemory-device-v1`;
  return `device_${crypto.createHash("sha256").update(material).digest("hex").slice(0, 32)}`;
}

async function request(endpoint, route, authToken, body) {
  const response = await fetch(new URL(route, endpoint), {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok || value.ok !== true) fail(typeof value.error === "string" ? value.error : value.error?.code ?? "client_request_failed");
  return value;
}

function ensureDirectory(directory) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("client_target_invalid");
  } else {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(directory, 0o700);
}

function atomicWrite(filePath, content, mode = 0o600) {
  ensureDirectory(path.dirname(filePath));
  if (fs.existsSync(filePath)) fail("client_target_exists");
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { flag: "wx", mode });
    fs.renameSync(temp, filePath);
    fs.chmodSync(filePath, mode);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

export async function planCodexProjectEnrollment({
  projectRoot,
  endpoint = "http://127.0.0.1:8765",
  authToken,
  displayName = null,
  linkProjectId = null
} = {}) {
  if (typeof authToken !== "string" || authToken.length < 32) fail("client_auth_invalid");
  const layout = inspectProjectLayout(projectRoot);
  if (fs.existsSync(layout.projectMarkerPath) || fs.existsSync(layout.checkoutMarkerPath)) {
    fail("client_project_already_bound");
  }
  const identity = rootIdentity(layout.root);
  const value = await request(loopbackEndpoint(endpoint), "/v1/projects/enrollment/plan", authToken, {
    operation: linkProjectId ? "link" : "create",
    displayName: displayName ?? path.basename(layout.root),
    rootFingerprint: identity.pathFingerprint,
    gitCommonDirectoryFingerprint: gitCommonFingerprint(layout),
    deviceId: deviceId(),
    linkProjectId
  });
  return {
    ...value,
    local: {
      project_root: layout.root,
      project_marker: layout.projectMarkerPath,
      checkout_marker: layout.checkoutMarkerPath,
      credential_file: path.join(
        os.homedir(),
        ".supermemory",
        "credentials",
        `${value.proposed_binding.checkout_id}.token`
      )
    }
  };
}

export async function applyCodexProjectEnrollment({
  plan,
  endpoint = "http://127.0.0.1:8765",
  authToken,
  expectedPlanHash
} = {}) {
  if (
    plan?.schema !== "supermemory.project-enrollment-plan.v1" ||
    plan.plan_hash !== expectedPlanHash || typeof authToken !== "string" || authToken.length < 32
  ) fail("client_plan_invalid");
  const applied = await request(loopbackEndpoint(endpoint), "/v1/projects/enrollment/apply", authToken, {
    plan_id: plan.plan_id,
    plan_hash: expectedPlanHash
  });
  const written = [];
  try {
    atomicWrite(plan.local.credential_file, `${applied.credential.token}\n`);
    written.push(plan.local.credential_file);
    atomicWrite(plan.local.project_marker, `${JSON.stringify(applied.receipt.markers.project, null, 2)}\n`);
    written.push(plan.local.project_marker);
    atomicWrite(plan.local.checkout_marker, `${JSON.stringify(applied.receipt.markers.checkout, null, 2)}\n`);
    written.push(plan.local.checkout_marker);
  } catch (error) {
    for (const target of written.reverse()) fs.rmSync(target, { force: true });
    await request(
      loopbackEndpoint(endpoint),
      `/v1/projects/${applied.receipt.binding.project_id}/checkouts/${applied.receipt.binding.checkout_id}/revoke`,
      authToken,
      {}
    ).catch(() => {});
    throw error;
  }
  return {
    schema: "supermemory.codex-client-enrollment.v1",
    status: "enrolled",
    receipt: applied.receipt,
    files: {
      project_marker: plan.local.project_marker,
      checkout_marker: plan.local.checkout_marker,
      credential: plan.local.credential_file
    }
  };
}

export async function issueExistingCheckoutCredential({
  projectRoot,
  endpoint = "http://127.0.0.1:8765",
  authToken
} = {}) {
  const layout = inspectProjectLayout(projectRoot);
  const project = JSON.parse(fs.readFileSync(layout.projectMarkerPath, "utf8"));
  const checkout = JSON.parse(fs.readFileSync(layout.checkoutMarkerPath, "utf8"));
  if (
    project?.schema !== "supermemory.project-marker.v1" ||
    checkout?.schema !== "supermemory.checkout-marker.v1" ||
    project.project_id !== checkout.project_id || project.workspace_id !== checkout.workspace_id
  ) fail("client_binding_invalid");
  const issued = await request(
    loopbackEndpoint(endpoint),
    `/v1/projects/${project.project_id}/checkouts/${checkout.checkout_id}/issue`,
    authToken,
    { device_id: deviceId() }
  );
  const credentialFile = path.join(
    os.homedir(),
    ".supermemory",
    "credentials",
    `${checkout.checkout_id}.token`
  );
  atomicWrite(credentialFile, `${issued.token}\n`);
  return {
    schema: "supermemory.codex-client-credential.v1",
    status: "issued",
    project_root: layout.root,
    binding: {
      project_id: project.project_id,
      workspace_id: project.workspace_id,
      checkout_id: checkout.checkout_id
    },
    credential_file: credentialFile,
    device_id: issued.device_id
  };
}
