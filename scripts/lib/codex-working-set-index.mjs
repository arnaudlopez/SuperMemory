import { canonicalJson } from "./codex-redaction.mjs";

const INDEXABLE = new Set([
  "prompt.submitted",
  "tool.completed",
  "file.changed",
  "assistant.completed"
]);

const PRIORITY = Object.freeze({
  "prompt.submitted": 90,
  "tool.completed": 75,
  "file.changed": 70,
  "assistant.completed": 55
});

function boundedInteger(value, fallback, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

export function estimateWorkingTokens(value) {
  const bytes = Buffer.byteLength(typeof value === "string" ? value : canonicalJson(value ?? {}));
  return Math.max(1, Math.ceil(bytes / 4));
}

export function classifyWorkingEvent(record, payload, {
  maxCompleteEventBytes = 512 * 1024
} = {}) {
  const envelope = record?.envelope ?? record;
  const kind = envelope?.event_type ?? "unknown";
  const byteLength = Buffer.byteLength(canonicalJson(payload ?? {}));
  const captureCoverage = record?.capture_coverage ?? envelope?.capture_level ?? "partial";
  const complete = byteLength <= boundedInteger(maxCompleteEventBytes, 512 * 1024, 1) &&
    captureCoverage !== "partial" && envelope?.capture_level !== "backfill";
  return {
    eligible: INDEXABLE.has(kind),
    reason: INDEXABLE.has(kind) ? "indexable_event" : "metadata_only",
    kind,
    family: kind.split(".")[0],
    priority: PRIORITY[kind] ?? 0,
    token_estimate: estimateWorkingTokens(payload),
    byte_length: byteLength,
    complete,
    capture_coverage: captureCoverage
  };
}

function sourceOrder(left, right) {
  return Number(left.source_sequence ?? 0) - Number(right.source_sequence ?? 0) ||
    String(left.evidence_id).localeCompare(String(right.evidence_id));
}

function evictionOrder(left, right) {
  return Number(left.priority ?? 0) - Number(right.priority ?? 0) ||
    sourceOrder(left, right);
}

export function selectWorkingEvidence(entries, {
  capacityTokens = 100_000,
  familyShare = 0.6,
  preserveRecentTurns = 2
} = {}) {
  const capacity = boundedInteger(capacityTokens, 100_000, 1);
  const active = entries.filter((entry) => !["tombstoned", "purged"].includes(entry.status));
  const pinned = active.filter((entry) => entry.pinned === true);
  const pinnedTokens = pinned.reduce((sum, entry) => sum + entry.token_estimate, 0);
  const protectedTurns = new Set(active
    .filter((entry) => entry.turn_id)
    .sort(sourceOrder)
    .map((entry) => entry.turn_id)
    .filter((turnId, index, turns) => turns.indexOf(turnId) === index)
    .slice(-preserveRecentTurns));
  const selected = new Set(active.map((entry) => entry.evidence_id));
  let selectedTokens = active.reduce((sum, entry) => sum + entry.token_estimate, 0);

  const evict = (candidates, predicate = () => true) => {
    for (const entry of candidates.sort(evictionOrder)) {
      if (selectedTokens <= capacity) break;
      if (!selected.has(entry.evidence_id) || entry.pinned || protectedTurns.has(entry.turn_id)) continue;
      if (!predicate(entry)) continue;
      selected.delete(entry.evidence_id);
      selectedTokens -= entry.token_estimate;
    }
  };

  const shareLimit = Math.floor(capacity * familyShare);
  for (const family of new Set(active.map((entry) => entry.family))) {
    const familyEntries = active.filter((entry) => entry.family === family && selected.has(entry.evidence_id));
    let familyTokens = familyEntries.reduce((sum, entry) => sum + entry.token_estimate, 0);
    evict(familyEntries, (entry) => {
      if (familyTokens <= shareLimit) return false;
      familyTokens -= entry.token_estimate;
      return true;
    });
  }
  evict(active);
  if (selectedTokens > capacity) {
    for (const entry of active.filter((item) => !item.pinned).sort(evictionOrder)) {
      if (selectedTokens <= capacity) break;
      if (!selected.has(entry.evidence_id)) continue;
      selected.delete(entry.evidence_id);
      selectedTokens -= entry.token_estimate;
    }
  }

  return {
    entries: entries.map((entry) => {
      if (["tombstoned", "purged"].includes(entry.status)) return { ...entry };
      return { ...entry, status: selected.has(entry.evidence_id) ? "selected" : "evicted" };
    }),
    selected_tokens: Math.max(0, selectedTokens),
    pinned_tokens: pinnedTokens,
    state: pinnedTokens > capacity || selectedTokens > capacity ? "over_capacity" : "ready"
  };
}

export function createCodexWorkingSetIndex(options = {}) {
  return {
    classify: (record, payload) => classifyWorkingEvent(record, payload, options),
    estimateTokens: estimateWorkingTokens,
    select: (entries) => selectWorkingEvidence(entries, options)
  };
}
