import crypto from "node:crypto";
import { generateUuidV7 } from "./project-registry.mjs";

const PROJECT_ID = /^prj_[0-9a-f-]{36}$/i;
const WORKSPACE_ID = /^ws_[0-9a-f-]{36}$/i;
const DEVICE_ID = /^device_[A-Za-z0-9._-]{8,180}$/;
const ROOT_FINGERPRINT = /^sha256:[0-9a-f]{64}$/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function makeId(prefix, now, randomBytes) {
  return `${prefix}_${generateUuidV7({ now, randomBytes })}`;
}

export function createProjectEnrollmentService({
  registry,
  credentialStore,
  receiptKey,
  planTtlMs = 600_000,
  clock = () => new Date().toISOString(),
  randomBytes = crypto.randomBytes
} = {}) {
  if (
    !registry || typeof registry.registerRemoteBinding !== "function" ||
    !credentialStore || typeof credentialStore.issue !== "function" ||
    !Buffer.isBuffer(receiptKey) || receiptKey.length !== 32
  ) fail("enrollment_service_invalid");
  const plans = new Map();
  const consumed = new Set();

  const plan = ({
    operation = "create",
    displayName,
    rootFingerprint,
    gitCommonDirectoryFingerprint = null,
    deviceId,
    linkProjectId = null
  } = {}) => {
    if (!['create', 'link'].includes(operation)) fail("enrollment_operation_invalid");
    if (!ROOT_FINGERPRINT.test(String(rootFingerprint ?? "")) || !DEVICE_ID.test(String(deviceId ?? ""))) {
      fail("enrollment_input_invalid");
    }
    const snapshot = registry.snapshot();
    const linked = linkProjectId
      ? snapshot.projects.find((item) => item.projectId === linkProjectId && item.status === "active")
      : null;
    if (operation === "link" && (!linked || !PROJECT_ID.test(String(linkProjectId)))) {
      fail("linked_project_not_found");
    }
    if (operation === "create" && linkProjectId) fail("enrollment_input_invalid");
    const createdAt = clock();
    const now = Date.parse(createdAt);
    if (!Number.isFinite(now)) fail("clock_invalid");
    const value = {
      schema: "supermemory.project-enrollment-plan.v1",
      plan_id: `plan_${generateUuidV7({ now, randomBytes })}`,
      operation,
      created_at: createdAt,
      expires_at: new Date(now + planTtlMs).toISOString(),
      device_id: deviceId,
      project: {
        display_name: String(displayName ?? "Projet distant").trim().slice(0, 160),
        root_fingerprint: rootFingerprint,
        git_common_dir_fingerprint: gitCommonDirectoryFingerprint
      },
      proposed_binding: {
        project_id: linked?.projectId ?? makeId("prj", now, randomBytes),
        workspace_id: linked?.workspaceId ?? makeId("ws", now, randomBytes),
        checkout_id: makeId("co", now, randomBytes)
      },
      link_project_id: linked?.projectId ?? null
    };
    value.plan_hash = digest(value);
    plans.set(value.plan_id, Object.freeze(structuredClone(value)));
    return structuredClone(value);
  };

  const apply = ({ planId, planHash } = {}) => {
    const value = plans.get(planId);
    if (!value || consumed.has(planId)) fail("enrollment_plan_unavailable");
    if (value.plan_hash !== planHash || Date.parse(value.expires_at) <= Date.parse(clock())) {
      fail("enrollment_plan_invalid");
    }
    const binding = registry.registerRemoteBinding({
      projectId: value.proposed_binding.project_id,
      workspaceId: value.proposed_binding.workspace_id,
      checkoutId: value.proposed_binding.checkout_id,
      linkProjectId: value.link_project_id,
      displayName: value.project.display_name,
      rootFingerprint: value.project.root_fingerprint,
      gitCommonDirectoryFingerprint: value.project.git_common_dir_fingerprint,
      deviceFingerprint: value.device_id,
      inode: "remote",
      checkoutKind: value.operation === "link" ? "remote_multi_root" : "remote_git"
    });
    const credential = credentialStore.issue({
      checkoutId: binding.checkoutId,
      projectId: binding.projectId,
      workspaceId: binding.workspaceId,
      deviceId: value.device_id,
      capabilities: ["capture", "recall", "status", "history_import"]
    });
    consumed.add(planId);
    const receipt = {
      schema: "supermemory.project-enrollment-receipt.v1",
      receipt_id: `receipt_${crypto.randomUUID()}`,
      plan_id: value.plan_id,
      plan_hash: value.plan_hash,
      applied_at: clock(),
      binding: {
        project_id: binding.projectId,
        workspace_id: binding.workspaceId,
        checkout_id: binding.checkoutId
      },
      markers: {
        project: {
          schema: "supermemory.project-marker.v1",
          project_id: binding.projectId,
          workspace_id: binding.workspaceId,
          created_at: value.created_at
        },
        checkout: {
          schema: "supermemory.checkout-marker.v1",
          project_id: binding.projectId,
          workspace_id: binding.workspaceId,
          checkout_id: binding.checkoutId,
          created_at: value.created_at
        }
      },
      device_id: value.device_id
    };
    receipt.signature = `hmac-sha256:${crypto.createHmac("sha256", receiptKey).update(canonical(receipt)).digest("hex")}`;
    return { receipt, credential };
  };

  return Object.freeze({ plan, apply });
}
