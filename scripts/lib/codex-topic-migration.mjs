function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function migrateTopicContinuity({
  workspaceId,
  projectId,
  workingStore,
  topicStore
} = {}) {
  if (!workspaceId || !projectId || !workingStore?.listWorkingSets || !topicStore?.createRoot || !topicStore?.bind) {
    fail("topic_migration_configuration_invalid");
  }
  const states = workingStore.listWorkingSets({ workspaceId, projectId });
  const byId = new Map(states.map((state) => [state.manifest.working_set_id, state]));
  const pending = new Set(byId.keys());
  let created = 0;
  let inherited = 0;
  let unchanged = 0;

  const context = (workingSetId) => {
    try { return topicStore.getContext({ workspaceId, projectId, workingSetId }); } catch (error) {
      if (error?.code === "topic_not_found_or_not_authorized") return null;
      throw error;
    }
  };

  for (const state of states) {
    const id = state.manifest.working_set_id;
    if (context(id)) {
      pending.delete(id);
      unchanged += 1;
      continue;
    }
    if (state.manifest.forked_from_working_set_id) continue;
    topicStore.createRoot({
      workspaceId,
      projectId,
      workingSetId: id,
      sessionId: state.manifest.session_id,
      title: "Sujet historique"
    });
    pending.delete(id);
    created += 1;
  }

  let progressed = true;
  while (pending.size > 0 && progressed) {
    progressed = false;
    for (const id of [...pending]) {
      const state = byId.get(id);
      const parentId = state.manifest.forked_from_working_set_id;
      const parent = parentId ? context(parentId) : null;
      if (!parent) continue;
      topicStore.bind({
        workspaceId,
        projectId,
        topicId: parent.topic.topic_id,
        workingSetId: id,
        sessionId: state.manifest.session_id,
        relation: "fork",
        resolution: "inherited",
        resolutionScore: 1,
        reasonCodes: ["historical_fork_parent_binding"]
      });
      pending.delete(id);
      inherited += 1;
      progressed = true;
    }
  }

  for (const id of pending) {
    const state = byId.get(id);
    topicStore.createRoot({
      workspaceId,
      projectId,
      workingSetId: id,
      sessionId: state.manifest.session_id,
      title: "Sujet historique isolé"
    });
    created += 1;
  }

  return Object.freeze({
    schema: "supermemory.topic-migration.v1",
    workspace_id: workspaceId,
    project_id: projectId,
    working_sets: states.length,
    created_roots: created,
    inherited_forks: inherited,
    unchanged
  });
}
