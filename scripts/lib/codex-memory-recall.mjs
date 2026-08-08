import fs from "node:fs";
import path from "node:path";

export class CodexMemoryRecallError extends Error {
  constructor(code) {
    super(code);
    this.name = "CodexMemoryRecallError";
    this.code = code;
  }
}

function fail(code) {
  throw new CodexMemoryRecallError(code);
}

function assertNoScopeArguments(input) {
  for (const key of ["cwd", "workspace", "workspace_id", "workspaceId", "project_id", "projectId"]) {
    if (Object.hasOwn(input ?? {}, key)) fail("scope_argument_forbidden");
  }
}

function tokens(value) {
  return [...new Set(String(value ?? "")
    .toLocaleLowerCase("fr")
    .match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
}

function localScore(memory, queryTokens) {
  const title = String(memory.title).toLocaleLowerCase("fr");
  const text = String(memory.text).toLocaleLowerCase("fr");
  let score = 0;
  for (const token of queryTokens) {
    if (title.includes(token)) score += 3;
    if (text.includes(token)) score += 1;
  }
  return queryTokens.length === 0 ? 0 : score / (queryTokens.length * 4);
}

function excerpt(value, maximum = 480) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`;
}

function citationFor(workspaceStore, candidate) {
  return {
    candidate_id: candidate.candidate_id,
    event_ids: [...candidate.event_ids],
    turn_snapshot_id: candidate.turn_snapshot_id,
    source_snapshot_ids: [...candidate.source_snapshot_ids],
    locator: workspaceStore.resolveCitation(candidate)
  };
}

export function createCodexMemoryRecall({
  workspaceStore,
  hindsight = null,
  clock = () => new Date().toISOString(),
  maxLimit = 10
} = {}) {
  if (!workspaceStore?.workspaceId || !workspaceStore?.projectId) fail("scope_unresolved");
  if (!Number.isSafeInteger(maxLimit) || maxLimit < 1 || maxLimit > 50) fail("limit_invalid");

  const scopedMemory = (memoryId) => {
    let memory;
    try {
      memory = workspaceStore.getMemory(memoryId, { includeInactive: true });
    } catch (error) {
      if (error?.code !== "memory_not_active") throw error;
      const memoryRoot = path.dirname(workspaceStore.paths.memoryRoot);
      if (fs.existsSync(memoryRoot)) {
        for (const entry of fs.readdirSync(memoryRoot, { withFileTypes: true })) {
          if (
            entry.isDirectory() &&
            entry.name !== workspaceStore.workspaceId &&
            fs.existsSync(path.join(memoryRoot, entry.name, `${memoryId}.json`))
          ) fail("scope_mismatch");
        }
      }
      fail("memory_not_found");
    }
    if (memory.workspace_id !== workspaceStore.workspaceId) fail("scope_mismatch");
    if (memory.status !== "active") fail("memory_not_active");
    if (
      memory.sensitivity !== "standard" ||
      !memory.allowed_consumers.includes("codex")
    ) fail("memory_access_denied");
    const now = Date.parse(clock());
    if (
      Date.parse(memory.valid_from) > now ||
      (memory.valid_until && Date.parse(memory.valid_until) <= now)
    ) fail("memory_not_active");
    return memory;
  };

  const explainCitation = (input = {}) => {
    assertNoScopeArguments(input);
    const memory = scopedMemory(input.memory_id);
    const candidate = workspaceStore.getCandidate(memory.candidate_id);
    return {
      project_id: workspaceStore.projectId,
      workspace_id: workspaceStore.workspaceId,
      memory_id: memory.memory_id,
      chain: {
        candidate_id: candidate.candidate_id,
        event_ids: [...candidate.event_ids],
        turn_snapshot_id: candidate.turn_snapshot_id,
        source_snapshot_ids: [...candidate.source_snapshot_ids],
        locator: citationFor(workspaceStore, candidate).locator
      },
      archive_content_included: false
    };
  };

  const present = (memory, score) => {
    const candidate = workspaceStore.getCandidate(memory.candidate_id);
    return {
      memory_id: memory.memory_id,
      title: memory.title,
      excerpt: excerpt(memory.text),
      score,
      freshness: "current",
      sensitivity: memory.sensitivity,
      type: candidate.type,
      citation: citationFor(workspaceStore, candidate)
    };
  };

  const search = async (input = {}) => {
    assertNoScopeArguments(input);
    const query = String(input.query ?? "").trim();
    if (!query || query.length > 4_000) fail("query_invalid");
    const requestedLimit = input.limit === undefined ? 5 : Number(input.limit);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) fail("limit_invalid");
    const limit = Math.min(requestedLimit, maxLimit);
    if (
      input.types !== undefined &&
      (!Array.isArray(input.types) || input.types.some((type) => typeof type !== "string"))
    ) fail("types_invalid");
    const typeFilter = input.types === undefined ? null : new Set(input.types);
    const asOf = input.as_of ?? null;
    if (asOf !== null && !Number.isFinite(Date.parse(asOf))) fail("as_of_invalid");
    const active = workspaceStore.listActiveMemories({ consumer: "codex" })
      .filter((memory) => {
        if (asOf && Date.parse(memory.approved_at) > Date.parse(asOf)) return false;
        const candidate = workspaceStore.getCandidate(memory.candidate_id);
        return !typeFilter || typeFilter.has(candidate.type);
      });
    const activeById = new Map(active.map((memory) => [memory.memory_id, memory]));
    let mode = "local_fallback";
    let fallbackReason = hindsight?.enabled ? null : "hindsight_disabled";
    let ranked = [];
    let ignoredUnknown = 0;
    let hindsightTrace = null;
    if (hindsight?.enabled) {
      try {
        const recalled = await hindsight.recall(query);
        mode = "hindsight";
        hindsightTrace = recalled.trace;
        ranked = recalled.results.flatMap((result) => {
          const memory = activeById.get(result.memoryId);
          if (!memory) {
            ignoredUnknown += 1;
            return [];
          }
          return [{ memory, score: Number(result.score) || 0 }];
        });
      } catch (error) {
        mode = "local_fallback";
        fallbackReason = error?.code ?? "hindsight_unavailable";
      }
    }
    if (mode === "local_fallback") {
      const queryTokens = tokens(query);
      ranked = active
        .map((memory) => ({ memory, score: localScore(memory, queryTokens) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => (
          right.score - left.score ||
          left.memory.memory_id.localeCompare(right.memory.memory_id)
        ));
    }
    const total = ranked.length;
    return {
      mode,
      fallback_reason: fallbackReason,
      project_id: workspaceStore.projectId,
      workspace_id: workspaceStore.workspaceId,
      results: ranked.slice(0, limit).map((entry) => present(entry.memory, entry.score)),
      bounded: requestedLimit > maxLimit || total > limit,
      limit,
      pagination: total > limit ? "not_available_v1" : null,
      trace: {
        ignored_unknown_hindsight_results: ignoredUnknown,
        hindsight: hindsightTrace
      }
    };
  };

  const get = (input = {}) => {
    assertNoScopeArguments(input);
    const memory = scopedMemory(input.memory_id);
    return {
      project_id: workspaceStore.projectId,
      workspace_id: workspaceStore.workspaceId,
      memory: {
        ...memory,
        citation: explainCitation({ memory_id: memory.memory_id }).chain
      }
    };
  };

  const status = async () => ({
    project_id: workspaceStore.projectId,
    workspace_id: workspaceStore.workspaceId,
    active_memories: workspaceStore.listActiveMemories({ consumer: "codex" }).length,
    projection: hindsight ? await hindsight.status() : {
      status: "disabled",
      available: false,
      bankId: null
    },
    archive_content_exposed: false
  });

  return {
    workspaceId: workspaceStore.workspaceId,
    projectId: workspaceStore.projectId,
    search,
    get,
    explainCitation,
    status,
    sessionMemories: ({ limit = 5 } = {}) => workspaceStore
      .listActiveMemories({ consumer: "codex" })
      .slice(0, Math.min(limit, 5))
      .map((memory) => ({
        memory_id: memory.memory_id,
        title: memory.title,
        text: memory.text,
        status: memory.status,
        sensitivity: memory.sensitivity,
        allowed_consumers: memory.allowed_consumers,
        citation: explainCitation({ memory_id: memory.memory_id }).chain
      }))
  };
}
