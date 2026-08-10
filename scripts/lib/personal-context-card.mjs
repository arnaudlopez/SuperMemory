function defaultTokenCounter(value) {
  return Math.ceil(Buffer.byteLength(String(value), "utf8") / 4);
}

export function buildPersonalContextCard({ results = [], maxTokens = 8_000, tokenCounter = defaultTokenCounter } = {}) {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 8_000 || typeof tokenCounter !== "function") throw new Error("personal_context_budget_invalid");
  const allowed = results.filter((item) => {
    const status = item.status ?? item.authority ?? "current";
    return !["inactive", "revoked", "do_not_use", "superseded"].includes(status) && (item.citations ?? item.citation)?.length > 0;
  }).sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));
  const entries = [];
  let text = "# Personal Context Card\n";
  for (const item of allowed) {
    const citations = (item.citations ?? item.citation ?? []).flat();
    const line = `\n- [${item.scope ?? "owner"}] ${String(item.text ?? "").trim()} [${item.memory_id ?? item.evidence_id ?? "evidence"}]`;
    if (tokenCounter(text + line) > maxTokens) continue;
    text += line;
    entries.push({ memory_id: item.memory_id ?? null, evidence_id: item.evidence_id ?? null, scope: item.scope ?? "owner", project_id: item.project_id ?? null, text: item.text, authority: item.authority ?? "current", citations });
  }
  return Object.freeze({ schema: "supermemory.personal-context-card.v1", text, entries: Object.freeze(entries), token_count: tokenCounter(text), max_tokens: maxTokens, truncated: entries.length < allowed.length });
}
