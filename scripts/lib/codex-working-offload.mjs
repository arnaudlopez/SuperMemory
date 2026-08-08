const DEFAULT_ALLOWED_TOOLS = new Set(["Bash"]);

function reasonFor(input, options) {
  if (options.enabled !== true) return "offload_disabled";
  if (input?.durable !== true) return "not_durable";
  if (input?.complete !== true) return "incomplete";
  if (input?.reopen_verified !== true) return "reopen_unverified";
  if (!["rich", "standard"].includes(input?.capture_coverage)) return "capture_partial";
  if (["spooled", "timed_out", "timedout", "corrupt", "tombstoned", "expired", "purged"].includes(input?.status)) {
    return `state_${input.status}`;
  }
  if (input?.status !== "selected") return "evidence_unselected";
  if (input?.admitted !== true || typeof input?.working_set_id !== "string" || typeof input?.evidence_id !== "string") {
    return "evidence_unavailable";
  }
  const threshold = Number.isSafeInteger(options.thresholdTokens) ? options.thresholdTokens : 12_000;
  if (!Number.isSafeInteger(input?.token_estimate) || input.token_estimate < threshold) return "below_threshold";
  const allowed = new Set(options.allowedTools ?? DEFAULT_ALLOWED_TOOLS);
  if (input.tool_name && !allowed.has(input.tool_name)) return "tool_not_allowed";
  return null;
}

export function evaluateWorkingOffload(input, options = {}) {
  const reason = reasonFor(input, options);
  const eligible = reason === null;
  const replacementEnabled = eligible && options.replacementSupported === true;
  const replacementText = replacementEnabled
    ? [
        `SuperMemory a déchargé cette sortie (${input.token_estimate} tokens estimés) après fsync et réouverture vérifiée.`,
        `Rouvre-la avec supermemory_working_open(working_set_id=\"${input.working_set_id}\", evidence_id=\"${input.evidence_id}\").`,
        `Citation: [${input.evidence_id}]`
      ].join(" ")
    : null;
  return {
    schema: "supermemory.working-offload-receipt.v1",
    eligible,
    reason,
    working_set_id: input?.working_set_id ?? null,
    evidence_id: input?.evidence_id ?? null,
    token_estimate: Number(input?.token_estimate ?? 0),
    durable: input?.durable === true,
    complete: input?.complete === true,
    reopen_verified: input?.reopen_verified === true,
    capture_coverage: input?.capture_coverage ?? "partial",
    replacement_enabled: replacementEnabled,
    suppress_original: replacementEnabled,
    replacement_text: replacementText
  };
}

export function createCodexWorkingOffload(options = {}) {
  return {
    evaluate: (input) => evaluateWorkingOffload(input, options)
  };
}
