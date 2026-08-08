function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function active(entry, now) {
  return ["active", "selected"].includes(entry.status) && entry.complete !== false &&
    (!entry.expires_at || Date.parse(entry.expires_at) > now);
}

function order(left, right) {
  return Number(right.pinned) - Number(left.pinned) ||
    Number(right.current) - Number(left.current) ||
    Number(right.priority ?? 0) - Number(left.priority ?? 0) ||
    Number(right.source_sequence ?? 0) - Number(left.source_sequence ?? 0) ||
    left.evidence_id.localeCompare(right.evidence_id);
}

export function createCodexTopicView({
  topicStore,
  workingStore,
  capacityTokens = 100_000,
  priorSessionRatio = 0.35,
  currentSessionRatio = 0.40,
  clock = () => new Date().toISOString()
} = {}) {
  if (!topicStore?.getContext || !workingStore?.resolveWorkingSet) fail("topic_view_configuration_invalid");
  if (!Number.isSafeInteger(capacityTokens) || capacityTokens < 8_000 || capacityTokens > 100_000) fail("topic_view_capacity_invalid");
  if (priorSessionRatio <= 0 || priorSessionRatio > 1 || currentSessionRatio <= 0 || currentSessionRatio > 1) fail("topic_view_ratio_invalid");

  const build = (input = {}) => {
    const workspaceId = input.workspaceId ?? input.workspace_id;
    const projectId = input.projectId ?? input.project_id;
    const workingSetId = input.workingSetId ?? input.working_set_id;
    const context = topicStore.getContext({ workspaceId, projectId, workingSetId });
    const now = Date.parse(clock());
    if (!Number.isFinite(now)) fail("topic_view_clock_invalid");
    const candidates = [];
    for (const membership of context.memberships) {
      let state;
      try {
        state = workingStore.resolveWorkingSet({ workspaceId, projectId, workingSetId: membership.working_set_id });
      } catch {
        continue;
      }
      for (const entry of state.entries ?? []) {
        if (!active(entry, now)) continue;
        candidates.push({
          working_set_id: membership.working_set_id,
          session_id: membership.session_id,
          relation: membership.relation,
          evidence_id: entry.evidence_id,
          episode_id: entry.episode_id,
          event_id: entry.event_id,
          content_hash: entry.content_hash,
          token_estimate: Number(entry.token_estimate ?? 0),
          kind: entry.kind,
          priority: Number(entry.priority ?? 0),
          source_sequence: Number(entry.source_sequence ?? 0),
          pinned: entry.pinned === true,
          current: membership.working_set_id === workingSetId,
          observed_at: entry.created_at,
          expires_at: entry.expires_at ?? null
        });
      }
    }
    candidates.sort(order);
    const selected = [];
    const perPrior = new Map();
    let total = 0;
    let pinnedTokens = 0;
    const priorLimit = Math.floor(capacityTokens * priorSessionRatio);
    for (const candidate of candidates) {
      const tokens = Math.max(0, candidate.token_estimate);
      if (candidate.pinned) {
        selected.push(candidate);
        total += tokens;
        pinnedTokens += tokens;
        continue;
      }
      if (total + tokens > capacityTokens) continue;
      if (!candidate.current) {
        const priorTokens = perPrior.get(candidate.working_set_id) ?? 0;
        if (priorTokens + tokens > priorLimit) continue;
        perPrior.set(candidate.working_set_id, priorTokens + tokens);
      }
      selected.push(candidate);
      total += tokens;
    }
    const currentAvailable = candidates.filter((item) => item.current && !item.pinned).reduce((sum, item) => sum + item.token_estimate, 0);
    const currentSelected = selected.filter((item) => item.current).reduce((sum, item) => sum + item.token_estimate, 0);
    const minimumCurrent = Math.min(Math.floor(capacityTokens * currentSessionRatio), currentAvailable);
    const overCapacity = pinnedTokens > capacityTokens;
    return Object.freeze({
      schema: "supermemory.topic-working-view.v1",
      topic_id: context.topic.topic_id,
      workspace_id: workspaceId,
      project_id: projectId,
      current_working_set_id: workingSetId,
      membership_count: context.memberships.length,
      checkpoint_ids: context.checkpoints.map((checkpoint) => checkpoint.checkpoint_id),
      selected,
      evidence_ids: [...new Set(selected.map((item) => item.evidence_id))].sort(),
      budget: {
        selected_tokens: total,
        capacity_tokens: capacityTokens,
        pinned_tokens: pinnedTokens,
        current_session_tokens: currentSelected,
        current_session_minimum_tokens: minimumCurrent,
        prior_session_max_tokens: priorLimit
      },
      status: overCapacity ? "over_capacity" : "ready",
      generated_at: new Date(now).toISOString()
    });
  };

  return Object.freeze({ build });
}
