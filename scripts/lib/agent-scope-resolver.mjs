const PROJECT_ID = /^prj_[0-9a-f-]{36}$/i;

function fail() {
  const error = new Error("not_authorized");
  error.code = "not_authorized";
  throw error;
}

function header(headers, name) {
  const value = typeof headers?.get === "function" ? headers.get(name) : headers?.[name];
  return typeof value === "string" ? value : null;
}

export function createAgentScopeResolver({ credentialStore, projectRegistry } = {}) {
  if (!credentialStore?.authenticate || !projectRegistry?.snapshot) throw new Error("agent_scope_configuration_invalid");
  return ({ headers, input = {}, capability = "pm:recall" } = {}) => {
    let identity;
    try {
      identity = credentialStore.authenticate({
        agentId: header(headers, "x-supermemory-agent-id"),
        deviceId: header(headers, "x-supermemory-agent-device"),
        token: header(headers, "x-supermemory-agent-token"),
        audience: "supermemoryd",
        capability
      });
    } catch {
      fail();
    }
    if (Object.hasOwn(input, "workspace_id") || Object.hasOwn(input, "workspaceId")) fail();
    const snapshot = projectRegistry.snapshot();
    if (!snapshot.owner || snapshot.owner.ownerId !== identity.ownerId) fail();
    const projects = snapshot.projects.filter((item) => item.status === "active");
    const allowedProjectIds = projects.map((item) => item.projectId);
    const assertedProject = input.project_id ?? input.projectId ?? null;
    if (assertedProject !== null && (!PROJECT_ID.test(String(assertedProject)) || !allowedProjectIds.includes(assertedProject))) fail();
    return Object.freeze({
      ...identity,
      ownerWorkspaceId: snapshot.owner.workspaceId,
      ownerProjectId: snapshot.owner.projectId,
      allowedProjectIds: Object.freeze([...allowedProjectIds]),
      projects: Object.freeze(projects.map((item) => Object.freeze({ projectId: item.projectId, workspaceId: item.workspaceId, displayName: item.displayName ?? item.projectId }))),
      capability
    });
  };
}

export const AGENT_SCOPE_HEADERS = Object.freeze({ agent: "x-supermemory-agent-id", device: "x-supermemory-agent-device", token: "x-supermemory-agent-token" });
