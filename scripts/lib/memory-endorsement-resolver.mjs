const ACCEPTANCE = /^(?:ok(?:ay)?|d['’]accord|oui|yes|go|validé|parfait|cool)[,!. ]*(?:on|nous|je)?\s*(?:part|pars|valide|choisis|garde|fait|fais|prend|prends)?\b|^(?:on|nous)\s+part\s+(?:là|la)-?dessus\b/i;
const NEGATION = /\b(?:non|pas|refuse|annule|plutôt pas|not|don['’]t)\b/i;
const CONDITIONAL = /\b(?:si|à condition|peut-être|maybe|perhaps|unless|provided)\b/i;

function none(reason = "not_an_endorsement") {
  return Object.freeze({ status: "none", reason, activates_memory: false });
}

export function resolveMemoryEndorsement({ userMessage, candidateProposals = [] } = {}) {
  const content = String(userMessage?.content ?? "").trim();
  if (!content || !ACCEPTANCE.test(content) || NEGATION.test(content) || CONDITIONAL.test(content)) {
    return none("acceptance_not_direct");
  }
  const sameThread = candidateProposals.filter((proposal) => (
    proposal?.thread_id && proposal.thread_id === userMessage?.thread_id &&
    proposal?.text && proposal?.message_id && proposal?.episode_id
  ));
  if (sameThread.length === 0) return none("proposal_not_found");
  if (sameThread.length !== 1) {
    return Object.freeze({
      status: "ambiguous",
      reason: "multiple_proposals",
      proposal_ids: sameThread.map((item) => item.proposal_id),
      activates_memory: false
    });
  }
  const proposal = sameThread[0];
  return Object.freeze({
    schema: "supermemory.endorsement-link.v1",
    status: "endorsed",
    authority_role: "user_endorsement",
    proposal_id: proposal.proposal_id,
    text: String(proposal.text),
    message_ids: Object.freeze([proposal.message_id, userMessage.message_id]),
    episode_ids: Object.freeze([proposal.episode_id, userMessage.episode_id]),
    activates_memory: false
  });
}
