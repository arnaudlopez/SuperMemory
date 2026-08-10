import assert from "node:assert/strict";
import test from "node:test";
import { createAgentScopeResolver } from "../scripts/lib/agent-scope-resolver.mjs";

const OWNER = {
  ownerId: "owner_personal",
  agentId: "agent_personal_manager",
  deviceId: "device_z2",
  capabilities: ["pm:recall", "pm:write"]
};
const PROJECTS = [
  { projectId: "prj_11111111-1111-4111-8111-111111111111", workspaceId: "ws_11111111-1111-4111-8111-111111111111", status: "active" },
  { projectId: "prj_22222222-2222-4222-8222-222222222222", workspaceId: "ws_22222222-2222-4222-8222-222222222222", status: "active" },
  { projectId: "prj_33333333-3333-4333-8333-333333333333", workspaceId: "ws_33333333-3333-4333-8333-333333333333", status: "archived" }
];

test("agent scope is derived from owner registry and rejects raw workspace assertions", () => {
  const resolver = createAgentScopeResolver({
    credentialStore: { authenticate: () => OWNER },
    projectRegistry: { snapshot: () => ({
      owner: { ownerId: "owner_personal", workspaceId: "ws_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", projectId: "prj_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      projects: PROJECTS
    }) }
  });
  const headers = {
    "x-supermemory-agent-id": "agent_personal_manager",
    "x-supermemory-agent-device": "device_z2",
    "x-supermemory-agent-token": "sma_test"
  };
  const scope = resolver({ headers, capability: "pm:recall" });
  assert.equal(scope.ownerId, "owner_personal");
  assert.equal(scope.ownerWorkspaceId, "ws_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.deepEqual(scope.allowedProjectIds, PROJECTS.slice(0, 2).map((item) => item.projectId));
  assert.equal(Object.isFrozen(scope), true);
  assert.throws(() => resolver({
    headers,
    capability: "pm:recall",
    input: { workspace_id: PROJECTS[0].workspaceId }
  }), { message: "not_authorized" });
  assert.throws(() => resolver({
    headers,
    capability: "pm:write",
    input: { project_id: "prj_99999999-9999-4999-8999-999999999999" }
  }), { message: "not_authorized" });
});
