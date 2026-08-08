import { hindsightReflectSchema } from "./hindsight-reflect-schemas.mjs";

const STRATEGIES = new Set(["auto", "working", "durable", "graph", "hybrid", "temporal"]);
const DIRECTIONS = new Set(["outbound", "inbound", "both"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function boundedInteger(value, fallback, minimum, maximum, code) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) fail(code);
  return number;
}

function unique(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value))].sort();
}

function normalizedText(value) {
  return String(value ?? "").toLocaleLowerCase("fr").replace(/\s+/g, " ").trim();
}

function queryTokens(value) {
  return unique(String(value ?? "").toLocaleLowerCase("fr").match(/[\p{L}\p{N}]{2,}/gu) ?? []);
}

function validateScopeFree(input) {
  for (const key of ["workspace_id", "workspaceId", "project_id", "projectId", "cwd", "session_id", "sessionId"]) {
    if (Object.hasOwn(input, key)) fail("scope_argument_forbidden");
  }
}

function normalizeWorking(result) {
  return (result?.results ?? []).map((item) => ({
    ...item,
    memory_tier: "working",
    memory_tiers: ["working"],
    admission_ids: unique(item.admission_ids),
    admission_states: unique(item.admission_states ?? [item.admission_state ?? "active"]),
    citations: [...(item.citations ?? [])],
    temporal_intervals: [{ valid_from: item.valid_from ?? null, valid_to: item.valid_to ?? null }]
  }));
}

function normalizeDurable(result) {
  return (result?.results ?? []).map((item) => ({
    memory_tier: "durable",
    memory_tiers: ["durable"],
    memory_id: item.memory_id,
    text: item.excerpt ?? item.text ?? item.title ?? "",
    title: item.title ?? null,
    score: Number(item.score) || 0,
    evidence_ids: [],
    episode_ids: [],
    entity_ids: [],
    path_ids: [],
    admission_ids: unique(item.admission_ids),
    admission_states: unique(item.admission_states ?? [item.admission_state ?? "active"]),
    valid_from: item.valid_from ?? null,
    valid_to: item.valid_to ?? null,
    temporal_intervals: [{ valid_from: item.valid_from ?? null, valid_to: item.valid_to ?? null }],
    citations: [{
      kind: "durable_memory",
      memory_id: item.memory_id,
      ...(item.citation ?? {})
    }]
  }));
}

function normalizeHindsight(result) {
  return (result?.results ?? []).map((item) => ({
    memory_tier: item.fact_type === "observation" ? "observation" : "durable",
    memory_tiers: [item.fact_type === "observation" ? "observation" : "durable"],
    memory_id: item.memory_id,
    text: item.text ?? "",
    score: Number(item.score) || 0,
    evidence_ids: unique(item.sources?.flatMap((source) => source.citation?.event_ids ?? source.citation?.evidence_ids ?? []) ?? []),
    episode_ids: [],
    entity_ids: [],
    path_ids: [],
    admission_ids: [],
    admission_states: ["active"],
    valid_from: item.occurred_start ?? null,
    valid_to: item.occurred_end ?? null,
    temporal_intervals: [{ valid_from: item.occurred_start ?? null, valid_to: item.occurred_end ?? null }],
    citations: (Array.isArray(item.citation) ? item.citation : [item.citation]).filter(Boolean),
    source_fact_ids: item.source_fact_ids ?? []
  }));
}

function normalizeGraph(result) {
  return (result?.paths ?? []).map((path) => {
    const claimTexts = unique(path.edges?.map((edge) => edge.claim_text) ?? []);
    const intervals = (path.edges ?? []).map((edge) => ({
      relation_id: edge.relation_id,
      valid_from: edge.valid_from,
      valid_to: edge.valid_to
    }));
    return {
      memory_tier: "graph",
      memory_tiers: ["graph"],
      text: claimTexts.join(" "),
      score: Math.max(0, 1 - ((path.edges?.length ?? 1) - 1) * 0.05),
      evidence_ids: unique(path.edges?.flatMap((edge) => edge.evidence_ids ?? []) ?? []),
      episode_ids: unique(path.edges?.flatMap((edge) => edge.episode_ids ?? []) ?? []),
      entity_ids: unique(path.entity_ids),
      path_id: path.path_id,
      path_ids: [path.path_id],
      admission_ids: unique(path.edges?.map((edge) => edge.admission_id) ?? []),
      admission_states: unique(path.edges?.map((edge) => edge.admission_state ?? "active") ?? []),
      valid_from: intervals.map((item) => item.valid_from).filter(Boolean).sort()[0] ?? null,
      valid_to: intervals.some((item) => item.valid_to === null) ? null : intervals.map((item) => item.valid_to).filter(Boolean).sort().at(-1) ?? null,
      temporal_intervals: intervals,
      citations: (path.edges ?? []).map((edge) => ({
        kind: "graph_edge",
        path_id: path.path_id,
        relation_id: edge.relation_id,
        claim_id: edge.claim_id,
        admission_id: edge.admission_id,
        evidence_ids: edge.evidence_ids,
        episode_ids: edge.episode_ids,
        valid_from: edge.valid_from,
        valid_to: edge.valid_to
      })),
      graph_path: path
    };
  });
}

function mergeResults(results, limit) {
  const groups = [];
  for (const item of results.sort((left, right) => right.score - left.score)) {
    const evidence = new Set(item.evidence_ids ?? []);
    const textKey = normalizedText(item.text);
    let group = groups.find((candidate) => (
      (textKey && candidate.text_key === textKey) ||
      [...evidence].some((id) => candidate.evidence_ids.has(id))
    ));
    if (!group) {
      group = {
        text_key: textKey,
        primary: item,
        tiers: new Set(),
        evidence_ids: new Set(),
        episode_ids: new Set(),
        entity_ids: new Set(),
        path_ids: new Set(),
        admission_ids: new Set(),
        admission_states: new Set(),
        citations: [],
        intervals: []
      };
      groups.push(group);
    }
    if (item.score > group.primary.score) group.primary = item;
    for (const value of item.memory_tiers ?? [item.memory_tier]) group.tiers.add(value);
    for (const value of item.evidence_ids ?? []) group.evidence_ids.add(value);
    for (const value of item.episode_ids ?? []) group.episode_ids.add(value);
    for (const value of item.entity_ids ?? []) group.entity_ids.add(value);
    for (const value of item.path_ids ?? []) group.path_ids.add(value);
    for (const value of item.admission_ids ?? []) group.admission_ids.add(value);
    for (const value of item.admission_states ?? []) group.admission_states.add(value);
    group.citations.push(...(item.citations ?? []));
    group.intervals.push(...(item.temporal_intervals ?? []));
  }
  return groups.map((group) => ({
    ...group.primary,
    memory_tier: group.tiers.size > 1 ? "hybrid" : [...group.tiers][0],
    memory_tiers: [...group.tiers].sort(),
    evidence_ids: [...group.evidence_ids].sort(),
    episode_ids: [...group.episode_ids].sort(),
    entity_ids: [...group.entity_ids].sort(),
    path_ids: [...group.path_ids].sort(),
    admission_ids: [...group.admission_ids].sort(),
    admission_states: [...group.admission_states].sort(),
    citations: group.citations,
    temporal_intervals: group.intervals
  })).sort((left, right) => right.score - left.score || normalizedText(left.text).localeCompare(normalizedText(right.text)))
    .slice(0, limit);
}

function routeAuto(input) {
  const query = normalizedText(input.query);
  if (input.as_of) return { strategy: "temporal", reason: "as_of_present" };
  if (/(pourquoi|why|dépend|depend|chaîne|chain|relation|impact|cause|lié|link)/i.test(query)) {
    return { strategy: "graph", reason: "relational_intent" };
  }
  if (/(session|courant|current|dernier test|last test|erreur|error|fichier modifié|changed file)/i.test(query)) {
    return { strategy: "working", reason: "session_state_intent" };
  }
  if (/(préférence|preference|souvenir|memory|décision durable|long terme|long-term)/i.test(query)) {
    return { strategy: "durable", reason: "durable_memory_intent" };
  }
  return { strategy: "hybrid", reason: "ambiguous_parallel_fallback" };
}

export function createCodexMemoryRouter({
  workspaceId,
  projectId,
  workingRecall,
  durableRecall = null,
  hindsightGateway = null,
  ontologyRegistry = null,
  learnedPlane = null,
  graphAdapter = null,
  timeoutMs = 1_500,
  pathTtlMs = 60_000,
  maxLimit = 20,
  monotonicNow = () => performance.now(),
  wallClock = () => new Date().toISOString()
} = {}) {
  if (
    typeof workspaceId !== "string" || typeof projectId !== "string" ||
    !workingRecall || typeof workingRecall.assertBound !== "function"
  ) fail("memory_router_configuration_invalid");
  boundedInteger(timeoutMs, 1_500, 1, 30_000, "memory_router_timeout_invalid");
  boundedInteger(pathTtlMs, 60_000, 1, 3_600_000, "memory_router_timeout_invalid");
  boundedInteger(maxLimit, 20, 1, 50, "memory_router_limit_invalid");
  const paths = new Map();

  const assertBound = (input) => workingRecall.assertBound({ working_set_id: input.working_set_id });
  const timeout = (tier, operation, started) => new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ tier, status: "timeout", results: [], duration_ms: monotonicNow() - started });
    }, timeoutMs);
    Promise.resolve().then(operation).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ tier, status: "complete", results: value, duration_ms: monotonicNow() - started });
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        tier,
        status: error?.code === "backend_unavailable" ? "unavailable" : "error",
        error: error?.code ?? "tier_failed",
        results: [],
        duration_ms: monotonicNow() - started
      });
    });
  });

  const graphQueryInput = (input, strategy) => {
    for (const key of ["cypher", "statement", "query_ast"]) if (Object.hasOwn(input, key)) fail("graph_query_unsafe");
    for (const key of ["entity_ids", "relation_types"]) {
      if (
        input[key] !== undefined &&
        (!Array.isArray(input[key]) || input[key].length > 20 || input[key].some((value) => typeof value !== "string" || !value))
      ) fail("graph_query_shape_invalid");
    }
    const maxHops = boundedInteger(input.max_hops, 3, 1, 5, "graph_query_hops_invalid");
    const direction = input.direction ?? "both";
    if (!DIRECTIONS.has(direction)) fail("graph_query_direction_invalid");
    if (!graphAdapter || typeof graphAdapter.readAuthorizedState !== "function" || typeof graphAdapter.query !== "function") {
      throw Object.assign(new Error("backend_unavailable"), { code: "backend_unavailable" });
    }
    const state = graphAdapter.readAuthorizedState({ workspaceId, asOf: input.as_of ?? wallClock() });
    const tokens = queryTokens(input.query);
    const requestedEntities = unique(input.entity_ids);
    const entityIds = requestedEntities.length > 0 ? requestedEntities : state.entities.filter((entity) => {
      const names = [entity.canonical_name, ...(entity.aliases ?? [])].map(normalizedText).join(" ");
      return tokens.some((token) => names.includes(token));
    }).map((entity) => entity.entity_id).slice(0, 20);
    const relationTypes = unique(input.relation_types).length > 0
      ? unique(input.relation_types)
      : unique(state.relations.map((relation) => relation.predicate));
    if (entityIds.length === 0 || relationTypes.length === 0) return null;
    return {
      workspace_id: workspaceId,
      entity_ids: entityIds,
      relation_types: relationTypes,
      direction,
      max_hops: maxHops,
      as_of: strategy === "temporal" ? input.as_of : (input.as_of ?? wallClock()),
      limit: boundedInteger(input.limit, 10, 1, maxLimit, "memory_router_limit_invalid")
    };
  };

  const recall = async (input = {}) => {
    validateScopeFree(input);
    const query = String(input.query ?? "").trim();
    if (!query || query.length > 4_000) fail("memory_router_query_invalid");
    assertBound(input);
    const requestedStrategy = input.strategy ?? "auto";
    if (!STRATEGIES.has(requestedStrategy)) fail("memory_router_strategy_invalid");
    if (input.as_of !== undefined && input.as_of !== null && !Number.isFinite(Date.parse(input.as_of))) {
      fail("memory_router_as_of_invalid");
    }
    const route = requestedStrategy === "auto"
      ? routeAuto(input)
      : { strategy: requestedStrategy, reason: "explicit_strategy" };
    if (route.strategy === "temporal" && !input.as_of) fail("memory_router_as_of_required");
    const limit = boundedInteger(input.limit, 10, 1, maxLimit, "memory_router_limit_invalid");
    const requestedTiers = route.strategy === "hybrid"
      ? ["working", "durable", "graph"]
      : (route.strategy === "temporal" ? ["durable", "graph"] : [route.strategy]);
    const preparedGraphQuery = requestedTiers.includes("graph")
      ? graphQueryInput(input, route.strategy)
      : null;
    const coverage = { working: "not_requested", graph: "not_requested", durable: "not_requested" };
    const started = monotonicNow();
    let firstUsefulMs = null;
    const operations = requestedTiers.map((tier) => timeout(tier, async () => {
      let normalized;
      if (tier === "working") normalized = normalizeWorking(await workingRecall.search({
        working_set_id: input.working_set_id,
        query,
        limit
      }));
      else if (tier === "durable") {
        if (hindsightGateway && typeof hindsightGateway.recall === "function") {
          normalized = normalizeHindsight(await hindsightGateway.recall({
            query,
            asOf: input.as_of ?? null,
            historical: route.strategy === "temporal",
            maxTokens: boundedInteger(input.max_tokens, 4096, 256, 8192, "memory_router_token_budget_invalid")
          }));
        } else if (durableRecall && typeof durableRecall.search === "function") {
          normalized = normalizeDurable(await durableRecall.search({
            query,
            limit,
            types: input.types,
            as_of: input.as_of ?? null
          }));
        } else {
          throw Object.assign(new Error("backend_unavailable"), { code: "backend_unavailable" });
        }
      } else {
        normalized = preparedGraphQuery ? normalizeGraph(await (
          typeof graphAdapter.queryAsync === "function"
            ? graphAdapter.queryAsync(preparedGraphQuery)
            : graphAdapter.query(preparedGraphQuery)
        )) : [];
      }
      if (normalized.length > 0 && firstUsefulMs === null) firstUsefulMs = monotonicNow() - started;
      return normalized;
    }, started));
    const settled = await Promise.all(operations);
    const allResults = [];
    for (const item of settled) {
      coverage[item.tier] = item.status;
      allResults.push(...item.results);
      if (item.tier === "graph" && item.status === "complete") {
        for (const result of item.results) {
          if (!result.graph_path) continue;
          paths.set(result.path_id, {
            workspace_id: workspaceId,
            working_set_id: input.working_set_id,
            expires_at_ms: Date.now() + pathTtlMs,
            path: result.graph_path
          });
        }
      }
    }
    const results = mergeResults(allResults, limit).map(({ graph_path, ...item }) => item);
    return {
      schema: "supermemory.recall.v1",
      workspace_id: workspaceId,
      project_id: projectId,
      working_set_id: input.working_set_id,
      as_of: input.as_of ?? null,
      strategy_requested: requestedStrategy,
      strategy_used: route.strategy,
      routing_reason: route.reason,
      coverage,
      results,
      partial: requestedTiers.some((tier) => coverage[tier] !== "complete"),
      trace: {
        first_useful_ms: firstUsefulMs,
        complete_ms: monotonicNow() - started,
        tiers: Object.fromEntries(settled.map((item) => [item.tier, {
          status: item.status,
          duration_ms: item.duration_ms,
          ...(item.error ? { error: item.error } : {})
        }]))
      }
    };
  };

  const explainPath = (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    const pathId = input.path_id;
    const record = paths.get(pathId);
    if (
      !record || record.workspace_id !== workspaceId || record.working_set_id !== input.working_set_id ||
      record.expires_at_ms <= Date.now()
    ) fail("not_found_or_not_authorized");
    return {
      workspace_id: workspaceId,
      project_id: projectId,
      working_set_id: input.working_set_id,
      path: record.path
    };
  };

  const status = async () => ({
    workspace_id: workspaceId,
    project_id: projectId,
    working_recall: true,
    durable_recall: Boolean(hindsightGateway ?? durableRecall),
    hindsight: hindsightGateway ? await Promise.resolve(hindsightGateway.status()).catch((error) => ({
      available: false,
      error: error?.code ?? "hindsight_unavailable"
    })) : { available: false, status: "disabled" },
    graph_recall: Boolean(graphAdapter),
    strategies: [...STRATEGIES]
  });

  return Object.freeze({
    workspaceId,
    projectId,
    graphAdapter,
    hindsightGateway,
    ontologyRegistry,
    learnedPlane,
    assertBound,
    recall,
    search: (input = {}) => recall({ ...input, strategy: "durable" }),
    graphQuery: (input = {}) => recall({ ...input, strategy: input.as_of ? "temporal" : "graph" }),
    explainPath,
    workingMap: (input = {}) => workingRecall.map(input),
    workingSearch: (input = {}) => workingRecall.search(input),
    workingOpen: (input = {}) => workingRecall.open(input),
    workingNeighbors: (input = {}) => workingRecall.neighbors(input),
    reflect: async (input = {}) => {
      validateScopeFree(input);
      assertBound(input);
      if (!hindsightGateway?.reflect) fail("backend_unavailable");
      if (Object.hasOwn(input, "as_of") || Object.hasOwn(input, "response_schema")) fail("reflect_argument_forbidden");
      const query = String(input.query ?? "").trim();
      if (!query || query.length > 4_000) fail("memory_router_query_invalid");
      const format = input.format ?? "summary";
      const maxTokens = boundedInteger(input.max_tokens, 2048, 256, 4096, "memory_router_token_budget_invalid");
      return hindsightGateway.reflect({
        query,
        format,
        responseSchema: hindsightReflectSchema(format),
        maxTokens
      });
    },
    get: (input = {}) => {
      validateScopeFree(input);
      assertBound(input);
      if (!durableRecall?.get) fail("backend_unavailable");
      return durableRecall.get({ memory_id: input.memory_id });
    },
    explainCitation: (input = {}) => {
      validateScopeFree(input);
      assertBound(input);
      if (!durableRecall?.explainCitation) fail("backend_unavailable");
      return durableRecall.explainCitation({ memory_id: input.memory_id });
    },
    status
  });
}
