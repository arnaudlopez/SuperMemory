const PROJECT_ID = /^prj_[0-9a-f-]{36}$/i;
const WORKSPACE_ID = /^ws_[0-9a-f-]{36}$/i;
const CHECKOUT_ID = /^co_[0-9a-f-]{36}$/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertScope(scope, { requireCheckout = true } = {}) {
  if (
    !WORKSPACE_ID.test(String(scope?.workspaceId ?? "")) ||
    !PROJECT_ID.test(String(scope?.projectId ?? "")) ||
    (requireCheckout && !CHECKOUT_ID.test(String(scope?.checkoutId ?? "")))
  ) fail("not_authorized");
  return scope;
}

function projectKey(scope) {
  return `${scope.workspaceId}\0${scope.projectId}`;
}

function validateRegistryScope(registry, scope, requireCheckout) {
  const snapshot = registry.snapshot();
  const project = snapshot.projects.find((item) => (
    item.projectId === scope.projectId && item.workspaceId === scope.workspaceId && item.status === "active"
  ));
  if (!project) fail("not_authorized");
  if (requireCheckout) {
    const checkout = snapshot.checkouts.find((item) => (
      item.checkoutId === scope.checkoutId && item.projectId === scope.projectId &&
      item.workspaceId === scope.workspaceId
    ));
    if (!checkout) fail("not_authorized");
  }
  return project;
}

function scopedResults(results, scope) {
  return (results ?? []).map((item) => ({
    ...item,
    scope,
    citations: (item.citations ?? []).map((citation) => ({ ...citation, scope }))
  }));
}

function mergeRecall(projectResult, ownerResult, limit) {
  if (!ownerResult || !Array.isArray(ownerResult.results) || ownerResult.results.length === 0) {
    return { ...projectResult, results: scopedResults(projectResult.results, "project") };
  }
  const candidates = [
    ...scopedResults(projectResult.results, "project"),
    ...scopedResults(ownerResult.results, "owner")
  ].sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const key = item.memory_id ?? item.evidence_id ?? `${String(item.text ?? "").trim().toLowerCase()}\0${item.scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
    if (results.length >= limit) break;
  }
  return {
    ...projectResult,
    results,
    owner_memory: {
      included: true,
      results: ownerResult.results.length,
      partial: ownerResult.partial === true
    },
    partial: projectResult.partial === true || ownerResult.partial === true
  };
}

export function createWorkspaceRuntimeSupervisor({
  registry,
  createContext,
  ownerRecall = null,
  maxActiveProjectContexts = 16,
  idleTtlMs = 1_800_000,
  clock = () => Date.now()
} = {}) {
  if (!registry || typeof registry.snapshot !== "function" || typeof createContext !== "function") {
    fail("runtime_supervisor_configuration_invalid");
  }
  if (
    !Number.isSafeInteger(maxActiveProjectContexts) || maxActiveProjectContexts < 1 ||
    !Number.isSafeInteger(idleTtlMs) || idleTtlMs < 1_000
  ) fail("runtime_supervisor_configuration_invalid");
  const contexts = new Map();
  const pending = new Map();
  const metrics = {
    context_start_total: 0,
    context_hit_total: 0,
    context_eviction_total: 0,
    invocation_total: 0,
    invocation_failed_total: 0
  };

  const evictOne = async () => {
    if (contexts.size < maxActiveProjectContexts) return;
    const candidates = [...contexts.entries()]
      .filter(([, entry]) => entry.active === 0)
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
    const [key, entry] = candidates[0] ?? [];
    if (!entry) fail("runtime_context_capacity_exhausted");
    if (typeof entry.context.close === "function") await entry.context.close();
    contexts.delete(key);
    metrics.context_eviction_total += 1;
  };

  const getContext = async (rawScope, { requireCheckout = true } = {}) => {
    const scope = assertScope(rawScope, { requireCheckout });
    validateRegistryScope(registry, scope, requireCheckout);
    const key = projectKey(scope);
    const existing = contexts.get(key);
    if (existing) {
      existing.lastUsedAt = clock();
      metrics.context_hit_total += 1;
      return existing.context;
    }
    if (pending.has(key)) return pending.get(key);
    const creation = (async () => {
      await evictOne();
      const context = await createContext({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId
      });
      if (!context?.router) fail("runtime_context_invalid");
      contexts.set(key, { context, lastUsedAt: clock(), active: 0 });
      metrics.context_start_total += 1;
      return context;
    })();
    pending.set(key, creation);
    try {
      return await creation;
    } finally {
      pending.delete(key);
    }
  };

  const withContext = async (scope, requireCheckout, callback) => {
    const context = await getContext(scope, { requireCheckout });
    const entry = contexts.get(projectKey(scope));
    if (!entry) fail("runtime_context_invalid");
    entry.active += 1;
    entry.lastUsedAt = clock();
    try {
      return await callback(context);
    } finally {
      entry.active -= 1;
      entry.lastUsedAt = clock();
    }
  };

  const invoke = async (scope, method, input = {}) => {
    metrics.invocation_total += 1;
    try {
      return await withContext(scope, true, async (context) => {
        const operation = context.router?.[method];
        if (typeof operation !== "function") fail("backend_unavailable");
        const projectResult = await operation(input);
        if (!["recall", "search"].includes(method) || typeof ownerRecall !== "function") return projectResult;
        const ownerResult = await ownerRecall({
          query: input.query,
          types: input.types,
          as_of: input.as_of,
          limit: input.limit ?? 20
        }).catch(() => null);
        return mergeRecall(projectResult, ownerResult, input.limit ?? 20);
      });
    } catch (error) {
      metrics.invocation_failed_total += 1;
      throw error;
    }
  };

  const invokeProject = async (scope, method, input = {}) => {
    metrics.invocation_total += 1;
    try {
      return await withContext(scope, false, async (context) => {
        const operation = context.router?.[method];
        if (typeof operation !== "function") fail("backend_unavailable");
        return operation(input);
      });
    } catch (error) {
      metrics.invocation_failed_total += 1;
      throw error;
    }
  };

  const forScope = (scope) => Object.freeze(new Proxy({}, {
    get(_target, property) {
      if (property === "scope") return Object.freeze({ ...scope });
      if (property === "status") return () => invoke(scope, "status", {});
      if (typeof property !== "string") return undefined;
      return (input = {}) => invoke(scope, property, input);
    }
  }));

  const forProject = (scope) => Object.freeze(new Proxy({}, {
    get(_target, property) {
      if (property === "scope") return Object.freeze({ ...scope });
      if (property === "status") return () => invokeProject(scope, "status", {});
      if (typeof property !== "string") return undefined;
      return (input = {}) => invokeProject(scope, property, input);
    }
  }));

  const notifySessionClosed = async (scope, { sessionId } = {}) => {
    await withContext(scope, Boolean(scope?.checkoutId), async (context) => {
      if (typeof context.worker?.notifySessionClosed === "function") {
        await context.worker.notifySessionClosed({ sessionId });
      }
    });
  };

  const evictIdle = async () => {
    const cutoff = clock() - idleTtlMs;
    for (const [key, entry] of [...contexts.entries()]) {
      if (entry.lastUsedAt > cutoff) continue;
      if (entry.active > 0) continue;
      if (typeof entry.context.close === "function") await entry.context.close();
      contexts.delete(key);
      metrics.context_eviction_total += 1;
    }
    return contexts.size;
  };

  const recover = async () => {
    const failures = [];
    for (const project of registry.snapshot().projects.filter((item) => item.status === "active")) {
      try {
        const context = await getContext({
          workspaceId: project.workspaceId,
          projectId: project.projectId
        }, { requireCheckout: false });
        if (typeof context.router.rebuildFabric === "function") await context.router.rebuildFabric({});
        if (typeof context.worker?.recover === "function") await context.worker.recover();
      } catch (error) {
        failures.push({ project_id: project.projectId, error: error?.code ?? "recovery_failed" });
      }
    }
    return { recovered: registry.snapshot().projects.length - failures.length, failures };
  };

  const close = async () => {
    for (const entry of contexts.values()) {
      if (typeof entry.context.close === "function") await entry.context.close();
    }
    contexts.clear();
  };

  const status = () => ({
    schema: "supermemory.runtime-supervisor-status.v1",
    active_contexts: contexts.size,
    pending_contexts: pending.size,
    max_active_contexts: maxActiveProjectContexts,
    contexts: [...contexts.values()].map(({ context, lastUsedAt, active }) => ({
      schema: "supermemory.runtime-context-status.v1",
      workspace_id: context.workspaceId,
      project_id: context.projectId,
      state: "warm",
      active_invocations: active,
      last_used_at_ms: lastUsedAt,
      canonical_worker: context.worker?.status?.() ?? { enabled: false }
    })),
    metrics: { ...metrics }
  });

  return Object.freeze({
    getContext,
    forScope,
    forProject,
    invoke,
    invokeProject,
    notifySessionClosed,
    evictIdle,
    recover,
    close,
    status
  });
}
