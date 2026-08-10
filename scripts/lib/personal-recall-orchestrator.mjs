function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function citationList(item) {
  const value = item?.citations ?? item?.citation ?? [];
  return (Array.isArray(value) ? value.flat(Infinity) : [value])
    .filter((citation) => citation && (typeof citation === "object" || typeof citation === "string"))
    .map((citation) => typeof citation === "string" ? { evidence_id: citation } : citation);
}

function scoped(results, scope, project = null) {
  return (results ?? []).map((item) => ({
    ...item,
    scope,
    project_id: project?.projectId ?? item.project_id ?? null,
    project_name: project?.displayName ?? item.project_name ?? null,
    citations: citationList(item).map((citation) => ({ ...citation, scope, project_id: project?.projectId ?? citation.project_id ?? null }))
  }));
}

async function mapLimit(values, limit, callback) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await callback(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createPersonalRecallOrchestrator({ projectRegistry, ownerRecall, projectRecall, concurrency = 4 } = {}) {
  if (!projectRegistry?.snapshot || typeof ownerRecall !== "function" || typeof projectRecall !== "function" || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) fail("personal_recall_configuration_invalid");
  const recall = async ({ scope, query, mode = "auto", projectId = null, asOf = null, limit = 20 } = {}) => {
    if (!scope?.ownerId || !Array.isArray(scope.allowedProjectIds) || typeof query !== "string" || !query.trim()) fail("personal_recall_input_invalid");
    const active = projectRegistry.snapshot().projects.filter((item) => item.status === "active" && scope.allowedProjectIds.includes(item.projectId));
    let projects;
    if (mode === "project") {
      if (!scope.allowedProjectIds.includes(projectId)) fail("not_authorized");
      projects = active.filter((item) => item.projectId === projectId);
      if (!projects.length) fail("not_authorized");
    } else if (["portfolio", "historical"].includes(mode)) projects = active;
    else if (mode === "auto") projects = projectId ? active.filter((item) => item.projectId === projectId) : [];
    else fail("personal_recall_mode_invalid");

    const owner = await ownerRecall({ query, as_of: asOf, limit }).catch(() => null);
    const projectOutcomes = await mapLimit(projects, concurrency, async (project) => {
      try {
        const value = await projectRecall({ project, query, asOf, historical: mode === "historical", limit });
        return { project, value, error: null };
      } catch (error) {
        return { project, value: null, error: error?.code ?? error?.message ?? "recall_failed" };
      }
    });
    const failed = projectOutcomes.filter((item) => item.error).map((item) => item.project.projectId);
    const candidates = [
      ...scoped(owner?.results, "owner"),
      ...projectOutcomes.flatMap((item) => item.value ? scoped(item.value.results, "project", item.project) : [])
    ].sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
    const seen = new Set();
    const results = [];
    for (const item of candidates) {
      const key = item.memory_id ?? item.evidence_id ?? `${item.scope}:${item.project_id}:${item.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
      if (results.length >= limit) break;
    }
    const required = projects.length;
    const status = failed.length ? (failed.length === required && !owner ? "abstain" : "partial") : "complete";
    return {
      schema: "supermemory.personal-recall-result.v1",
      mode,
      query,
      as_of: asOf,
      results,
      coverage: {
        status,
        owner_searched: owner !== null,
        searched_project_ids: projectOutcomes.filter((item) => !item.error).map((item) => item.project.projectId),
        failed_project_ids: failed,
        total_authorized_projects: active.length,
        exhaustive: ["portfolio", "historical"].includes(mode) && failed.length === 0
      }
    };
  };
  return Object.freeze({ recall });
}
