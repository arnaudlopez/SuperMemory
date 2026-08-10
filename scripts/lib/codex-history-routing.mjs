import fs from "node:fs";
import path from "node:path";

const PROJECT_ID = /^prj_[0-9a-f-]{36}$/i;
const WORKSPACE_ID = /^ws_[0-9a-f-]{36}$/i;
const CHECKOUT_ID = /^co_[0-9a-f-]{36}$/i;
const DEVICE_ID = /^device_[A-Za-z0-9._-]{8,180}$/;
const ROUTE_ID = /^[A-Za-z0-9._-]{1,120}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function binding(route) {
  const value = route?.binding ?? {};
  const projectId = value.project_id ?? value.projectId;
  const workspaceId = value.workspace_id ?? value.workspaceId;
  const checkoutId = value.checkout_id ?? value.checkoutId;
  const deviceId = value.device_id ?? value.deviceId ?? null;
  if (
    !PROJECT_ID.test(String(projectId ?? "")) ||
    !WORKSPACE_ID.test(String(workspaceId ?? "")) ||
    !CHECKOUT_ID.test(String(checkoutId ?? ""))
  ) fail("history_routing_binding_invalid");
  if (deviceId !== null && !DEVICE_ID.test(String(deviceId))) fail("history_routing_device_invalid");
  return Object.freeze({
    status: "bound",
    projectId,
    workspaceId,
    checkoutId,
    deviceId,
    routeId: route.route_id,
    displayName: route.display_name
  });
}

export function validateCodexHistoryRouting(value) {
  if (
    value?.schema !== "supermemory.codex-history-routing.v1" ||
    !Array.isArray(value.routes) || !value.routes.length
  ) fail("history_routing_invalid");
  const ids = new Set();
  const routes = value.routes.map((route) => {
    if (
      !ROUTE_ID.test(String(route?.route_id ?? "")) || ids.has(route.route_id) ||
      !String(route?.display_name ?? "").trim() || !Array.isArray(route.roots) || !route.roots.length
    ) fail("history_routing_invalid");
    ids.add(route.route_id);
    const roots = [...new Set(route.roots.map((root) => path.resolve(String(root))))];
    return Object.freeze({
      route_id: route.route_id,
      display_name: String(route.display_name).trim().slice(0, 160),
      roots: Object.freeze(roots),
      binding: binding(route)
    });
  });
  if (value.fallback_route_id !== null && value.fallback_route_id !== undefined && !ids.has(value.fallback_route_id)) {
    fail("history_routing_fallback_invalid");
  }
  return Object.freeze({
    schema: value.schema,
    routes: Object.freeze(routes),
    fallback_route_id: value.fallback_route_id ?? null
  });
}

export function loadCodexHistoryRouting(filePath) {
  const target = path.resolve(filePath ?? "");
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) fail("history_routing_file_invalid");
  try {
    return validateCodexHistoryRouting(JSON.parse(fs.readFileSync(target, "utf8")));
  } catch (error) {
    if (error?.code) throw error;
    fail("history_routing_file_invalid");
  }
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function createCodexHistoryBindingResolver({ routing, markerResolver = null } = {}) {
  const config = validateCodexHistoryRouting(routing);
  const ordered = config.routes
    .flatMap((route) => route.roots.map((root) => ({ route, root })))
    .sort((left, right) => right.root.length - left.root.length);
  const fallback = config.fallback_route_id
    ? config.routes.find((route) => route.route_id === config.fallback_route_id)
    : null;
  return (cwd) => {
    const requested = path.resolve(String(cwd ?? ""));
    const matched = ordered.find((entry) => within(entry.root, requested));
    if (matched) return matched.route.binding;
    if (typeof markerResolver === "function") {
      try {
        const local = markerResolver(requested);
        if (local?.status === "bound") return local;
      } catch {
        // Historical paths may no longer exist; an explicit fallback can still own them.
      }
    }
    return fallback?.binding ?? { status: "unbound" };
  };
}
