import { hindsightReflectSchema } from "./hindsight-reflect-schemas.mjs";
import { createRetrievalPlan } from "./codex-retrieval-plan.mjs";
import { evaluateEvidenceCoverage, repairDirective } from "./codex-evidence-coverage.mjs";
import { buildDeterministicTopicCheckpoint, enrichTopicCheckpoint } from "./codex-topic-checkpoint.mjs";
import { migrateTopicContinuity } from "./codex-topic-migration.mjs";

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
  for (const key of ["workspace_id", "workspaceId", "project_id", "projectId", "topic_id", "topicId", "cwd", "session_id", "sessionId"]) {
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
    authority_states: unique([typeof item.authority === "object" ? item.authority.state : item.authority].filter(Boolean)),
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
      authority_states: unique(path.edges?.map((edge) => edge.authority_state ?? "current") ?? []),
      valid_from: intervals.map((item) => item.valid_from).filter(Boolean).sort()[0] ?? null,
      valid_to: intervals.some((item) => item.valid_to === null) ? null : intervals.map((item) => item.valid_to).filter(Boolean).sort().at(-1) ?? null,
      temporal_intervals: intervals,
      citations: (path.edges ?? []).map((edge) => ({
        kind: "graph_edge",
        path_id: path.path_id,
        relation_id: edge.relation_id,
        claim_id: edge.claim_id,
        admission_id: edge.admission_id,
        authority_state: edge.authority_state ?? "current",
        authority_revision: edge.authority_revision ?? 0,
        evidence_ids: edge.evidence_ids,
        episode_ids: edge.episode_ids,
        valid_from: edge.valid_from,
        valid_to: edge.valid_to
      })),
      graph_path: path
    };
  });
}

function normalizeEvents(result) {
  return (result?.results ?? []).map((item) => ({
    memory_tier: "event",
    memory_tiers: ["event"],
    text: item.claim_text ?? "",
    score: 1,
    evidence_ids: unique(item.evidence_ids),
    episode_ids: unique(item.episode_ids),
    entity_ids: unique([item.subject_entity_id, item.object_entity_id]),
    path_ids: [],
    admission_ids: unique([item.admission_id]),
    admission_states: unique([item.status ?? "active"]),
    authority_states: unique([item.authority_state ?? "current"]),
    valid_from: item.valid_from ?? null,
    valid_to: item.valid_to ?? null,
    event_time: item.event_time ?? null,
    temporal_intervals: [{
      relation_id: item.relation_id,
      valid_from: item.valid_from ?? null,
      valid_to: item.valid_to ?? null,
      event_time: item.event_time ?? null
    }],
    explicit_preference: item.predicate === "PREFERS",
    citations: [{
      kind: "temporal_event",
      relation_id: item.relation_id,
      claim_id: item.claim_id,
      evidence_ids: item.evidence_ids,
      episode_ids: item.episode_ids,
      event_time: item.event_time
    }]
  }));
}

function normalizeTopicTurns(result) {
  return (result?.results ?? result?.selected ?? []).map((item) => ({
    ...item,
    memory_tier: "topic",
    memory_tiers: ["topic"],
    text: item.text ?? item.excerpt ?? "",
    score: Number(item.score ?? item.priority) || 0,
    evidence_ids: unique(item.evidence_ids ?? [item.evidence_id]),
    episode_ids: unique(item.episode_ids ?? [item.episode_id]),
    entity_ids: unique(item.entity_ids),
    path_ids: [],
    admission_ids: unique(item.admission_ids),
    admission_states: unique(item.admission_states ?? [item.status ?? "active"]),
    citations: item.citations ?? [{
      kind: "topic_turn",
      topic_id: result.topic_id ?? item.topic_id,
      evidence_id: item.evidence_id,
      episode_id: item.episode_id,
      working_set_id: item.working_set_id
    }],
    temporal_intervals: item.temporal_intervals ?? []
  }));
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
        authority_states: new Set(),
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
    for (const value of item.authority_states ?? []) group.authority_states.add(value);
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
    authority_states: [...group.authority_states].sort(),
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
  workingStore = null,
  durableRecall = null,
  topicRecall = null,
  topicResolver = null,
  topicStore = null,
  topicView = null,
  authorityPolicy = null,
  exceptionStore = null,
  hindsightGateway = null,
  ontologyRegistry = null,
  learnedPlane = null,
  graphAdapter = null,
  timeoutMs = 1_500,
  pathTtlMs = 60_000,
  maxLimit = 20,
  retrievalMaxRounds = 3,
  retrievalMaxMs = 5_000,
  retrievalMaxResults = 1_000,
  retrievalMaxTokens = 12_000,
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
  boundedInteger(retrievalMaxRounds, 3, 1, 3, "retrieval_plan_rounds_invalid");
  boundedInteger(retrievalMaxMs, 5_000, 100, 30_000, "retrieval_plan_budget_invalid");
  boundedInteger(retrievalMaxResults, 1_000, 1, 10_000, "retrieval_plan_budget_invalid");
  boundedInteger(retrievalMaxTokens, 12_000, 256, 50_000, "retrieval_plan_budget_invalid");
  const paths = new Map();
  const metrics = {
    recall_total: 0,
    recall_repair_total: 0,
    recall_abstention_total: 0,
    recall_simple_single_pass_total: 0,
    temporal_query_total: 0
  };

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
    const strategySources = route.strategy === "hybrid"
      ? ["working", "durable", "graph"]
      : (route.strategy === "temporal" ? ["durable", "graph"] : [route.strategy]);
    const plan = createRetrievalPlan({
      query,
      asOf: input.as_of ?? null,
      observedAt: wallClock(),
      maxRounds: boundedInteger(input.max_rounds, retrievalMaxRounds, 1, retrievalMaxRounds, "retrieval_plan_rounds_invalid"),
      maxMs: boundedInteger(input.max_ms, retrievalMaxMs, 100, retrievalMaxMs, "retrieval_plan_budget_invalid"),
      maxResults: boundedInteger(input.max_results, retrievalMaxResults, 1, retrievalMaxResults, "retrieval_plan_budget_invalid"),
      maxTokens: boundedInteger(input.max_tokens, retrievalMaxTokens, 256, retrievalMaxTokens, "retrieval_plan_budget_invalid")
    });
    const requestedSources = unique(requestedStrategy === "auto"
      ? [...strategySources, ...plan.steps.map((step) => step.source)]
      : strategySources);
    const preparedGraphQuery = requestedSources.includes("graph")
      ? graphQueryInput(input, route.strategy)
      : null;
    const coverage = { working: "not_requested", graph: "not_requested", durable: "not_requested" };
    const started = monotonicNow();
    let firstUsefulMs = null;
    const allResults = [];
    const sourceCoverage = {};
    const traces = [];

    const runSource = async (source) => timeout(source, async () => {
      let normalized;
      let raw;
      if (source === "working") {
        raw = await workingRecall.search({
        working_set_id: input.working_set_id,
        query,
        limit
        });
        normalized = normalizeWorking(raw);
      } else if (source === "topic_turns") {
        if (!topicRecall?.search) throw Object.assign(new Error("backend_unavailable"), { code: "backend_unavailable" });
        raw = await topicRecall.search({
          working_set_id: input.working_set_id,
          query,
          limit: Math.min(plan.budget.max_results, Math.max(limit, 100)),
          start: plan.time_window.start,
          end: plan.time_window.end
        });
        normalized = normalizeTopicTurns(raw);
      } else if (source === "events") {
        if (!graphAdapter?.queryEvents) throw Object.assign(new Error("backend_unavailable"), { code: "backend_unavailable" });
        raw = graphAdapter.queryEvents({
          workspaceId,
          start: plan.time_window.start,
          end: plan.time_window.end,
          asOf: input.as_of ?? wallClock(),
          limit: plan.budget.max_results
        });
        normalized = normalizeEvents(raw);
      } else if (source === "durable") {
        if (hindsightGateway && typeof hindsightGateway.recall === "function") {
          raw = await hindsightGateway.recall({
            query,
            asOf: input.as_of ?? null,
            historical: route.strategy === "temporal" || plan.time_window.required,
            maxTokens: Math.min(8_192, boundedInteger(input.max_tokens, retrievalMaxTokens, 256, retrievalMaxTokens, "memory_router_token_budget_invalid"))
          });
          normalized = normalizeHindsight(raw);
        } else if (durableRecall && typeof durableRecall.search === "function") {
          raw = await durableRecall.search({
            query,
            limit,
            types: input.types,
            as_of: input.as_of ?? null
          });
          normalized = normalizeDurable(raw);
        } else {
          throw Object.assign(new Error("backend_unavailable"), { code: "backend_unavailable" });
        }
      } else {
        raw = preparedGraphQuery ? await (
          typeof graphAdapter.queryAsync === "function"
            ? graphAdapter.queryAsync(preparedGraphQuery)
            : graphAdapter.query(preparedGraphQuery)
        ) : { paths: [] };
        normalized = normalizeGraph(raw);
      }
      if (normalized.length > 0 && firstUsefulMs === null) firstUsefulMs = monotonicNow() - started;
      return { normalized, raw };
    }, monotonicNow());

    let round = 1;
    let evidenceCoverage;
    let directive = null;
    let roundSources = requestedSources;
    do {
      const settled = await Promise.all(roundSources.map(runSource));
      for (const item of settled) {
        coverage[item.tier] = item.status;
        traces.push({ round, ...item });
        const payload = item.results?.normalized ? item.results : { normalized: [], raw: null };
        allResults.push(...payload.normalized);
        const pagination = payload.raw?.pagination;
        sourceCoverage[item.tier] = {
          status: item.status,
          pagination_complete: item.status === "complete" && (pagination?.complete ?? true),
          ...(item.tier === "events" ? {
            temporal_window: pagination?.coverage_complete === true ? "complete" : "partial",
            state_chain: pagination?.complete === true ? "complete" : "partial",
            unresolved_event_time_count: pagination?.unresolved_event_time_count ?? 0
          } : {})
        };
        if (item.tier === "graph" && item.status === "complete") {
        for (const result of payload.normalized) {
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
      const mergedForCoverage = mergeResults([...allResults], Math.min(plan.budget.max_results, maxLimit));
      evidenceCoverage = evaluateEvidenceCoverage({ plan, round, sources: sourceCoverage, results: mergedForCoverage });
      directive = repairDirective(evidenceCoverage);
      round += 1;
      roundSources = directive ? unique([
        ...(directive.modes.some((mode) => ["resolve_time_window", "exhaust_interval", "load_state_chain"].includes(mode)) ? ["events"] : []),
        ...(directive.modes.includes("search_explicit_turns") ? ["topic_turns", "durable"] : []),
        ...plan.steps.filter((step) => step.exhaustive && sourceCoverage[step.source]?.pagination_complete !== true).map((step) => step.source)
      ]) : [];
    } while (
      evidenceCoverage.repair_required && roundSources.length > 0 &&
      monotonicNow() - started < plan.budget.max_ms
    );
    const results = mergeResults(allResults, limit).map(({ graph_path, ...item }) => item);
    metrics.recall_total += 1;
    metrics.recall_repair_total += Math.max(0, round - 2);
    if (evidenceCoverage.abstention_required) metrics.recall_abstention_total += 1;
    if (plan.intent === "simple_recall" && round - 1 === 1) metrics.recall_simple_single_pass_total += 1;
    if (plan.time_window.required || plan.intent === "current_state") metrics.temporal_query_total += 1;
    return {
      schema: "supermemory.recall.v2",
      workspace_id: workspaceId,
      project_id: projectId,
      working_set_id: input.working_set_id,
      as_of: input.as_of ?? null,
      strategy_requested: requestedStrategy,
      strategy_used: route.strategy,
      routing_reason: route.reason,
      coverage,
      retrieval_plan: plan,
      evidence_coverage: evidenceCoverage,
      repair_directive: directive,
      rounds: round - 1,
      results,
      partial: requestedSources.some((source) => coverage[source] !== "complete") || !evidenceCoverage.complete,
      abstention_required: evidenceCoverage.abstention_required,
      trace: {
        first_useful_ms: firstUsefulMs,
        complete_ms: monotonicNow() - started,
        tiers: Object.fromEntries(traces.map((item) => [item.tier, {
          status: item.status,
          duration_ms: item.duration_ms,
          round: item.round,
          ...(item.error ? { error: item.error } : {})
        }])),
        attempts: traces.map((item) => ({
          source: item.tier,
          round: item.round,
          status: item.status,
          duration_ms: item.duration_ms,
          ...(item.error ? { error: item.error } : {})
        }))
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

  const resolveTopic = (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    if (!topicResolver?.resolve) fail("backend_unavailable");
    return topicResolver.resolve({
      workspaceId,
      projectId,
      workingSetId: input.working_set_id,
      title: input.title,
      candidates: input.candidates ?? []
    });
  };

  const topicContext = (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    if (!topicStore?.getContext || !topicView?.build) fail("backend_unavailable");
    const context = topicStore.getContext({ workspaceId, projectId, workingSetId: input.working_set_id });
    return {
      schema: "supermemory.topic-context.v1",
      topic: context.topic,
      membership: context.current_membership,
      memberships: context.memberships,
      checkpoints: context.checkpoints,
      working_view: topicView.build({ workspaceId, projectId, workingSetId: input.working_set_id }),
      working_map: workingRecall.map(input)
    };
  };

  const topicCheckpoint = async (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    if (!topicStore?.getContext || !topicStore?.appendCheckpoint) fail("backend_unavailable");
    const context = topicStore.getContext({ workspaceId, projectId, workingSetId: input.working_set_id });
    const checkpoint = buildDeterministicTopicCheckpoint({
      topic: context.topic,
      membership: context.current_membership,
      workingMap: workingRecall.map(input),
      kind: input.kind ?? "manual",
      createdAt: input.created_at ?? wallClock()
    });
    const persisted = topicStore.appendCheckpoint({
      workspaceId, projectId, workingSetId: input.working_set_id, checkpoint
    });
    if (input.enrich !== false && hindsightGateway?.reflect && topicStore.enrichCheckpoint) {
      try {
        const reflected = await hindsightGateway.reflect({
          query: `Résume le checkpoint opérationnel du sujet ${context.topic.title}`,
          format: "summary",
          responseSchema: hindsightReflectSchema("summary"),
          maxTokens: 1_024
        });
        const enrichment = enrichTopicCheckpoint({
          checkpoint: persisted,
          enrichment: reflected.answer ?? JSON.stringify(reflected.structured_output),
          basedOn: reflected.based_on.map((item) => item.fact_id ?? item.memory_id).filter(Boolean)
        }).enrichment;
        return topicStore.enrichCheckpoint({
          workspaceId, projectId, workingSetId: input.working_set_id,
          checkpointId: checkpoint.checkpoint_id,
          enrichment
        });
      } catch {
        // The deterministic cited checkpoint is authoritative and already durable.
      }
    }
    return persisted;
  };

  const topicSearch = (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    return workingRecall.search({ ...input, scope: "topic" });
  };

  const recallPlan = (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    return createRetrievalPlan({
      query: input.query,
      asOf: input.as_of ?? null,
      observedAt: wallClock(),
      maxRounds: input.max_rounds ?? retrievalMaxRounds,
      maxMs: input.max_ms ?? retrievalMaxMs,
      maxResults: input.max_results ?? retrievalMaxResults,
      maxTokens: input.max_tokens ?? retrievalMaxTokens
    });
  };

  const recallCoverage = (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    return evaluateEvidenceCoverage({
      plan: input.plan,
      round: input.round,
      sources: input.sources,
      results: input.results
    });
  };

  const authorityExplain = (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    if (!authorityPolicy?.get) fail("backend_unavailable");
    const state = authorityPolicy.get({ claimId: input.claim_id });
    if (!state) fail("not_found_or_not_authorized");
    const topic = topicStore?.getContext({ workspaceId, projectId, workingSetId: input.working_set_id }).topic.topic_id ?? null;
    if (state.topic_id !== null && state.topic_id !== topic) fail("not_found_or_not_authorized");
    return { workspace_id: workspaceId, project_id: projectId, working_set_id: input.working_set_id, authority: state };
  };

  const exceptionsQuery = (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    if (!exceptionStore?.query) fail("backend_unavailable");
    const topic = topicStore?.getContext({ workspaceId, projectId, workingSetId: input.working_set_id }).topic.topic_id ?? null;
    return {
      workspace_id: workspaceId,
      project_id: projectId,
      working_set_id: input.working_set_id,
      topic_id: topic,
      results: exceptionStore.query({
        topicId: topic,
        includeLatent: input.include_latent === true,
        includeResolved: input.include_resolved === true
      })
    };
  };

  const exceptionsResolve = (input = {}) => {
    validateScopeFree(input);
    assertBound(input);
    if (!exceptionStore?.resolveOwner) fail("backend_unavailable");
    const current = exceptionStore.get({ fingerprint: input.fingerprint });
    const topic = topicStore?.getContext({ workspaceId, projectId, workingSetId: input.working_set_id }).topic.topic_id ?? null;
    if (!current || current.topic_id !== topic) fail("not_found_or_not_authorized");
    return exceptionStore.resolveOwner({ fingerprint: input.fingerprint, decision: input.decision });
  };

  const rebuildFabric = async (input = {}) => {
    if (Object.keys(input).length > 0) fail("arguments_invalid");
    const episodes = workingStore?.migrateTemporalEpisodes?.({ workspaceId }) ?? { episodes: 0, migrated: 0 };
    const topics = topicStore && workingStore ? migrateTopicContinuity({
      workspaceId, projectId, workingStore, topicStore
    }) : { working_sets: 0, unchanged: 0 };
    const temporalAuthority = graphAdapter?.migrateTemporalAuthority?.({
      workspaceId,
      authorityResolver: authorityPolicy?.evaluate ? (claim) => authorityPolicy.evaluate({
        claim: {
          claim_id: claim.claim_id,
          claim_key: claim.claim_key,
          workspace_id: workspaceId,
          project_id: projectId,
          topic_id: claim.authority?.topic_id ?? null,
          fact_class: claim.authority?.fact_class ?? "external_fact",
          evidence_ids: claim.evidence_ids,
          observed_at: claim.observed_at,
          event_time: claim.event_time,
          proof_strength: "strong",
          authenticated: true,
          explicit: true
        }
      }) : null
    }) ?? { migrated_records: 0 };
    const graph = graphAdapter?.rebuildProjectionAsync
      ? await graphAdapter.rebuildProjectionAsync({ workspaceId })
      : graphAdapter?.rebuildProjection?.({ workspaceId }) ?? { projected: false, status: "disabled" };
    return {
      schema: "supermemory.fabric-rebuild.v1",
      workspace_id: workspaceId,
      project_id: projectId,
      episodes,
      topics,
      temporal_authority: temporalAuthority,
      graph,
      authority_states: authorityPolicy?.list?.().length ?? 0,
      exceptions: exceptionStore?.query?.({ includeLatent: true, includeResolved: true }).length ?? 0
    };
  };

  const status = async () => {
    const authorityStates = authorityPolicy?.list?.() ?? [];
    const exceptions = exceptionStore?.query?.({ includeLatent: true, includeResolved: true }) ?? [];
    return ({
    workspace_id: workspaceId,
    project_id: projectId,
    working_recall: true,
    topic_continuity: Boolean(topicStore && topicResolver && topicView),
    durable_recall: Boolean(hindsightGateway ?? durableRecall),
    hindsight: hindsightGateway ? await Promise.resolve(hindsightGateway.status()).catch((error) => ({
      available: false,
      error: error?.code ?? "hindsight_unavailable"
    })) : { available: false, status: "disabled" },
    graph_recall: Boolean(graphAdapter),
    strategies: [...STRATEGIES],
    metrics: {
      ...metrics,
      authority_current_total: authorityStates.filter((item) => item.state === "current").length,
      authority_provisional_total: authorityStates.filter((item) => item.state === "provisional").length,
      authority_disputed_total: authorityStates.filter((item) => item.state === "disputed").length,
      authority_supersession_total: authorityStates.filter((item) => item.state === "superseded").length,
      exceptions_open_total: exceptions.filter((item) => item.status === "open").length,
      exceptions_blocking_total: exceptions.filter((item) => item.status === "open" && item.level === "blocking").length
    }
  });
  };

  return Object.freeze({
    workspaceId,
    projectId,
    graphAdapter,
    hindsightGateway,
    ontologyRegistry,
    learnedPlane,
    topicStore,
    topicResolver,
    topicView,
    authorityPolicy,
    exceptionStore,
    assertBound,
    recall,
    search: (input = {}) => recall({ ...input, strategy: "durable" }),
    graphQuery: (input = {}) => recall({ ...input, strategy: input.as_of ? "temporal" : "graph" }),
    explainPath,
    resolveTopic,
    topicContext,
    topicCheckpoint,
    topicSearch,
    recallPlan,
    recallCoverage,
    authorityExplain,
    exceptionsQuery,
    exceptionsResolve,
    rebuildFabric,
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
