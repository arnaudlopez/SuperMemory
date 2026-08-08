function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function score(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : 0;
}

export function createCodexTopicResolver({
  topicStore,
  workingStore,
  autoBindThreshold = 0.90,
  autoBindMargin = 0.25
} = {}) {
  if (!topicStore?.createRoot || !topicStore?.bind || !topicStore?.getContext || !workingStore?.resolveWorkingSet) {
    fail("topic_resolver_configuration_invalid");
  }
  if (autoBindThreshold < 0.5 || autoBindThreshold > 1 || autoBindMargin < 0 || autoBindMargin > 1) {
    fail("topic_resolver_threshold_invalid");
  }

  const resolve = (input = {}) => {
    const workspaceId = input.workspaceId ?? input.workspace_id;
    const projectId = input.projectId ?? input.project_id;
    const workingSetId = input.workingSetId ?? input.working_set_id;
    const state = workingStore.resolveWorkingSet({ workspaceId, projectId, workingSetId });
    const sessionId = state.manifest.session_id;
    try {
      const context = topicStore.getContext({ workspaceId, projectId, workingSetId });
      return Object.freeze({
        topic_id: context.topic.topic_id,
        working_set_id: workingSetId,
        continuity: context.current_membership.resolution,
        created: false,
        reason_codes: ["existing_membership"]
      });
    } catch (error) {
      if (error?.code !== "topic_not_found_or_not_authorized") throw error;
    }

    const parentWorkingSetId = state.manifest.forked_from_working_set_id;
    if (parentWorkingSetId) {
      try {
        const parent = topicStore.getContext({ workspaceId, projectId, workingSetId: parentWorkingSetId });
        topicStore.bind({
          workspaceId, projectId, topicId: parent.topic.topic_id, workingSetId, sessionId,
          relation: "fork", resolution: "inherited", resolutionScore: 1,
          reasonCodes: ["fork_parent_binding"]
        });
        return Object.freeze({
          topic_id: parent.topic.topic_id, working_set_id: workingSetId,
          continuity: "inherited", created: false, reason_codes: ["fork_parent_binding"]
        });
      } catch (error) {
        if (error?.code !== "topic_not_found_or_not_authorized") throw error;
      }
    }

    const deterministicCandidates = [...(input.candidates ?? [])];
    if (deterministicCandidates.length === 0 && state.manifest.thread_id && workingStore.listWorkingSets) {
      for (const candidateState of workingStore.listWorkingSets({ workspaceId, projectId })) {
        if (
          candidateState.manifest.working_set_id !== workingSetId &&
          candidateState.manifest.thread_id === state.manifest.thread_id
        ) deterministicCandidates.push({
          working_set_id: candidateState.manifest.working_set_id,
          resolution: "exact",
          score: 1,
          semantic_only: false,
          reason_codes: ["same_thread_id"]
        });
      }
    }
    const candidates = deterministicCandidates.map((candidate) => ({
      ...candidate,
      score: score(candidate.score)
    })).sort((left, right) => right.score - left.score || String(left.working_set_id).localeCompare(String(right.working_set_id)));
    const exact = candidates.filter((candidate) => candidate.resolution === "exact" && candidate.semantic_only !== true);
    const exactTopicIds = new Set(exact.map((candidate) => {
      try {
        return topicStore.getContext({ workspaceId, projectId, workingSetId: candidate.working_set_id }).topic.topic_id;
      } catch {
        return null;
      }
    }).filter(Boolean));
    const safeExact = exact.length > 0 && exactTopicIds.size === 1;
    const ambiguousExact = exactTopicIds.size > 1;
    const winner = safeExact ? exact[0] : candidates[0];
    const runnerUp = safeExact ? null : candidates[1];
    const highConfidence = !ambiguousExact && winner && winner.semantic_only !== true && (
      winner.resolution === "exact" ||
      (winner.score >= autoBindThreshold && winner.score - score(runnerUp?.score) >= autoBindMargin)
    );
    if (highConfidence) {
      try {
        const target = topicStore.getContext({ workspaceId, projectId, workingSetId: winner.working_set_id });
        const resolution = winner.resolution === "exact" ? "exact" : "high_confidence";
        topicStore.bind({
          workspaceId, projectId, topicId: target.topic.topic_id, workingSetId, sessionId,
          relation: "continuation", resolution, resolutionScore: winner.score,
          reasonCodes: winner.reason_codes ?? [resolution === "exact" ? "exact_external_id" : "deterministic_signal_score"]
        });
        return Object.freeze({
          topic_id: target.topic.topic_id, working_set_id: workingSetId,
          continuity: resolution, created: false,
          reason_codes: winner.reason_codes ?? [resolution]
        });
      } catch (error) {
        if (error?.code !== "topic_not_found_or_not_authorized") throw error;
      }
    }

    const created = topicStore.createRoot({
      workspaceId, projectId, workingSetId, sessionId,
      title: input.title ?? "Sujet sans titre"
    });
    if (winner) {
      try {
        const target = topicStore.getContext({ workspaceId, projectId, workingSetId: winner.working_set_id });
        topicStore.suggestLink({
          workspaceId, projectId, workingSetId,
          candidateTopicId: target.topic.topic_id,
          score: winner.score,
          reasonCodes: winner.reason_codes ?? [winner.semantic_only ? "semantic_only" : "ambiguous_continuity"]
        });
      } catch {
        // Suggested links are optional and never broaden recall.
      }
    }
    return Object.freeze({
      topic_id: created.topic.topic_id, working_set_id: workingSetId,
      continuity: "new", created: true,
      reason_codes: [candidates.length > 1 ? "ambiguous_candidates" : "no_safe_continuity"]
    });
  };

  return Object.freeze({ resolve });
}
