import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceRuntimeSupervisor } from "../scripts/lib/workspace-runtime-supervisor.mjs";

const A = {
  workspaceId: "ws_018f7c0e-7b7d-7abc-8def-0123456789aa",
  projectId: "prj_018f7c0e-7b7d-7abc-8def-0123456789ab",
  checkoutId: "co_018f7c0e-7b7d-7abc-8def-0123456789ac"
};
const B = {
  workspaceId: "ws_018f7c0e-7b7d-7abc-8def-0123456789ba",
  projectId: "prj_018f7c0e-7b7d-7abc-8def-0123456789bb",
  checkoutId: "co_018f7c0e-7b7d-7abc-8def-0123456789bc"
};

test("supervisor isolates scopes, merges owner recall and evicts bounded contexts", async () => {
  const projects = [A, B].map((item) => ({
    projectId: item.projectId, workspaceId: item.workspaceId, status: "active"
  }));
  const checkouts = [A, B].map((item) => ({
    checkoutId: item.checkoutId, projectId: item.projectId, workspaceId: item.workspaceId
  }));
  const closed = [];
  const supervisor = createWorkspaceRuntimeSupervisor({
    registry: { snapshot: () => ({ projects, checkouts }) },
    maxActiveProjectContexts: 1,
    idleTtlMs: 1_000,
    createContext: async ({ workspaceId, projectId }) => ({
      workspaceId,
      projectId,
      router: {
        recall: async () => ({ results: [{ memory_id: `project:${projectId}`, text: projectId, score: 1 }] }),
        status: async () => ({ workspace_id: workspaceId, project_id: projectId })
      },
      close: async () => closed.push(projectId)
    }),
    ownerRecall: async () => ({ results: [{ memory_id: "owner:preference", text: "owner", score: 2 }] })
  });
  const recalled = await supervisor.invoke(A, "recall", { query: "preference", limit: 5 });
  assert.deepEqual(recalled.results.map((item) => item.scope), ["owner", "project"]);
  await supervisor.invoke(B, "status", {});
  assert.deepEqual(closed, [A.projectId]);
  assert.equal(supervisor.status().active_contexts, 1);
  await assert.rejects(() => supervisor.invoke({ ...A, projectId: B.projectId }, "status", {}), /not_authorized/);
});

test("supervisor never evicts a context with an active invocation", async () => {
  const projects = [A, B].map((item) => ({
    projectId: item.projectId, workspaceId: item.workspaceId, status: "active"
  }));
  const checkouts = [A, B].map((item) => ({
    checkoutId: item.checkoutId, projectId: item.projectId, workspaceId: item.workspaceId
  }));
  let release;
  const active = new Promise((resolve) => { release = resolve; });
  const closed = [];
  const supervisor = createWorkspaceRuntimeSupervisor({
    registry: { snapshot: () => ({ projects, checkouts }) },
    maxActiveProjectContexts: 1,
    createContext: async ({ workspaceId, projectId }) => ({
      workspaceId,
      projectId,
      router: {
        hold: async () => active,
        status: async () => ({ ok: true })
      },
      close: async () => closed.push(projectId)
    })
  });
  const invocation = supervisor.invoke(A, "hold", {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.status().contexts[0].active_invocations, 1);
  await assert.rejects(() => supervisor.invoke(B, "status", {}), /runtime_context_capacity_exhausted/);
  assert.deepEqual(closed, []);
  release({ ok: true });
  await invocation;
  await supervisor.invoke(B, "status", {});
  assert.deepEqual(closed, [A.projectId]);
});

test("supervisor readiness recovery does not wait for canonical backlog processing", async () => {
  let releaseWorker;
  const workerFinished = new Promise((resolve) => { releaseWorker = resolve; });
  let fabricRebuilds = 0;
  let workerRecoveries = 0;
  const supervisor = createWorkspaceRuntimeSupervisor({
    registry: {
      snapshot: () => ({
        projects: [{ projectId: A.projectId, workspaceId: A.workspaceId, status: "active" }],
        checkouts: []
      })
    },
    createContext: async ({ workspaceId, projectId }) => ({
      workspaceId,
      projectId,
      router: {
        rebuildFabric: async () => { fabricRebuilds += 1; }
      },
      worker: {
        recover: async () => {
          workerRecoveries += 1;
          await workerFinished;
        },
        status: () => ({ enabled: true })
      }
    })
  });

  const recovered = await supervisor.recover();
  assert.equal(recovered.recovered, 1);
  assert.equal(fabricRebuilds, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workerRecoveries, 1);
  assert.equal(supervisor.status().worker_recovery.status, "running");

  releaseWorker();
  await supervisor.recoverWorkers();
  assert.equal(supervisor.status().worker_recovery.status, "complete");
});
