function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isEligibleMemory(memory) {
  if (!memory || memory.status !== "active") return false;
  if (memory.sensitivity === "restricted") return false;
  if (memory.stale === true || memory.tombstone === true) return false;
  const consumers = memory.allowed_consumers ?? memory.allowedConsumers ?? [];
  return Array.isArray(consumers) && consumers.includes("codex");
}

function memoryLine(memory, available) {
  const memoryId = cleanText(memory.memory_id ?? memory.memoryId);
  if (!/^mem_[A-Za-z0-9._:-]+$/.test(memoryId)) return null;
  const title = cleanText(memory.title || "Mémoire active");
  const text = cleanText(memory.text);
  const citation = `[${memoryId}]`;
  const prefix = `- ${title}: `;
  const suffix = ` ${citation}`;
  if (prefix.length + suffix.length > available) return null;
  const textBudget = Math.max(0, available - prefix.length - suffix.length);
  const boundedText = text.length > textBudget
    ? `${text.slice(0, Math.max(0, textBudget - 1)).trimEnd()}…`
    : text;
  return `${prefix}${boundedText}${suffix}`;
}

export function buildSessionStartContext({
  projectId,
  workspaceId,
  captureCoverage = "partial",
  daemonStatus = "degraded",
  lastCheckpointAt = null,
  memories = [],
  maxMemories = 5,
  maxChars = 4_000,
  maxTokens = 1_000
} = {}) {
  const hardLimit = Math.min(
    Number.isSafeInteger(maxChars) && maxChars > 0 ? maxChars : 4_000,
    (Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : 1_000) * 4
  );
  const safeLimit = Math.max(1, hardLimit);
  const lines = [
    "SuperMemory — contexte projet local",
    `Projet: ${cleanText(projectId)} | Workspace: ${cleanText(workspaceId)}`,
    `Capture: ${cleanText(captureCoverage)} | Daemon: ${cleanText(daemonStatus)}${
      lastCheckpointAt ? ` | Checkpoint: ${cleanText(lastCheckpointAt)}` : ""
    }`,
    "Utilise supermemory_search quand une décision passée ou un contexte durable peut aider; cite les résultats utilisés."
  ];
  const eligible = memories
    .filter(isEligibleMemory)
    .sort((left, right) => Number(right.priority ?? 0) - Number(left.priority ?? 0))
    .slice(0, Math.min(5, Math.max(0, maxMemories)));
  let text = lines.join("\n");
  let usedMemories = 0;
  let truncated = false;

  if (eligible.length === 0) {
    const unavailable = "\nAucune mémoire active autorisée n’est injectée; le recall MCP peut être indisponible ou vide.";
    if (text.length + unavailable.length <= safeLimit) text += unavailable;
    else truncated = true;
  } else {
    const heading = "\nMémoires actives prioritaires:";
    if (text.length + heading.length <= safeLimit) text += heading;
    for (const memory of eligible) {
      const remaining = safeLimit - text.length - 1;
      const line = memoryLine(memory, remaining);
      if (!line) {
        truncated = true;
        break;
      }
      text += `\n${line}`;
      usedMemories += 1;
    }
    if (usedMemories < eligible.length) truncated = true;
  }

  if (text.length > safeLimit) {
    text = `${text.slice(0, Math.max(0, safeLimit - 18)).trimEnd()}\n[contexte borné]`;
    truncated = true;
  }
  return {
    text,
    usedMemories,
    excludedMemories: memories.length - eligible.length,
    chars: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
    truncated
  };
}
