const HEADER_CHECKOUT = "x-supermemory-checkout-id";
const HEADER_DEVICE = "x-supermemory-device-id";
const HEADER_TOKEN = "x-supermemory-checkout-token";

function fail() {
  const error = new Error("not_authorized");
  error.code = "not_authorized";
  throw error;
}

function headerValue(headers, name) {
  const value = typeof headers?.get === "function" ? headers.get(name) : headers?.[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return typeof value === "string" ? value : null;
}

function asserted(input, snake, camel) {
  if (Object.hasOwn(input ?? {}, snake)) return input[snake];
  if (Object.hasOwn(input ?? {}, camel)) return input[camel];
  return undefined;
}

export function createRequestScopeResolver({ credentialStore } = {}) {
  if (!credentialStore || typeof credentialStore.authenticate !== "function") {
    throw new Error("scope_credential_store_invalid");
  }
  return ({ headers, input = {}, capability = "recall" } = {}) => {
    const checkoutId = headerValue(headers, HEADER_CHECKOUT);
    const deviceId = headerValue(headers, HEADER_DEVICE);
    const token = headerValue(headers, HEADER_TOKEN);
    let scope;
    try {
      scope = credentialStore.authenticate({ checkoutId, deviceId, token, capability });
    } catch {
      fail();
    }
    const expected = [
      [asserted(input, "workspace_id", "workspaceId"), scope.workspaceId],
      [asserted(input, "project_id", "projectId"), scope.projectId],
      [asserted(input, "checkout_id", "checkoutId"), scope.checkoutId]
    ];
    if (expected.some(([value, canonical]) => value !== undefined && value !== canonical)) fail();
    return Object.freeze({ ...scope, capability });
  };
}

export const CHECKOUT_SCOPE_HEADERS = Object.freeze({
  checkout: HEADER_CHECKOUT,
  device: HEADER_DEVICE,
  token: HEADER_TOKEN
});
