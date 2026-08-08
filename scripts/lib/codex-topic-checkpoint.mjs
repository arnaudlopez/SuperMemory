import crypto from "node:crypto";
import { canonicalJson } from "./codex-redaction.mjs";

const KINDS = new Set(["periodic", "compaction", "session_end", "manual"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function normalizeItems(items = []) {
  return items.map((item) => {
    const evidenceIds = [...new Set(item?.evidence_ids ?? [])].sort();
    const text = String(item?.text ?? "").replace(/\s+/g, " ").trim();
    if (!text || evidenceIds.length === 0) fail("topic_checkpoint_uncited_item");
    return { text, evidence_ids: evidenceIds };
  });
}

function section(map, name) {
  return normalizeItems(map?.sections?.[name] ?? []);
}

export function buildDeterministicTopicCheckpoint({
  topic,
  membership,
  workingMap,
  kind = "session_end",
  createdAt = null
} = {}) {
  if (topic?.schema !== "supermemory.topic.v1" || membership?.schema !== "supermemory.topic-membership.v1") {
    fail("topic_checkpoint_scope_invalid");
  }
  if (
    membership.topic_id !== topic.topic_id || workingMap?.working_set_id !== membership.working_set_id ||
    workingMap.workspace_id !== topic.workspace_id || workingMap.project_id !== topic.project_id
  ) fail("topic_checkpoint_scope_invalid");
  if (!KINDS.has(kind)) fail("topic_checkpoint_kind_invalid");
  const timestamp = createdAt ?? workingMap.generated_at;
  if (!Number.isFinite(Date.parse(timestamp))) fail("topic_checkpoint_time_invalid");
  const content = {
    schema: "supermemory.topic-checkpoint.v1",
    topic_id: topic.topic_id,
    working_set_id: membership.working_set_id,
    session_id: membership.session_id,
    kind,
    goal: section(workingMap, "goal"),
    invariants: section(workingMap, "constraints"),
    current_state: section(workingMap, "current_state"),
    completed: section(workingMap, "completed"),
    decisions: section(workingMap, "decisions"),
    open_questions: section(workingMap, "open_questions"),
    next_actions: section(workingMap, "next_actions"),
    artifacts: normalizeItems([
      ...(workingMap?.sections?.files ?? []),
      ...(workingMap?.sections?.errors ?? []),
      ...(workingMap?.sections?.evidence_catalog ?? [])
    ]),
    evidence_ids: [...new Set(workingMap.evidence_ids ?? [])].sort(),
    input_hash: workingMap.input_hash,
    generated_by: "deterministic-map-v2",
    enrichment: null,
    created_at: new Date(timestamp).toISOString()
  };
  const checkpointId = `tcp_${crypto.createHash("sha256").update(canonicalJson(content)).digest("hex")}`;
  return Object.freeze({ ...content, checkpoint_id: checkpointId });
}

export function enrichTopicCheckpoint({ checkpoint, enrichment, basedOn = [] } = {}) {
  if (checkpoint?.schema !== "supermemory.topic-checkpoint.v1") fail("topic_checkpoint_invalid");
  const sourceFacts = [...new Set(basedOn)].sort();
  if (typeof enrichment !== "string" || !enrichment.trim() || sourceFacts.length === 0) fail("topic_checkpoint_enrichment_invalid");
  return Object.freeze({
    ...checkpoint,
    enrichment: {
      authoritative: false,
      text: enrichment.trim(),
      based_on: sourceFacts,
      hash: `sha256:${crypto.createHash("sha256").update(canonicalJson({ enrichment: enrichment.trim(), based_on: sourceFacts })).digest("hex")}`
    }
  });
}
