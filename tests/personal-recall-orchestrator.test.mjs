import assert from "node:assert/strict";
import test from "node:test";
import { createPersonalRecallOrchestrator } from "../scripts/lib/personal-recall-orchestrator.mjs";

const PROJECTS = [1, 2, 3].map((n) => ({
  projectId: `prj_00000000-0000-4000-8000-00000000000${n}`,
  workspaceId: `ws_00000000-0000-4000-8000-00000000000${n}`,
  displayName: `Project ${n}`,
  status: "active"
}));
const scope = {
  ownerId: "owner_personal",
  ownerWorkspaceId: "ws_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  allowedProjectIds: PROJECTS.map((item) => item.projectId)
};

test("portfolio recall searches every owned project and reports complete coverage", async () => {
  let active = 0;
  let maxActive = 0;
  const orchestrator = createPersonalRecallOrchestrator({
    projectRegistry: { snapshot: () => ({ projects: PROJECTS }) },
    ownerRecall: async () => ({ results: [{ memory_id: "owner_1", text: "owner", score: 0.4, citations: [{ evidence_id: "e_owner" }] }] }),
    projectRecall: async ({ project }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { results: [{ memory_id: `mem_${project.projectId}`, text: project.displayName, score: 0.8, citations: [{ evidence_id: `e_${project.projectId}` }] }] };
    },
    concurrency: 2
  });
  const result = await orchestrator.recall({ scope, query: "status", mode: "portfolio", limit: 10 });
  assert.equal(result.coverage.status, "complete");
  assert.deepEqual(result.coverage.searched_project_ids, scope.allowedProjectIds);
  assert.equal(result.results.length, 4);
  assert.ok(result.results.every((item) => item.scope && item.citations.length > 0));
  assert.ok(maxActive <= 2);
});

test("portfolio recall never claims completeness when one project fails", async () => {
  const orchestrator = createPersonalRecallOrchestrator({
    projectRegistry: { snapshot: () => ({ projects: PROJECTS }) },
    ownerRecall: async () => ({ results: [] }),
    projectRecall: async ({ project }) => {
      if (project.projectId === PROJECTS[1].projectId) throw new Error("backend_down");
      return { results: [] };
    }
  });
  const result = await orchestrator.recall({ scope, query: "all", mode: "portfolio" });
  assert.equal(result.coverage.status, "partial");
  assert.deepEqual(result.coverage.failed_project_ids, [PROJECTS[1].projectId]);
});

test("owner recall normalizes a singular canonical citation object", async () => {
  const orchestrator = createPersonalRecallOrchestrator({
    projectRegistry: { snapshot: () => ({ projects: PROJECTS }) },
    ownerRecall: async () => ({
      results: [{
        memory_id: "owner_longitudinal_1",
        text: "automatic consolidation",
        citation: { memory_id: "owner_longitudinal_1", revision: 1 }
      }]
    }),
    projectRecall: async () => ({ results: [] })
  });
  const result = await orchestrator.recall({ scope, query: "automatic", mode: "portfolio" });
  assert.deepEqual(result.results[0].citations, [{
    memory_id: "owner_longitudinal_1",
    revision: 1,
    scope: "owner",
    project_id: null
  }]);
});

test("project mode rejects projects outside the resolved owner scope", async () => {
  const orchestrator = createPersonalRecallOrchestrator({
    projectRegistry: { snapshot: () => ({ projects: PROJECTS }) },
    ownerRecall: async () => ({ results: [] }),
    projectRecall: async () => ({ results: [] })
  });
  await assert.rejects(orchestrator.recall({
    scope,
    query: "secret",
    mode: "project",
    projectId: "prj_99999999-9999-4999-8999-999999999999"
  }), { message: "not_authorized" });
});
